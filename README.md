# card-watcher

Watches retail sites for trading card **new products, restocks, and price drops**, and
pushes alerts to your phone. Monitoring only — it never buys anything.

## How it works

Every run it fetches each target's products, compares against `state.json`, and alerts on:

- 🆕 **NEW** — a product it has never seen before
- 🔁 **RESTOCK** — a tracked product flipped from out-of-stock to in-stock
- 💸 **PRICE DROP** — price fell more than `priceDropPct` (default 10%)

The first run for a target only seeds the baseline (no alert spam). A rules filter drops
accessories and off-topic matches (sleeves, binders, clothing, the inevitable panini
press) using the site's own product-type data.

## Usage

```sh
node watcher.js               # run once (this is what cron calls)
node watcher.js --loop 10     # run forever, every ~10 min with jitter
node watcher.js --baseline    # re-seed state, no alerts
node watcher.js --test-notify # test your notification channels
node tests/diff.test.js       # unit tests for the alert logic
```

## Notifications (`config.json → notify`)

Console output is always on. For phone pushes pick one:

**ntfy (easiest, no account):**
1. Install the ntfy app (iOS/Android), subscribe to a topic with a hard-to-guess name,
   e.g. `cardwatch-emile-x7k2p`.
2. Set the same topic in config and `"enabled": true`.
   Note: ntfy topics are public to anyone who knows the name — fine for stock alerts.

**Telegram:**
1. Talk to @BotFather → `/newbot` → copy the bot token into `botToken`.
2. Message your new bot once, then visit
   `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy your `chat.id` into `chatId`.
3. Set `"enabled": true`.

## Scheduling — split cloud / local

The watcher runs in two halves so the Mac doesn't have to stay awake:

- **GitHub Actions** (`.github/workflows/watch.yml`) runs the plain-HTTP targets
  (`asda-pokemon`, `asda-sports`, `topps-now`) every ~15 minutes, commits their state,
  rebuilds the status page, and deploys it to **GitHub Pages**. Notification
  credentials go in Actions secrets (`NTFY_TOPIC`, or `TELEGRAM_BOT_TOKEN` +
  `TELEGRAM_CHAT_ID`) — never in the repo.
- **This Mac** runs the browser-based `topps-catalog` target via `tools/run-local.sh`
  (headed Chrome + a residential IP are what get past Cloudflare — a datacenter
  runner can't). It pushes state, which triggers a page rebuild:

```sh
crontab -e
# once an hour while the Mac is awake (Chrome appears in the Dock briefly — leave it):
0 * * * * cd $HOME/Documents/card-watcher && ./tools/run-local.sh >> watcher.log 2>&1
```

State is one file per target (`state/targets/<id>.json`), so the two halves never
write the same files and their commits merge cleanly. Recent alerts land in
`state/alerts/<id>.jsonl` and feed the status page's "recent finds" table.

## Targets (`config.json → targets`)

```jsonc
{
  "id": "asda-pokemon",            // unique key for state tracking
  "adapter": "asda-george",        // which site adapter to use
  "label": "Asda — Pokémon cards", // shown in notifications
  "queries": ["pokemon cards"],    // searches to run, results are merged
  "requireAny": ["pokemon"],       // name/brand/licence must contain one of these
  "requireTypeAny": ["card"]       // site's product-type field must contain one
}
```

Global `filter.excludeKeywords` drops junk by name; `minPrice`/`maxPrice` (0 = off)
bound alert prices.

## Adapters

### asda-george (done)
Queries the public Algolia search index that George's own storefront uses — structured
JSON with `in_stock` and prices, no HTML scraping, very light on their servers.
If the embedded public search key rotates, the watcher will tell you to run
`node tools/refresh-asda-key.js`, which re-extracts it via Playwright.

### topps (done)
Topps UK is a hybrid: a headless Next.js storefront (Cloudflare-protected) backed by
Shopify. Two modes, used as two separate targets:

- `"mode": "now"` — polls the open Shopify channel at
  `topps-uk.myshopify.com/products.json`. Only Topps NOW print-to-order cards (and the
  odd bundle) are published there, but it's plain HTTPS and cheap. Every new NOW card
  appears here → NEW alert.
- `"mode": "collections"` — the main catalog (Match Attax, sealed product) is only
  served via their website, so this renders each collection page in Playwright
  and reads the product tiles (name, £price, add-to-cart vs sold-out, image). Since
  ~Sep 2026 Cloudflare blocks every headless browser flavour here, so this mode drives
  **installed Google Chrome, headed**, with the window parked offscreen — it needs
  Chrome plus a logged-in GUI session (won't run on a headless box). ⚠️ A Chrome icon
  will appear in your Dock while it runs — **don't close it**, it quits by itself in
  a minute or two; closing it aborts the check. One fresh browser context per
  collection — rapid same-session page hops make later pages render empty. Takes
  ~1–2 minutes per run; schedule accordingly.

Empty UK collections (nba, star-wars, marvel) are normal — those lines exist only as
NOW cards. If Topps ever stocks them, the watcher announces it. Their site also has a
release-calendar page — a possible future source for advance drop warnings.

### panini (done)
panini.co.uk is server-rendered Magento, so this is plain HTTPS + parsing the product
grid — no browser, runs in the cloud half. Each target lists category paths (e.g.
`stickers-and-trading-cards/men-s-football`); pages are paginated and capped at 4 per
category. Implementation note: it uses `node:https` with a raised header limit because
Panini's response headers overflow Node fetch's 16KB default. Caveat: the grid appears
to hide out-of-stock products, so this watch is strongest for **new products** — a
vanished product simply stops updating, and restock alerts only fire if Panini shows
sold-out tiles.

### Planned
- **Amazon** — via Keepa API (paid, reliable) or polite page checks; LLM verification
  matters most here to catch third-party scalper listings. Note Amazon sells hot
  Pokémon TCG via invite-request now, which softens the need for fast alerts.
- **Pokémon Center** — ruled out for now (checked 2026-09-06): Imperva returns a hard
  403 even to real headed Chrome driven by Playwright. Community restock trackers are
  the practical option there.

## Ground rules

- Polling is deliberately gentle (default 10-minute cron, ~4 queries per run, delays
  between requests). Don't crank it to seconds — it's rude and gets IPs blocked.
- This tool alerts a human; it does not and will not automate checkout.
- Sites change. When an adapter breaks, the run log says which one and why.
