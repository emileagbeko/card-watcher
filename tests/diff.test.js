// Synthetic test of the alert diff logic — covers paths that can't be
// tested against live data on demand (restock, price drop).
const assert = require('assert');
const { diff } = require('../watcher.js');

const config = { priceDropPct: 10 };
const item = (id, over = {}) => ({
  id,
  name: `Item ${id}`,
  price: 10,
  inStock: true,
  url: `https://example.com/${id}`,
  ...over,
});

// 1) First run: seeds baseline, no alerts
let state = { items: {} };
let r = diff([item('a'), item('b')], state, config, false);
assert.strictEqual(r.events.length, 0, 'first run must not alert');
assert.strictEqual(r.firstRun, true);
assert.ok(state.items.a && state.items.b, 'baseline seeded');

// 2) New item appears
r = diff([item('a'), item('b'), item('c')], state, config, false);
assert.deepStrictEqual(r.events.map((e) => e.type), ['new']);
assert.strictEqual(r.events[0].item.id, 'c');

// 3) Restock: b goes OOS silently, then comes back
diff([item('a'), item('b', { inStock: false }), item('c')], state, config, false);
r = diff([item('a'), item('b'), item('c')], state, config, false);
assert.deepStrictEqual(r.events.map((e) => e.type), ['restock']);
assert.strictEqual(r.events[0].item.id, 'b');

// 4) Price drop beyond threshold fires; small drop doesn't
r = diff([item('a', { price: 9.5 }), item('b'), item('c')], state, config, false);
assert.strictEqual(r.events.length, 0, '5% drop is under the 10% threshold');
r = diff([item('a', { price: 7 }), item('b'), item('c')], state, config, false);
assert.deepStrictEqual(r.events.map((e) => e.type), ['price_drop']);
assert.strictEqual(r.events[0].oldPrice, 9.5);

// 5) Null prices never fire price alerts
r = diff([item('a', { price: null }), item('b'), item('c')], state, config, false);
assert.strictEqual(r.events.length, 0);

// 6) Baseline mode records but never alerts
r = diff([item('a'), item('b'), item('c'), item('d')], state, config, true);
assert.strictEqual(r.events.length, 0, 'baseline mode must not alert');
assert.ok(state.items.d, 'baseline mode still records new items');

console.log('all diff tests passed');
