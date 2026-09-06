// Panini UK adapter (panini.co.uk, Magento). Category pages are fully
// server-rendered, so this is plain HTTPS + regex over the product grid —
// no browser, cloud-friendly. GraphQL is WAF-blocked, but the HTML isn't.
//
// Uses node:https instead of fetch: Panini's response headers blow past
// undici's 16KB header cap (UND_ERR_HEADERS_OVERFLOW), and the store
// occasionally bounces through a store-selection 302 that needs its cookies
// carried to the next hop.

const https = require('https');

const DEFAULTS = {
  site: 'https://www.panini.co.uk/shp_gbr_en',
  maxPages: 4, // safety cap per category; page size is 12
};

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getOnce(url, cookies) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        maxHeaderSize: 64 * 1024,
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'en-GB',
          ...(cookies.size ? { Cookie: [...cookies.values()].join('; ') } : {}),
        },
      },
      (res) => {
        for (const c of res.headers['set-cookie'] || []) {
          const pair = c.split(';')[0];
          cookies.set(pair.split('=')[0], pair);
        }
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () =>
          resolve({ status: res.statusCode, location: res.headers.location, body })
        );
      }
    );
    req.on('error', reject);
    req.setTimeout(45000, () => req.destroy(new Error('timeout')));
  });
}

async function get(url) {
  const cookies = new Map();
  for (let hop = 0; hop < 5; hop++) {
    const resp = await getOnce(url, cookies);
    if (resp.status >= 300 && resp.status < 400 && resp.location) {
      url = new URL(resp.location, url).href;
      continue;
    }
    return resp;
  }
  throw new Error('too many redirects');
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x20;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function parseTiles(html, category) {
  const items = [];
  for (const block of html.match(/<li class="item product product-item[\s\S]*?<\/li>/g) || []) {
    // the second product-item-link (inside <h3>) carries the name text
    const link = block.match(
      /<a class="product-item-link"\s+href="([^"]+)">\s*([\s\S]*?)\s*<\/a>/
    );
    if (!link) continue;
    const sku = (block.match(/data-product-sku="([^"]+)"/) || [])[1];
    const price = (block.match(/data-price-amount="([^"]+)"/) || [])[1];
    const image = (block.match(/class="product-image-photo"\s+src="([^"]+)"/) || [])[1];
    const typology = (block.match(/attribute-typology">\s*<small>([^<]*)<\/small>/) || [])[1];
    const url = link[1].split('?')[0];
    items.push({
      id: sku || url.split('/').pop().replace(/\.html$/, ''),
      name: decodeEntities(link[2].replace(/\s+/g, ' ').trim()),
      brand: 'Panini',
      price: price ? parseFloat(price) : null,
      inStock:
        /data-role="tocart-form"/.test(block) && !/stock unavailable|out-of-stock/i.test(block),
      url,
      image: image ? decodeEntities(image) : null,
      meta: {
        productType: typology || 'Collectables',
        typeCategory: 'card',
        category,
      },
    });
  }
  return items;
}

async function fetchCategory(category, cfg) {
  const items = new Map();
  for (let page = 1; page <= cfg.maxPages; page++) {
    const url = `${cfg.site}/${category}.html${page > 1 ? `?p=${page}` : ''}`;
    const resp = await get(url);
    if (resp.status !== 200) throw new Error(`panini ${category} p${page}: HTTP ${resp.status}`);
    const tiles = parseTiles(resp.body, category);
    const before = items.size;
    for (const t of tiles) if (!items.has(t.id)) items.set(t.id, t);
    // stop on an empty page or a page of pure repeats (past the last page,
    // Magento re-serves page 1)
    if (tiles.length === 0 || items.size === before) break;
    if (tiles.length < 12) break;
    await sleep(800);
  }
  return [...items.values()];
}

async function fetchItems(target, config) {
  const cfg = { ...DEFAULTS, ...((config.adapters || {}).panini || {}) };
  const items = new Map();
  for (const category of target.categories || []) {
    for (const item of await fetchCategory(category, cfg)) {
      if (!items.has(item.id)) items.set(item.id, item);
    }
    await sleep(800);
  }
  return [...items.values()];
}

module.exports = { fetchItems };
