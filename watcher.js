#!/usr/bin/env node
// card-watcher: polls retail sites for trading card stock and alerts on
// new products, restocks, and price drops. Monitoring only — no purchasing.
//
// Usage:
//   node watcher.js              run all targets once (cron-friendly)
//   node watcher.js --targets a,b  run only those target ids
//   node watcher.js --loop 10    run forever, every ~10 minutes (with jitter)
//   node watcher.js --baseline   re-seed state without sending alerts
//   node watcher.js --test-notify  send a test notification to configured channels

const fs = require('fs');
const path = require('path');
const { loadState, saveState, appendAlerts } = require('./lib/state');
const { applyFilter } = require('./lib/filter');
const { notify } = require('./lib/notify');

const ADAPTERS = {
  'asda-george': require('./adapters/asda-george'),
  topps: require('./adapters/topps'),
  panini: require('./adapters/panini'),
};

const CONFIG_FILE = path.join(__dirname, 'config.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  // Channel credentials can come from the environment (GitHub Actions secrets)
  // so they never live in the repo.
  if (process.env.NTFY_TOPIC) {
    config.notify.ntfy = { ...config.notify.ntfy, enabled: true, topic: process.env.NTFY_TOPIC };
  }
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    config.notify.telegram = {
      enabled: true,
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
    };
  }
  return config;
}

function diff(items, targetState, config, baselineOnly) {
  const events = [];
  const firstRun = Object.keys(targetState.items).length === 0;
  const dropPct = config.priceDropPct || 10;

  for (const item of items) {
    const prev = targetState.items[item.id];
    if (!prev) {
      if (!firstRun && !baselineOnly) events.push({ type: 'new', item });
    } else if (!baselineOnly) {
      if (!prev.inStock && item.inStock) {
        events.push({ type: 'restock', item });
      } else if (
        typeof item.price === 'number' &&
        typeof prev.price === 'number' &&
        item.price < prev.price * (1 - dropPct / 100)
      ) {
        events.push({ type: 'price_drop', item, oldPrice: prev.price });
      }
    }
    targetState.items[item.id] = {
      name: item.name,
      price: item.price,
      inStock: item.inStock,
      firstSeen: prev ? prev.firstSeen : new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };
  }
  return { events, firstRun };
}

async function runOnce(config, { baselineOnly = false, only = null } = {}) {
  const state = loadState();
  for (const target of config.targets || []) {
    if (only && !only.has(target.id)) continue;
    const adapter = ADAPTERS[target.adapter];
    if (!adapter) {
      console.error(`[${target.id}] unknown adapter "${target.adapter}", skipping`);
      continue;
    }
    const label = target.label || target.id;
    try {
      const raw = await adapter.fetchItems(target, config);
      const { kept, dropped } = applyFilter(raw, config.filter, target);
      state.targets[target.id] = state.targets[target.id] || { items: {} };
      const targetState = state.targets[target.id];
      const { events, firstRun } = diff(kept, targetState, config, baselineOnly);
      targetState.lastRun = new Date().toISOString();

      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      console.log(
        `[${stamp}] ${label}: ${raw.length} fetched, ${dropped.length} filtered out, ` +
          `${Object.keys(targetState.items).length} tracked, ${events.length} alert(s)` +
          (firstRun ? ' (first run — baseline seeded, no alerts)' : '')
      );
      await notify(events, label, config.notify || {});
      if (!baselineOnly) appendAlerts(target.id, events);
    } catch (e) {
      console.error(`[${target.id}] run failed: ${e.message}`);
    }
  }
  saveState(state);
}

async function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();

  // --targets a,b  limits the run to those target ids (the Actions runner
  // takes the light HTTP targets; the Mac takes the browser-based one).
  let only = null;
  const targetsIdx = args.indexOf('--targets');
  if (targetsIdx !== -1) {
    only = new Set((args[targetsIdx + 1] || '').split(',').filter(Boolean));
    const known = new Set((config.targets || []).map((t) => t.id));
    for (const id of only) {
      if (!known.has(id)) console.error(`--targets: unknown target id "${id}"`);
    }
  }

  if (args.includes('--test-notify')) {
    await notify(
      [
        {
          type: 'restock',
          item: {
            name: 'Test alert — card-watcher is working',
            price: 9.99,
            inStock: true,
            url: 'https://direct.asda.com/',
          },
        },
      ],
      'card-watcher test',
      config.notify || {}
    );
    return;
  }

  if (args.includes('--baseline')) {
    await runOnce(config, { baselineOnly: true, only });
    console.log('Baseline refreshed — no alerts sent.');
    return;
  }

  const loopIdx = args.indexOf('--loop');
  if (loopIdx !== -1) {
    const minutes = Math.max(2, parseFloat(args[loopIdx + 1]) || 10);
    console.log(`Looping every ~${minutes} min (ctrl-c to stop)`);
    for (;;) {
      await runOnce(loadConfig(), { only });
      const jitter = 0.8 + Math.random() * 0.4;
      await sleep(minutes * 60 * 1000 * jitter);
    }
  }

  await runOnce(config, { only });
}

if (require.main === module) {
  main().catch((e) => {
    console.error('fatal:', e);
    process.exit(1);
  });
}

module.exports = { diff };
