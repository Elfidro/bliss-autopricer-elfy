const test = require('node:test');
const assert = require('node:assert/strict');
const { pruneStaleEntries } = require('../modules/pricelistPrune');

const entry = (name, sku) => ({
  name,
  sku,
  buy: { keys: 0, metal: 1 },
  sell: { keys: 0, metal: 2 },
});
const SKUS = {
  'Frostbite Fit': '31519;5;u87',
  'Haunted Hoard Case #153': '6522;6;c153',
  'Strange Shotgun': '199;11',
  'Mann Co. Supply Crate Key': '5021;6',
};
const resolveSku = (name) => SKUS[name] || null;

test('drops entries whose name is no longer in the item list', () => {
  const items = [entry('Strange Shotgun', '199;11'), entry('Frostbite Fit', '31519;5;u87')];
  const r = pruneStaleEntries(items, { allowed: new Set(['Frostbite Fit']), resolveSku });
  assert.deepEqual(
    r.items.map((i) => i.sku),
    ['31519;5;u87']
  );
  assert.equal(r.notAllowed, 1);
  assert.equal(r.brokenSku, 0);
});

test('drops entries under a sku containing null', () => {
  const items = [
    entry('Frostbite Fit', 'null;5;u87'),
    entry('Frostbite Fit', '31519;5;u87'),
    entry('Haunted Hoard Case #153', 'null;13'),
  ];
  const allowed = new Set(['Frostbite Fit', 'Haunted Hoard Case #153']);
  const r = pruneStaleEntries(items, { allowed, resolveSku });
  assert.deepEqual(
    r.items.map((i) => i.sku),
    ['31519;5;u87']
  );
  assert.equal(r.brokenSku, 2);
});

test('drops an entry whose name now resolves to another sku that has an entry', () => {
  const allowed = new Set(['Haunted Hoard Case #153']);
  const items = [
    entry('Haunted Hoard Case #153', '6522;6'),
    entry('Haunted Hoard Case #153', '6522;6;c153'),
  ];
  const r = pruneStaleEntries(items, { allowed, resolveSku });
  assert.deepEqual(
    r.items.map((i) => i.sku),
    ['6522;6;c153']
  );
  assert.equal(r.brokenSku, 1);

  // Without an entry under the resolved sku the old one stays (it is the
  // only price the item has).
  const alone = pruneStaleEntries([entry('Haunted Hoard Case #153', '6522;6')], {
    allowed,
    resolveSku,
  });
  assert.equal(alone.items.length, 1);
  // A name that does not resolve (or throws) changes nothing.
  const unresolved = pruneStaleEntries([entry('Mystery Hat', '1;6'), entry('Other', '2;6')], {
    allowed: new Set(['Mystery Hat', 'Other']),
    resolveSku: (n) => {
      if (n === 'Other') {
        throw new Error('schema');
      }
      return null;
    },
  });
  assert.equal(unresolved.items.length, 2);
});

test('keeps the key whatever the list says, and allowed=null skips the list rule', () => {
  const items = [entry('Mann Co. Supply Crate Key', '5021;6'), entry('Strange Shotgun', '199;11')];
  const r = pruneStaleEntries(items, { allowed: new Set(), resolveSku });
  assert.deepEqual(
    r.items.map((i) => i.sku),
    ['5021;6']
  );
  const all = pruneStaleEntries(items, { allowed: null, resolveSku });
  assert.equal(all.items.length, 2);
});

test('a name the resolver cannot place (a "null" sku from a stale schema) never prunes an entry', () => {
  const items = [
    { name: 'Alpine Apparel', sku: '31583;6', buy: {}, sell: {} },
    { name: 'Broken', sku: 'null;6', buy: {}, sell: {} },
  ];
  const out = pruneStaleEntries(items, {
    allowed: new Set(['Alpine Apparel', 'Broken']),
    resolveSku: () => 'null;6',
  });
  assert.deepEqual(out.items.map((i) => i.sku), ['31583;6']);
  assert.equal(out.brokenSku, 1);
});
