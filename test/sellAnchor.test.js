const test = require('node:test');
const assert = require('node:assert/strict');
const { anchorSell } = require('../modules/sellAnchor');

test('caps an ask far above the buy with enough bids', () => {
  // The Triple Jumper: buy 23.66, junk asks at 52 ref.
  const r = anchorSell({ buyMetal: 23.66, sellMetal: 52, nBids: 19 });
  assert.equal(r.capped, true);
  assert.ok(r.sellMetal < 52 && r.sellMetal <= 23.66 * 1.6);
});

test('too few bids: not capped, unless the ask is junk', () => {
  const input = { buyMetal: 3.33, sellMetal: 49, nBids: 2, anchorSellMetal: 3.5 };
  assert.equal(anchorSell(input).capped, false);

  // Two honest bids under a 49 ref junk ask: the ask is not the market.
  // Cap = max(3.33 x 1.6, 3.33 + 0.66, 3.5 x 1.25) = 5.328, down to 5.27.
  const r = anchorSell({ ...input, junkAsk: true });
  assert.equal(r.capped, true);
  assert.equal(r.sellMetal, 5.27);
});

test('our own 24 h median sell raises the cap like the baseline does', () => {
  const input = { buyMetal: 10, sellMetal: 30, nBids: 5 };
  // Without it: cap 16.
  assert.equal(anchorSell(input).sellMetal, 16);
  // With a 20 ref median sell: cap 20 x 1.25 = 25.
  assert.equal(anchorSell({ ...input, anchorSellMetal: 20 }).sellMetal, 25);
  // A median above the ask never raises the sell.
  const r = anchorSell({ ...input, anchorSellMetal: 40 });
  assert.equal(r.capped, false);
  assert.equal(r.sellMetal, 30);
});

test('disabled or unusable input leaves the sell alone', () => {
  assert.equal(
    anchorSell({ buyMetal: 1, sellMetal: 50, nBids: 9 }, { enabled: false }).capped,
    false
  );
  assert.equal(anchorSell({ buyMetal: 0, sellMetal: 50, nBids: 9 }).capped, false);
});
