const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const history = require('./lib/history');
const snapshot = require('./lib/snapshot');
const postgres = require('./lib/postgres');
const { zipDir } = require('./lib/zip');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
  const ts = timestamp();
  const runDir = path.join(cfg.output.dir, `metrics-export-${ts}`);
  fs.mkdirSync(runDir, { recursive: true });

  console.log(`=== Shipmentia metrics export starting -> ${runDir} ===`);

  const summary = { startedAt: new Date().toISOString(), config: { history: cfg.history }, steps: {} };

  try {
    summary.steps.snapshot = await snapshot.run(runDir);
  } catch (err) {
    console.error(`[snapshot] top-level failure: ${err.message}`);
    summary.steps.snapshot = { error: err.message };
  }

  try {
    summary.steps.history = await history.run(runDir);
  } catch (err) {
    console.error(`[history] top-level failure: ${err.message}`);
    summary.steps.history = { error: err.message };
  }

  try {
    summary.steps.postgres = await postgres.run(runDir);
  } catch (err) {
    console.error(`[postgres] top-level failure: ${err.message}`);
    summary.steps.postgres = { error: err.message };
  }

  summary.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));

  const zipPath = `${runDir}.zip`;
  const bytes = await zipDir(runDir, zipPath);
  console.log(`=== Done. ${(bytes / 1024 / 1024).toFixed(1)} MB -> ${zipPath} ===`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
