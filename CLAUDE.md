# card-watcher — project context

Trading card stock watcher built for the user's collector friend. Watches retail
sites for NEW products / RESTOCKS / PRICE DROPS and alerts. **Monitoring only —
never automate checkout; this is a firm project constraint.** Keep polling polite
(10+ min intervals, delays between requests).

Read README.md for usage and architecture. Quick orientation:

- `watcher.js` — entry point; diff logic lives here (exported for tests)
- `adapters/` — one module per site, returns normalized items
- `lib/` — state (state.json), rules filter, notifiers (console/ntfy/Telegram)
- `node watcher.js` runs once; `--baseline` re-seeds silently; `tests/diff.test.js`

## Status (2026-09-06)

- **Hosted split (new).** Public repo github.com/emileagbeko/card-watcher. GitHub
  Actions runs the light targets every 15 min and deploys the status page to
  https://emileagbeko.github.io/card-watcher/ (built by `tools/build-page.js`).
  The Mac runs `topps-catalog` hourly via cron → `tools/run-local.sh` (headed
  Chrome + residential IP; Actions datacenter IPs can't pass Cloudflare). State
  is per-target files in `state/targets/` so the two halves never conflict;
  alert history in `state/alerts/*.jsonl` feeds the page. Notify secrets go in
  Actions secrets (NTFY_TOPIC / TELEGRAM_*), read via env in `loadConfig`.

- **Asda adapter: done.** Queries George's public Algolia search index directly
  (same API their storefront uses; key in config.json, re-extract with
  `node tools/refresh-asda-key.js` if rotated). Asda HTML is Akamai-protected —
  don't bother with plain HTTP there; Algolia needs no browser.
- **Topps adapter: done** (re-fixed 2026-09-06). Hybrid site. `mode: "now"` polls
  the open Shopify feed (`topps-uk.myshopify.com/products.json`, Topps NOW cards
  only). `mode: "collections"` renders uk.topps.com collection pages in Playwright —
  since ~Sep 2026 Cloudflare blocks ALL headless flavours (bundled Chromium: Turnstile
  challenge; Chrome headless: flat 403), so it now launches installed Google Chrome
  headed with the window offscreen (passes the silent check; needs a GUI session).
  Don't spoof the UA on real Chrome — it contradicts brand hints and re-trips
  detection. No product API exists: pages are server-rendered RSC behind Cloudflare
  (myshopify collections JSON is empty for catalog items; checked). Fresh browser
  context per collection (shared sessions render later pages empty), empty renders
  retried once. Empty UK collections (nba/star-wars/marvel) are genuinely empty,
  not a bug. The headed Chrome shows in the Dock during runs; the user closing it
  aborts the check ("browser has been closed" errors) — README warns about this.
- **Panini adapter: done (2026-09-06).** panini.co.uk, Magento, server-rendered —
  plain HTTPS grid parsing, cloud-friendly. Uses node:https with maxHeaderSize 64KB
  (their headers overflow undici fetch's 16KB cap → UND_ERR_HEADERS_OVERFLOW) and
  carries cookies across the occasional store-selection 302. GraphQL is WAF-403'd;
  the HTML isn't. Grid seems to hide OOS items → NEW detection strong, restock weak.
  Targets: panini-football, panini-hobby (category path lists in config).
- **Amazon adapter: not started.** Decision pending: Keepa API (~£15/mo, reliable)
  vs polite scraping. LLM alert verification matters most here (scalper listings).
  Amazon UK sells hot Pokémon TCG via invite-request (24h purchase window).
- **Pokémon Center adapter: ruled out (2026-09-06, two experiments).** Imperva
  hard-403s headed Chrome under Playwright (it detects CDP, unlike Cloudflare which
  passed); a second visible-window test got HTTP 200 but a fully blank document —
  no content, no solvable challenge. Don't retry without a genuinely new approach;
  point the user at community trackers (a tracker-feed adapter is a parked idea).
- **Notifications: wired but disabled** — waiting on the user to pick ntfy topic
  or Telegram credentials. `node watcher.js --test-notify` to verify a channel.
- **Cron 2026-09-06**: `run-local.sh` every 4h (topps-catalog only; rest in
  Actions). Was hourly, but hourly×10 collections + heavy manual testing escalated
  Cloudflare from the solvable Turnstile checkbox to a hard "Attention Required!"
  403 IP-reputation block — which ignores the valid cf_clearance cookie and is made
  worse by VPNs (datacenter IP reputation). Network trace confirmed the block is at
  the edge (no app/API/RSC traffic reaches origin, so there's no bypass endpoint to
  find). Recovery: stop requesting, wait hours on non-VPN residential, then
  topps-verify.js. Keep catalog cadence to hours, never minutes.
- Ideas parked: uk.topps.com release-calendar page as an advance-warning source;
  PWA frontend on Vercel as v2 (superseded for now by the GitHub Pages status
  page).
