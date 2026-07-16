const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const prom = require('./prometheus');
const queries = require('./queries');

async function run(outDir) {
  const historyDir = path.join(outDir, 'prometheus-history');
  fs.mkdirSync(historyDir, { recursive: true });

  const endUnix = Math.floor(Date.now() / 1000);
  const startUnix = endUnix - cfg.history.days * 86400;
  const step = cfg.history.stepSeconds;

  console.log(`[history] window: ${new Date(startUnix * 1000).toISOString()} -> ${new Date(endUnix * 1000).toISOString()}, step=${step}s`);

  const allMetricNames = await prom.getAllMetricNames();

  // Build the full query list: curated + auto-discovered prefix matches.
  const jobs = [...queries];
  for (const prefix of queries.autoDiscoverPrefixes) {
    for (const name of allMetricNames) {
      if (name.startsWith(prefix)) {
        // Collapse to one series per instance server-side. Raw per-label
        // (per-process, per-app) series can have enough cardinality/churn
        // over a multi-day window that the JSON response blows past Node's
        // max string length. Aggregate trend is what we need for load
        // diagnosis anyway; drill into specifics live in Grafana if needed.
        jobs.push({ id: name, checkMetric: name, promql: `sum by (instance) (${name})`, autoDiscovered: true });
      }
    }
  }

  const results = { fetched: [], skipped: [], failed: [] };

  for (const job of jobs) {
    if (!allMetricNames.has(job.checkMetric)) {
      results.skipped.push({ id: job.id, reason: `metric '${job.checkMetric}' not found on this Prometheus` });
      continue;
    }
    try {
      const data = await prom.queryRange(job.promql, startUnix, endUnix, step);
      fs.writeFileSync(
        path.join(historyDir, `${job.id}.json`),
        JSON.stringify({ id: job.id, promql: job.promql, resultType: data.resultType, result: data.result }, null, 2)
      );
      results.fetched.push(job.id);
    } catch (err) {
      const hint = err.message === 'Invalid string length'
        ? ' (response too large to parse - likely high series cardinality; consider raising HISTORY_STEP or narrowing the query)'
        : '';
      results.failed.push({ id: job.id, error: err.message + hint });
      console.warn(`[history] FAILED ${job.id}: ${err.message}${hint}`);
    }
  }

  fs.writeFileSync(path.join(historyDir, '_manifest.json'), JSON.stringify(results, null, 2));
  console.log(`[history] fetched=${results.fetched.length} skipped=${results.skipped.length} failed=${results.failed.length}`);
  return results;
}

module.exports = { run };
