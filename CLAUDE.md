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

## Status (2026-08-20)

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
- **Amazon adapter: not started.** Decision pending: Keepa API (~£15/mo, reliable)
  vs polite scraping. LLM alert verification matters most here (scalper listings).
- **Pokémon Center adapter: not started.** Hardest; monitor-only restock pings.
- **Notifications: wired but disabled** — waiting on the user to pick ntfy topic
  or Telegram credentials. `node watcher.js --test-notify` to verify a channel.
- **No cron installed yet.** Example line in README (macOS must be awake).
- Ideas parked: uk.topps.com release-calendar page as an advance-warning source;
  PWA frontend on Vercel as v2 (Vercel hobby cron is daily-only — schedule would
  need GitHub Actions or Supabase cron).
