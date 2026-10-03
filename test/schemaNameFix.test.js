const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveExactName } = require('../modules/schemaNameFix');

// Minimal stand-in for the tf2-schema item lookup.
const ITEMS = {
  'haunted hoard case': { defindex: 5981, item_quality: 6 },
  'frostbite fit': { defindex: 31500, item_quality: 6 },
  shotgun: { defindex: 9, item_quality: 0 },
};
const schema = { getItemByItemName: (n) => ITEMS[n.toLowerCase()] || null };

test('crate whose name starts with a quality word keeps its series', () => {
  assert.equal(resolveExactName(schema, 'Haunted Hoard Case #153'), '5981;6;c153');
});

test('cosmetic whose name starts with an effect word resolves as Unique', () => {
  assert.equal(resolveExactName(schema, 'Frostbite Fit'), '31500;6');
});

test('stock-quality items fall back to Unique', () => {
  assert.equal(resolveExactName(schema, 'Shotgun'), '9;6');
});

test('unknown names stay unresolved', () => {
  assert.equal(resolveExactName(schema, 'Hoard Case #153'), null);
});
