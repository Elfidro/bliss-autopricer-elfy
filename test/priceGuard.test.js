const test = require('node:test');
const assert = require('node:assert/strict');
const { guardPrice } = require('../modules/priceGuard');

test('raises a sell that is under the best bid to the market sell', () => {
  // Aristocravat: pricelist 3.5 / 3.83, bids at 5.11, one ask at 6.33.
  const fix = guardPrice({ buy: 3.5, sell: 3.83, bid: 5.11, marketSell: 6.33 });
  assert.equal(fix.buy, 3.5);
  assert.equal(fix.sell, 6.33);
  assert.match(fix.reason, /sell 3\.83 ref was under the 5\.11 ref best bid/);
});

test('with no market sell, raises the sell one weapon over the bid', () => {
  const fix = guardPrice({ buy: 1.33, sell: 1.44, bid: 1.55, marketSell: null });
  assert.equal(fix.buy, 1.33);
  assert.equal(fix.sell, 1.61);
});

test('lowers a buy that is over the market sell to the best bid', () => {
  const fix = guardPrice({ buy: 7, sell: 8, bid: 5.11, marketSell: 6.33 });
  assert.equal(fix.buy, 5.11);
  assert.equal(fix.sell, 8);
  assert.match(fix.reason, /buy 7 ref was over the 6\.33 ref market sell/);
});

test('with no bid, lowers the buy one weapon under the market sell, never under 0.05', () => {
  assert.deepEqual(pick(guardPrice({ buy: 7, sell: 8, bid: null, marketSell: 6.33 })), {
    buy: 6.27,
    sell: 8,
  });
  assert.deepEqual(pick(guardPrice({ buy: 0.11, sell: 0.16, bid: null, marketSell: 0.05 })), {
    buy: 0.05,
    sell: 0.16,
  });
});

test('fixes both sides at once', () => {
  const fix = guardPrice({ buy: 7, sell: 4, bid: 5.11, marketSell: 6.33 });
  assert.equal(fix.buy, 5.11);
  assert.equal(fix.sell, 6.33);
  assert.match(fix.reason, /buy .*; sell /);
});

test('the raised sell clears the buy', () => {
  // Bid 5.11 but we buy at 6 and there is no ask: the sell goes a weapon
  // over the buy, not just over the bid.
  const fix = guardPrice({ buy: 6, sell: 3.83, bid: 5.11, marketSell: null });
  assert.equal(fix.buy, 6);
  assert.equal(fix.sell, 6.05);
  assert.ok(fix.sell > fix.buy);
});

test('nothing to fix', () => {
  assert.equal(guardPrice({ buy: 5, sell: 6.5, bid: 5.11, marketSell: 6.33 }), null);
  // Selling at the bid or buying at the market sell is not a crossing.
  assert.equal(guardPrice({ buy: 6.33, sell: 6.5, bid: 5.11, marketSell: 6.33 }), null);
  assert.equal(guardPrice({ buy: 4, sell: 5.11, bid: 5.11, marketSell: 6.33 }), null);
  // No market at all.
  assert.equal(guardPrice({ buy: 4, sell: 5, bid: null, marketSell: null }), null);
  // Unusable prices.
  assert.equal(guardPrice({ buy: 0, sell: 5, bid: 6, marketSell: 7 }), null);
  assert.equal(guardPrice({}), null);
});

function pick(fix) {
  return { buy: fix.buy, sell: fix.sell };
}
