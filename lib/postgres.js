const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const cfg = require('../config');

// Tables implicated by the earlier pg_stat_statements pass - used to pull
// seq-scan/index-usage/bloat/index-definition/size context for each.
const SUSPECT_TABLES = [
  'device_current_data',
  'mty17_messages',
  'incoming_message_table',
  'incoming_message_history_k',
];

async function getColumns(client, tableName) {
  const res = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [tableName]
  );
  return new Set(res.rows.map((r) => r.column_name));
}

async function detectStatStatementsColumns(client) {
  const cols = await getColumns(client, 'pg_stat_statements');
  const usesExecTime = cols.has('total_exec_time');
  const timeCols = {
    total: usesExecTime ? 'total_exec_time' : 'total_time',
    mean: usesExecTime ? 'mean_exec_time' : 'mean_time',
  };

  const optional = [
    'shared_blks_hit', 'shared_blks_read', 'shared_blks_dirtied', 'shared_blks_written',
    'local_blks_hit', 'local_blks_read', 'local_blks_dirtied', 'local_blks_written',
    'temp_blks_read', 'temp_blks_written',
    'blk_read_time', 'blk_write_time',
    'temp_blk_read_time', 'temp_blk_write_time',
    'wal_records', 'wal_fpi', 'wal_bytes',
  ].filter((c) => cols.has(c));

  return { ...timeCols, optional };
}

function baseColumnList(total, mean, optional) {
  const optionalSelect = optional.map((c) => `s.${c}`).join(', ');
  return `userid::regrole::text AS role, d.datname AS database, s.queryid, s.calls,
          s.${total} AS total_time_ms, s.${mean} AS mean_time_ms, s.rows${optionalSelect ? ', ' + optionalSelect : ''}, s.query`;
}

async function run(outDir) {
  const pgDir = path.join(outDir, 'postgres-query-tracker');
  fs.mkdirSync(pgDir, { recursive: true });

  if (!cfg.postgres.password) {
    const msg = 'PGPASSWORD not set - skipping Postgres query-tracker export entirely';
    console.warn(`[postgres] ${msg}`);
    fs.writeFileSync(path.join(pgDir, '_manifest.json'), JSON.stringify({ skipped: true, reason: msg }, null, 2));
    return { skipped: true, reason: msg };
  }

  const client = new Client({
    host: cfg.postgres.host,
    port: cfg.postgres.port,
    database: cfg.postgres.database,
    user: cfg.postgres.user,
    password: cfg.postgres.password,
    ssl: cfg.postgres.ssl,
    statement_timeout: 30000,
  });

  const results = { ok: [], failed: [] };
  const topN = cfg.postgres.topN;

  try {
    await client.connect();

    const { total, mean, optional } = await detectStatStatementsColumns(client);
    const cols = baseColumnList(total, mean, optional);
    const hasSharedBlksRead = optional.includes('shared_blks_read');
    const hasTempBlksWritten = optional.includes('temp_blks_written');

    const queries = [
      {
        id: 'top_by_total_time',
        sql: `SELECT ${cols}
              FROM pg_stat_statements s
              LEFT JOIN pg_database d ON d.oid = s.dbid
              ORDER BY s.${total} DESC
              LIMIT $1`,
      },
      {
        id: 'top_by_calls',
        sql: `SELECT ${cols}
              FROM pg_stat_statements s
              LEFT JOIN pg_database d ON d.oid = s.dbid
              ORDER BY s.calls DESC
              LIMIT $1`,
      },
      {
        id: 'top_by_mean_time',
        sql: `SELECT ${cols}
              FROM pg_stat_statements s
              LEFT JOIN pg_database d ON d.oid = s.dbid
              WHERE s.calls > 5
              ORDER BY s.${mean} DESC
              LIMIT $1`,
      },
    ];

    if (hasSharedBlksRead) {
      queries.push({
        id: 'top_by_physical_disk_reads',
        sql: `SELECT ${cols}
              FROM pg_stat_statements s
              LEFT JOIN pg_database d ON d.oid = s.dbid
              ORDER BY s.shared_blks_read DESC
              LIMIT $1`,
      });
    }

    if (hasTempBlksWritten) {
      queries.push({
        id: 'top_by_disk_spill',
        sql: `SELECT ${cols}
              FROM pg_stat_statements s
              LEFT JOIN pg_database d ON d.oid = s.dbid
              WHERE s.temp_blks_written > 0
              ORDER BY s.temp_blks_written DESC
              LIMIT $1`,
      });
    }

    queries.push(
      {
        id: 'active_queries',
        sql: `SELECT pid, usename, datname, state, wait_event_type, wait_event,
                     now() - query_start AS running_for, query
              FROM pg_stat_activity
              WHERE state != 'idle' AND pid != pg_backend_pid()
              ORDER BY query_start ASC`,
        noLimit: true,
      },
      {
        id: 'blocking_locks',
        sql: `SELECT blocked.pid AS blocked_pid, blocked.usename AS blocked_user,
                     blocked.query AS blocked_query,
                     blocking.pid AS blocking_pid, blocking.usename AS blocking_user,
                     blocking.query AS blocking_query
              FROM pg_stat_activity blocked
              JOIN pg_locks bl ON bl.pid = blocked.pid AND NOT bl.granted
              JOIN pg_locks kl ON kl.locktype = bl.locktype AND kl.database IS NOT DISTINCT FROM bl.database
                AND kl.relation IS NOT DISTINCT FROM bl.relation AND kl.page IS NOT DISTINCT FROM bl.page
                AND kl.tuple IS NOT DISTINCT FROM bl.tuple AND kl.granted
              JOIN pg_stat_activity blocking ON blocking.pid = kl.pid
              WHERE blocked.pid != blocking.pid`,
        noLimit: true,
      },
      {
        id: 'database_stats',
        sql: `SELECT datname, numbackends, xact_commit, xact_rollback, blks_read, blks_hit,
                     tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted,
                     conflicts, temp_files, temp_bytes, deadlocks, blk_read_time, blk_write_time
              FROM pg_stat_database
              WHERE datname IS NOT NULL`,
        noLimit: true,
      },
      {
        id: 'suspect_table_scan_stats',
        sql: `SELECT schemaname, relname, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch,
                     n_live_tup, n_dead_tup, n_mod_since_analyze,
                     last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
              FROM pg_stat_user_tables
              WHERE relname = ANY($1)`,
        params: [SUSPECT_TABLES],
        noLimit: true,
      },
      {
        id: 'suspect_table_indexes',
        sql: `SELECT tablename, indexname, indexdef
              FROM pg_indexes
              WHERE tablename = ANY($1)
              ORDER BY tablename, indexname`,
        params: [SUSPECT_TABLES],
        noLimit: true,
      },
      {
        id: 'suspect_table_sizes',
        sql: `SELECT relname AS table_name,
                     pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
                     pg_size_pretty(pg_relation_size(relid)) AS table_size,
                     pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS index_size
              FROM pg_stat_user_tables
              WHERE relname = ANY($1)`,
        params: [SUSPECT_TABLES],
        noLimit: true,
      }
    );

    for (const q of queries) {
      try {
        const params = q.params || (q.noLimit ? [] : [topN]);
        const res = await client.query(q.sql, params);
        fs.writeFileSync(path.join(pgDir, `${q.id}.json`), JSON.stringify(res.rows, null, 2));
        results.ok.push({ id: q.id, rows: res.rows.length });
      } catch (err) {
        results.failed.push({ id: q.id, error: err.message });
        console.warn(`[postgres] FAILED ${q.id}: ${err.message}`);
      }
    }
  } catch (err) {
    results.failed.push({ id: 'connect', error: err.message });
    console.warn(`[postgres] connection failed: ${err.message}`);
  } finally {
    await client.end().catch(() => {});
  }

  fs.writeFileSync(path.join(pgDir, '_manifest.json'), JSON.stringify(results, null, 2));
  console.log(`[postgres] ok=${results.ok.length} failed=${results.failed.length}`);
  return results;
}

module.exports = { run };
