// State lives in one JSON file per target (state/targets/<id>.json) so the
// GitHub Actions runner and the local Mac runner can each commit their own
// targets without ever touching the same file. Alert history for the status
// page is appended per target too (state/alerts/<id>.jsonl, capped).

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', 'state');
const TARGETS_DIR = path.join(STATE_DIR, 'targets');
const ALERTS_DIR = path.join(STATE_DIR, 'alerts');
const ALERT_LOG_MAX = 200;

function loadState() {
  const state = { targets: {} };
  let files = [];
  try {
    files = fs.readdirSync(TARGETS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return state;
  }
  for (const f of files) {
    try {
      state.targets[path.basename(f, '.json')] = JSON.parse(
        fs.readFileSync(path.join(TARGETS_DIR, f), 'utf8')
      );
    } catch (e) {
      console.error(`[state] skipping unreadable ${f}: ${e.message}`);
    }
  }
  return state;
}

function saveState(state) {
  fs.mkdirSync(TARGETS_DIR, { recursive: true });
  for (const [id, target] of Object.entries(state.targets || {})) {
    const file = path.join(TARGETS_DIR, `${id}.json`);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(target, null, 2) + '\n');
    fs.renameSync(tmp, file);
  }
}

function appendAlerts(targetId, events) {
  if (!events.length) return;
  fs.mkdirSync(ALERTS_DIR, { recursive: true });
  const file = path.join(ALERTS_DIR, `${targetId}.jsonl`);
  const now = new Date().toISOString();
  const fresh = events.map((ev) =>
    JSON.stringify({
      t: now,
      type: ev.type,
      name: ev.item.name,
      price: ev.item.price,
      oldPrice: ev.oldPrice,
      inStock: ev.item.inStock,
      url: ev.item.url,
    })
  );
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {}
  lines = lines.concat(fresh).slice(-ALERT_LOG_MAX);
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

function loadAlerts() {
  const all = [];
  let files = [];
  try {
    files = fs.readdirSync(ALERTS_DIR).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return all;
  }
  for (const f of files) {
    const targetId = path.basename(f, '.jsonl');
    for (const line of fs.readFileSync(path.join(ALERTS_DIR, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        all.push({ targetId, ...JSON.parse(line) });
      } catch {}
    }
  }
  all.sort((a, b) => (a.t < b.t ? 1 : -1));
  return all;
}

module.exports = { loadState, saveState, appendAlerts, loadAlerts, STATE_DIR };
