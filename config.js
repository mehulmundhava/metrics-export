// ---------------------------------------------------------------------------
// EDIT THIS FILE (or set the env vars) before running on monitoring-server.
// Nothing here is guessed at runtime except metric *names*, which the script
// verifies against Prometheus before querying (see lib/discover.js).
// ---------------------------------------------------------------------------

module.exports = {
  prometheus: {
    // Running directly on monitoring-server, so localhost:9090 is correct.
    baseUrl: process.env.PROM_URL || 'http://localhost:9090',
  },

  history: {
    days: Number(process.env.HISTORY_DAYS || 7),
    // 5m step over 7 days = ~2016 points/series. Raise to 60 if the export
    // gets too large; lower to 60s for a short high-resolution window.
    stepSeconds: Number(process.env.HISTORY_STEP || 300),
  },

  // Direct DB connection, reusing postgres_exporter's existing role
  // (member of pg_monitor + SELECT on pg_stat_statements — sufficient for
  // pg_stat_activity, pg_locks, pg_stat_database, pg_stat_statements).
  // Password is NOT stored here — export PGPASSWORD before running:
  //   export PGPASSWORD='...'
  postgres: {
    host: process.env.PGHOST || '172.31.30.205',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'cpdata',
    user: process.env.PGUSER || 'postgres_exporter',
    password: process.env.PGPASSWORD,
    ssl: false,
    // Row cap per pg_stat_statements ordering — plenty for diagnosis, keeps
    // the zip small. Raise if you need the long tail.
    topN: Number(process.env.PG_TOP_N || 50),
  },

  output: {
    dir: process.env.OUTPUT_DIR || './output',
  },
};
