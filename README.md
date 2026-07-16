# Shipmentia Metrics Export

Pulls 3 things into one zip, for offline diagnosis of the postgre-db /
mqtt-server load issue:

1. **`exporter-snapshots/`** — live `/metrics` scrape of every currently-up
   Prometheus target (pulled from Prometheus's own `/api/v1/targets`, so it
   always matches your real scrape config, nothing hardcoded).
2. **`prometheus-history/`** — 7 days (configurable) of range-query history
   for a curated set of load-diagnosis metrics (CPU/iowait/steal, load
   average, memory, swap, disk I/O, network, Kafka lag, Postgres stats,
   pipeline/API latency), plus auto-discovered `pm2_*` and
   `namedprocess_namegroup_*` series.
3. **`postgres-query-tracker/`** — direct SQL against `pg_stat_statements`
   (top by total time / calls / mean time, uncapped, full query text —
   more complete than what postgres_exporter surfaces), plus
   `pg_stat_activity`, blocking-lock detection, and `pg_stat_database`.

## Setup (run once, on monitoring-server)

```bash
cd metrics-export
npm install
```

## Run

```bash
export PGPASSWORD='<postgres_exporter password>'
node index.js
```

Optional overrides (all have sane defaults for this environment):

```bash
export HISTORY_DAYS=7          # lookback window
export HISTORY_STEP=300        # seconds between data points
export PROM_URL=http://localhost:9090
export OUTPUT_DIR=./output
export PG_TOP_N=50             # rows per pg_stat_statements ordering
```

Output: `./output/metrics-export-<timestamp>.zip`

## Notes

- If `PGPASSWORD` isn't set, the Postgres section is skipped (not
  failed) — everything else still runs.
- Any curated Prometheus query whose underlying metric doesn't exist in
  your environment is skipped and logged in
  `prometheus-history/_manifest.json` rather than aborting the run.
- Any Prometheus target that's currently down is skipped and logged in
  `exporter-snapshots/_manifest.json`.
- Safe to re-run repeatedly — each run gets its own timestamped folder/zip,
  nothing is overwritten.
