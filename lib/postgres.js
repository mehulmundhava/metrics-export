const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const cfg = require('../config');

async function detectStatStatementsColumns(client) {
  const res = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'pg_stat_statements'`
  );
  const cols = new Set(res.rows.map((r) => r.column_name));
  // Postgres 13+ renamed total_time/mean_time -> total_exec_time/mean_exec_time
  const usesExecTime = cols.has('total_exec_time');
  return {
    total: usesExecTime ? 'total_exec_time' : 'total_time',
    mean: usesExecTime ? 'mean_exec_time' : 'mean_time',
  };
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

    const { total, mean } = await detectStatStatementsColumns(client);

    const queries = [
      {
        id: 'top_by_total_time',
        sql: `SELECT userid::regrole::text AS role, dbid::regdatabase::text AS database, queryid, calls,
                     ${total} AS total_time_ms, ${mean} AS mean_time_ms, rows, query
              FROM pg_stat_statements
              ORDER BY ${total} DESC
              LIMIT $1`,
      },
      {
        id: 'top_by_calls',
        sql: `SELECT userid::regrole::text AS role, dbid::regdatabase::text AS database, queryid, calls,
                     ${total} AS total_time_ms, ${mean} AS mean_time_ms, rows, query
              FROM pg_stat_statements
              ORDER BY calls DESC
              LIMIT $1`,
      },
      {
        id: 'top_by_mean_time',
        sql: `SELECT userid::regrole::text AS role, dbid::regdatabase::text AS database, queryid, calls,
                     ${total} AS total_time_ms, ${mean} AS mean_time_ms, rows, query
              FROM pg_stat_statements
              WHERE calls > 5
              ORDER BY ${mean} DESC
              LIMIT $1`,
      },
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
    ];

    for (const q of queries) {
      try {
        const res = q.noLimit ? await client.query(q.sql) : await client.query(q.sql, [topN]);
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
