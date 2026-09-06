#!/usr/bin/env node
// Generates the static status page (site/index.html) from config + state +
// alert logs. Runs in the GitHub Actions workflow after each watch run; the
// page is deployed to GitHub Pages. No secrets, no runtime JS — plain HTML.

const fs = require('fs');
const path = require('path');
const { loadState, loadAlerts } = require('../lib/state');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const state = loadState();
const alerts = loadAlerts().slice(0, 40);

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtPrice = (p) => (typeof p === 'number' ? `£${p.toFixed(2)}` : '');
const ukTime = (iso, opts) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...opts }).format(new Date(iso));
const fmtWhen = (iso) => ukTime(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// A light HTTP target is checked every ~15 min from Actions; the browser-based
// catalog target runs from the Mac, less often and only while it's awake.
const FRESH_MINUTES = { 'topps-catalog': 24 * 60 };
const FRESH_DEFAULT = 90;

const chips = (config.targets || [])
  .map((t) => {
    const ts = state.targets[t.id] || {};
    const tracked = Object.keys(ts.items || {}).length;
    const freshFor = FRESH_MINUTES[t.id] || FRESH_DEFAULT;
    const ageMin = ts.lastRun ? (Date.now() - new Date(ts.lastRun)) / 60000 : Infinity;
    const stale = ageMin > freshFor;
    const checked = ts.lastRun ? `checked ${fmtWhen(ts.lastRun)}` : 'no run yet';
    return `      <div class="watch">
        <span class="state${stale ? ' stale' : ''}"><span class="dot"></span>${stale ? 'Stale' : 'Watching'}</span>
        <span class="site">${esc(t.label || t.id)}</span>
        <span class="count">${tracked} tracked · ${checked}</span>
      </div>`;
  })
  .join('\n');

const TYPE_PILL = {
  new: '<span class="pill gold">New</span>',
  restock: '<span class="pill live">Restock</span>',
  price_drop: '<span class="pill live">Price drop</span>',
};
const labelById = Object.fromEntries((config.targets || []).map((t) => [t.id, t.label || t.id]));

const rows = alerts
  .map((a) => {
    let price = fmtPrice(a.price);
    if (a.type === 'price_drop' && typeof a.oldPrice === 'number')
      price += ` <s>${fmtPrice(a.oldPrice)}</s>`;
    return `          <tr>
            <td>${TYPE_PILL[a.type] || esc(a.type)}</td>
            <td><a href="${esc(a.url)}">${esc(a.name)}</a><span class="shop">${esc(labelById[a.targetId] || a.targetId)}</span></td>
            <td class="price">${price}</td>
            <td class="when">${fmtWhen(a.t)}</td>
          </tr>`;
  })
  .join('\n');

const builtAt = fmtWhen(new Date().toISOString());

const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Card Watcher</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎴</text></svg>">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600&display=swap">
<style>
  :root {
    color-scheme: light dark;
    --paper: #FAF9F6; --ink: #1C2126; --slate: #5B6672;
    --teal: #0E7C6B; --teal-soft: #0E7C6B1A;
    --gold: #B98A1F; --gold-soft: #B98A1F22;
    --line: #E3E1DA; --card: #FFFFFF; --warn: #B4552D;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #14181C; --ink: #E9E7E1; --slate: #9AA4AD;
      --teal: #2FB39E; --teal-soft: #2FB39E24;
      --gold: #D9A83C; --gold-soft: #D9A83C26;
      --line: #2A3138; --card: #1B2127; --warn: #E08A5E;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font-family: "Barlow", "Helvetica Neue", Arial, sans-serif;
    font-size: 16px; line-height: 1.55;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 36px 20px 64px; display: flex; flex-direction: column; gap: 40px; }
  a { color: var(--teal); text-decoration-thickness: 1px; text-underline-offset: 2px; }
  a:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }
  h1, h2 { font-family: "Barlow Condensed", "Arial Narrow", Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.02em; margin: 0; text-wrap: balance; }
  h1 { font-size: 42px; font-weight: 700; line-height: 1.05; }
  h2 { font-size: 24px; font-weight: 700; }
  .eyebrow { font-family: "Barlow Condensed", Arial, sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: 0.14em; font-size: 13px; color: var(--teal); margin: 0 0 6px; }
  p { margin: 0; }
  section { display: flex; flex-direction: column; gap: 14px; }
  .lede { color: var(--slate); max-width: 58ch; }
  .watches { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
  .watch { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
  .watch .site { font-weight: 600; font-size: 14px; }
  .watch .count { color: var(--slate); font-size: 13px; font-variant-numeric: tabular-nums; }
  .watch .state { display: inline-flex; align-items: center; gap: 6px; font-family: "Barlow Condensed", Arial, sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; font-size: 12px; color: var(--teal); }
  .watch .state .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); }
  .watch .state.stale { color: var(--warn); }
  .watch .state.stale .dot { background: var(--warn); }
  .tablebox { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
  table { border-collapse: collapse; width: 100%; min-width: 520px; }
  th, td { text-align: left; padding: 9px 14px; font-size: 15px; vertical-align: top; }
  thead th { font-family: "Barlow Condensed", Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600; font-size: 12px; color: var(--slate); border-bottom: 1px solid var(--line); }
  tbody tr { border-top: 1px solid var(--line); }
  tbody tr:first-child { border-top: none; }
  td .shop { display: block; color: var(--slate); font-size: 13px; }
  td.price { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 500; }
  td.price s { color: var(--slate); font-weight: 400; }
  th.price { text-align: right; }
  td.when { color: var(--slate); font-size: 13px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pill { display: inline-block; white-space: nowrap; font-family: "Barlow Condensed", Arial, sans-serif; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; font-size: 12px; border-radius: 99px; padding: 1px 9px; }
  .pill.live { color: var(--teal); background: var(--teal-soft); }
  .pill.gold { color: var(--gold); background: var(--gold-soft); }
  .empty { color: var(--slate); padding: 18px 14px; }
  footer { color: var(--slate); font-size: 13px; border-top: 1px solid var(--line); padding-top: 16px; }
  header .stamp { font-family: "Barlow Condensed", Arial, sans-serif; text-transform: uppercase; letter-spacing: 0.14em; font-size: 13px; color: var(--slate); margin-top: 8px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <p class="eyebrow">Live status · rebuilt ${builtAt} UK</p>
    <h1>Card Watcher</h1>
    <p class="stamp">New products · restocks · price drops — alerts, never auto-buying</p>
  </header>

  <section>
    <h2>Watches</h2>
    <div class="watches">
${chips}
    </div>
  </section>

  <section>
    <h2>Recent finds</h2>
    <p class="lede">The latest new listings, restocks and price drops across every watch,
    newest first. Times are UK.</p>
    <div class="tablebox">
${
  rows
    ? `      <table>
        <thead><tr><th>What</th><th>Product</th><th class="price">Price</th><th>Spotted</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>`
    : '      <p class="empty">Nothing spotted yet since the watcher went live — the baseline is seeded and any change from here on lands in this table.</p>'
}
    </div>
  </section>

  <footer>
    <p>card-watcher · shop checks run every 15+ minutes with polite delays · the Topps
    catalog check runs from a real browser a few times a day · this page rebuilds after
    every run</p>
  </footer>
</div>
</body>
</html>
`;

const outDir = path.join(__dirname, '..', 'site');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`site/index.html built (${alerts.length} recent finds, ${Object.keys(state.targets).length} watches)`);
