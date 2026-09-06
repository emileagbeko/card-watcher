// Topps UK adapter. Two modes, because the store is a hybrid:
//
//   mode "now"         — polls the open Shopify channel (topps-uk.myshopify.com/
//                        products.json). Only Topps NOW print-to-order cards and a
//                        handful of bundles are published there, but it's plain
//                        HTTPS, cheap, and every new NOW card shows up in it.
//   mode "collections" — the main catalog (Match Attax, sealed boxes...) is only
//                        served through their Cloudflare-protected Next.js site,
//                        so this mode renders collection pages in real Chrome
//                        (headed, offscreen — Cloudflare blocks headless) via
//                        Playwright and reads the product tiles. Heavier: poll
//                        this less often. Covers the first page of each
//                        collection (new stock appears there).

const DEFAULTS = {
  shop: 'https://topps-uk.myshopify.com',
  site: 'https://uk.topps.com',
  channel: 'chrome', // real Chrome for collections mode; see fetchCollections
};

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchNow(cfg) {
  const resp = await fetch(`${cfg.shop}/products.json?limit=250`, {
    headers: { 'User-Agent': UA },
  });
  if (!resp.ok) throw new Error(`topps products.json HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.products || []).map((p) => ({
    id: `now-${p.id}`,
    name: p.title,
    brand: p.vendor || 'Topps',
    price: p.variants && p.variants[0] ? parseFloat(p.variants[0].price) : null,
    inStock: (p.variants || []).some((v) => v.available),
    url: `${cfg.site}/products/${p.handle}`,
    image: p.images && p.images[0] ? p.images[0].src : null,
    meta: { productType: p.product_type || 'Trading Cards', typeCategory: 'card' },
  }));
}

// Runs inside the page. Groups tiles by product link, then walks up from each
// link until the surrounding card (has a £ price and a cart/sold-out control)
// is in view — without walking so far it swallows the whole grid.
function extractTiles() {
  const byHref = new Map();
  for (const a of document.querySelectorAll('a[href*="/products/"]')) {
    const href = a.href.split('?')[0];
    if (byHref.has(href)) continue;
    let node = a;
    let card = null;
    for (let i = 0; i < 7 && node.parentElement; i++) {
      node = node.parentElement;
      const links = new Set(
        [...node.querySelectorAll('a[href*="/products/"]')].map((l) => l.href.split('?')[0])
      );
      if (links.size > 1) break; // reached the grid
      const t = node.innerText || '';
      if (/£/.test(t) && /(add to cart|add to bag|sold out|out of stock|notify)/i.test(t)) {
        card = node;
        break;
      }
      card = node;
    }
    if (!card) continue;
    const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
    const img = card.querySelector('img');
    const priceMatch = text.match(/£\s*([\d,]+(?:\.\d{1,2})?)/);
    byHref.set(href, {
      href,
      name: (img && img.alt) || text.split('£')[0].trim() || href.split('/').pop(),
      price: priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null,
      inStock: /(add to cart|add to bag)/i.test(text) && !/sold out|out of stock/i.test(text),
      image: img ? img.currentSrc || img.src || null : null,
    });
  }
  return [...byHref.values()];
}

const CHALLENGE_TITLE = /just a moment|attention required/i;

async function fetchCollections(target, cfg) {
  const { chromium } = require('playwright');
  const path = require('path');
  // Since ~Sep 2026 Cloudflare blocks every headless flavour here (bundled
  // Chromium gets an interactive Turnstile, Chrome's own headless a flat 403),
  // but real *headed* Chrome passes the silent JS check. So: installed Google
  // Chrome, headed, window parked offscreen. No UA override — a spoofed UA on
  // real Chrome contradicts its brand hints and re-trips the detection.
  //
  // The profile is PERSISTENT (.chrome-profile/, gitignored): Cloudflare's
  // clearance cookie sticks to it, so every run looks like the same returning
  // browser instead of a fresh anonymous one — fresh contexts on every run is
  // what got the IP challenge-flagged. If a run still logs a challenge, run
  // `node tools/topps-verify.js` once and click the checkbox.
  let context;
  try {
    context = await chromium.launchPersistentContext(
      path.join(__dirname, '..', '.chrome-profile'),
      {
        channel: cfg.channel,
        headless: false,
        viewport: null,
        locale: 'en-GB',
        args: ['--window-position=-2400,-2400'],
      }
    );
  } catch (e) {
    throw new Error(
      `couldn't launch "${cfg.channel}" (${e.message.split('\n')[0]}) — collections mode ` +
        'needs Google Chrome installed and a logged-in GUI session (Cloudflare blocks headless)'
    );
  }
  const items = new Map();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    for (const slug of target.collections || []) {
      // Renders flake empty intermittently, so an empty result gets one retry
      // before we accept it (a truly empty collection just costs one extra
      // page load).
      let tiles = [];
      for (let attempt = 1; attempt <= 2; attempt++) {
        const page = await context.newPage();
        try {
          await page.goto(`${cfg.site}/collections/${slug}`, {
            waitUntil: 'domcontentloaded', // networkidle never settles (chat widget + beacons)
            timeout: 45000,
          });
          // give Cloudflare's silent check time to clear and tiles time to appear
          await page
            .waitForSelector('a[href*="/products/"]', { timeout: 20000 })
            .catch(() => {});
          if (CHALLENGE_TITLE.test(await page.title())) {
            // interactive challenge: it won't clear on its own, and every
            // collection would hit it — bail out with instructions instead
            // of hammering Cloudflare further
            throw Object.assign(
              new Error(
                'Cloudflare challenge page — run `node tools/topps-verify.js`, click the ' +
                  '"Verify you are human" checkbox in the window it opens, then rerun'
              ),
              { challenge: true }
            );
          }
          // nudge lazy-loaded tiles into rendering
          await page.mouse.wheel(0, 2500).catch(() => {});
          await page.waitForTimeout(1500);
          try {
            tiles = await page.evaluate(extractTiles);
          } catch {
            // the silent check can navigate the page mid-evaluate; settle, retry once
            await page.waitForTimeout(3000);
            tiles = await page.evaluate(extractTiles);
          }
        } catch (e) {
          if (e.challenge) {
            await page.close().catch(() => {});
            throw e; // every collection would hit it — stop the whole target
          }
          const msg = page.isClosed()
            ? 'Chrome window was closed mid-check — leave the watcher\'s Chrome alone, it quits by itself'
            : e.message;
          console.error(`  [topps] collection "${slug}" attempt ${attempt} failed: ${msg}`);
        } finally {
          await page.close().catch(() => {});
        }
        if (tiles.length > 0) break;
        await sleep(4000);
      }
      console.log(`  [topps] ${slug}: ${tiles.length} tiles`);
      for (const t of tiles) {
        const handle = t.href.split('/products/')[1];
        if (!handle || items.has(handle)) continue;
        items.set(handle, {
          id: handle,
          name: t.name,
          brand: 'Topps',
          price: t.price,
          inStock: t.inStock,
          url: t.href,
          image: t.image,
          meta: { productType: 'Trading Cards', typeCategory: 'card', collection: slug },
        });
      }
      await sleep(3000);
    }
  } finally {
    await context.close();
  }
  return [...items.values()];
}

async function fetchItems(target, config) {
  const cfg = { ...DEFAULTS, ...((config.adapters || {}).topps || {}) };
  if (target.mode === 'now') return fetchNow(cfg);
  if (target.mode === 'collections') return fetchCollections(target, cfg);
  throw new Error(`topps target needs mode "now" or "collections", got "${target.mode}"`);
}

module.exports = { fetchItems };
