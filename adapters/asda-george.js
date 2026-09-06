// Asda (George) adapter.
// George's own frontend searches via a public Algolia index; we query the same
// API the site uses. No HTML scraping, and very light on their infrastructure.
// If the embedded public key ever rotates, run: node tools/refresh-asda-key.js

const DEFAULTS = {
  appId: '1KBYJ8SZ65',
  apiKey: 'fea321f42e897ee5331d030d1ca9c464',
  index: 'asda_prod__products__default',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toItem(hit) {
  return {
    id: hit.objectID,
    name: hit.name,
    brand: hit.brand || '',
    price: typeof hit.current_price === 'number' ? hit.current_price : null,
    inStock: hit.in_stock === true,
    url: `https://direct.asda.com/george/${hit.objectID},default,pd.html`,
    image: hit.primary_image
      ? `https://asda.scene7.com/is/image/Asda/${hit.primary_image}?wid=600`
      : null,
    meta: {
      licence: hit.licence || '',
      productType: hit.product_type || '',
      typeCategory: hit.type || '',
      firstPublished: hit.firstPublishedDate || null,
    },
  };
}

async function fetchItems(target, config) {
  const cfg = { ...DEFAULTS, ...((config.adapters || {})['asda-george'] || {}) };
  const url = `https://${cfg.appId}-dsn.algolia.net/1/indexes/${cfg.index}/query`;
  const seen = new Map();

  for (const query of target.queries || []) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Algolia-Application-Id': cfg.appId,
        'X-Algolia-API-Key': cfg.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, hitsPerPage: 100 }),
    });
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(
        'Algolia key rejected (probably rotated). Run: node tools/refresh-asda-key.js'
      );
    }
    if (!resp.ok) throw new Error(`Algolia HTTP ${resp.status} for query "${query}"`);
    const data = await resp.json();
    for (const hit of data.hits || []) {
      if (hit.online === false) continue;
      if (!seen.has(hit.objectID)) seen.set(hit.objectID, toItem(hit));
    }
    await sleep(600);
  }
  return [...seen.values()];
}

module.exports = { fetchItems };
