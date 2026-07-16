const fs = require('fs');
const path = require('path');
const prom = require('./prometheus');

function safeName(target) {
  return `${target.server || 'unknown-server'}__${target.job}__${target.instance}`.replace(/[:/]/g, '-');
}

async function run(outDir) {
  const snapDir = path.join(outDir, 'exporter-snapshots');
  fs.mkdirSync(snapDir, { recursive: true });

  const targets = await prom.getTargets();
  fs.writeFileSync(path.join(snapDir, '_targets.json'), JSON.stringify(targets, null, 2));

  const results = { ok: [], down: [], failed: [] };

  for (const target of targets) {
    if (target.health !== 'up') {
      results.down.push({ job: target.job, instance: target.instance, health: target.health, lastError: target.lastError });
      continue;
    }
    try {
      const res = await fetch(target.scrapeUrl);
      const text = await res.text();
      fs.writeFileSync(path.join(snapDir, `${safeName(target)}.txt`), text);
      results.ok.push({ job: target.job, instance: target.instance });
    } catch (err) {
      results.failed.push({ job: target.job, instance: target.instance, error: err.message });
      console.warn(`[snapshot] FAILED ${target.job}/${target.instance}: ${err.message}`);
    }
  }

  fs.writeFileSync(path.join(snapDir, '_manifest.json'), JSON.stringify(results, null, 2));
  console.log(`[snapshot] ok=${results.ok.length} down=${results.down.length} failed=${results.failed.length}`);
  return results;
}

module.exports = { run };
