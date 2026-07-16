const cfg = require('../config');

async function getJSON(path) {
  const url = `${cfg.prometheus.baseUrl}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Prometheus request failed [${res.status}] ${url}`);
  }
  const body = await res.json();
  if (body.status !== 'success') {
    throw new Error(`Prometheus returned error for ${url}: ${JSON.stringify(body)}`);
  }
  return body.data;
}

// All currently scraped targets (job, instance, health, static labels).
// This is what drives the live-snapshot list — no hardcoded exporter URLs.
async function getTargets() {
  const data = await getJSON('/api/v1/targets');
  return data.activeTargets.map((t) => ({
    job: t.labels.job,
    instance: t.labels.instance,
    server: t.labels.server || null,
    health: t.health,
    scrapeUrl: t.scrapeUrl,
    lastError: t.lastError || null,
  }));
}

// Every metric name Prometheus currently knows about. Used to decide which
// curated queries are safe to run, and to auto-discover pm2/process_exporter
// metric names without guessing.
async function getAllMetricNames() {
  const data = await getJSON('/api/v1/label/__name__/values');
  return new Set(data);
}

async function queryRange(promql, startUnix, endUnix, stepSeconds) {
  const params = new URLSearchParams({
    query: promql,
    start: String(startUnix),
    end: String(endUnix),
    step: String(stepSeconds),
  });
  return getJSON(`/api/v1/query_range?${params.toString()}`);
}

module.exports = { getTargets, getAllMetricNames, queryRange };
