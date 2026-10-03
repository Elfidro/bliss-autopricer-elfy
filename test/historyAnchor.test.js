// The 24 h history anchor against the Sep 28-30 pump (Snug Sharpshooter,
// Bigger Mann on Campus): see modules/historyAnchor.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { anchorCeiling, rampCap, loadAnchors } = require('../modules/historyAnchor');
const { chooseMarket } = require('../modules/marketPrice');

const times = (price, n) => Array(n).fill(price);

test('Snug Sharpshooter under attack: fake bids dropped, junk ask flagged', () => {
  // The honest asks were bought out; only junk asks at 49-50 remain, and two
  // fake bids at 18-20 sit under them. Our own 24 h median is 3.4 / 3.5.
  const m = chooseMarket([49, 50], [20, 18, 3.33, 3.27, 3.22], { anchorSell: 3.5 });
  assert.equal(m.bidCeiling, 5.25);
  assert.deepEqual(m.bids, [3.33, 3.27, 3.22]);
  assert.equal(m.nBids, 3);
  assert.equal(m.bid, 3.33);
  assert.equal(m.droppedAboveAnchor, 2);
  assert.equal(m.junkAsk, true);
  assert.equal(m.locked, false);
});

test('a lone bid 10% under a junk ask is not supported by it', () => {
  const m = chooseMarket([49], [45], { anchorSell: 3.5 });
  assert.equal(m.bid, null);
  assert.equal(m.nBids, 0);
  assert.equal(m.droppedAboveAnchor, 1);
  assert.equal(m.junkAsk, true);
});

test('the creep is ramp-capped', () => {
  // Anchor buy 3.4, market bid 6.5: 3.4 x 1.25 = 4.25, down to a weapon 4.22.
  const cap = rampCap({ buy: 3.4, sell: 3.5 });
  assert.equal(cap, 4.22);
  assert.ok(6.5 > cap);
});

test('a legitimate move is not capped (Field Fatigues)', () => {
  const anchor = { buy: 30, sell: 31 };
  assert.equal(anchorCeiling(anchor), 46.5);
  const m = chooseMarket([37], times(36.5, 3), { anchorSell: anchor.sell });
  assert.equal(m.bid, 36.5);
  assert.equal(m.junkAsk, false);
  assert.equal(m.droppedAboveAnchor, 0);
  assert.equal(m.sell, 37);
  const cap = rampCap(anchor);
  assert.equal(cap, 37.5);
  assert.ok(m.bid <= cap, 'the buy is not capped');
});

test('no asks: the anchor ceiling alone limits the bids', () => {
  const m = chooseMarket([], [20, 3.3, 3.2], { anchorSell: 3.5 });
  assert.equal(m.bidCeiling, 5.25);
  assert.deepEqual(m.bids, [3.3, 3.2]);
  assert.equal(m.droppedAboveAnchor, 1);
  assert.equal(m.junkAsk, false);
  assert.equal(m.sellFrom, 'none');

  const none = chooseMarket([], [20, 3.3, 3.2]);
  assert.equal(none.bidCeiling, Infinity);
  assert.equal(none.droppedAboveAnchor, 0);
});

test('without an anchor, a lone ask does not support a bid near it', () => {
  // No second ask within 10% of 19.33: the ask is not credible, so the lone
  // 19.22 bid is not copied.
  assert.equal(chooseMarket([19.33], [19.22, 2.88]).bid, 2.88);
  // 19.55 backs the 19.33 ask (Standing Offer).
  assert.equal(chooseMarket([19.33, 19.55], [19.22, 2.88]).bid, 19.22);
  // A second ask more than 10% up does not.
  assert.equal(chooseMarket([19.33, 22], [19.22, 2.88]).bid, 2.88);
  // With an anchor, an ask under the anchor ceiling is credible on its own.
  assert.equal(chooseMarket([19.33], [19.22, 2.88], { anchorSell: 19 }).bid, 19.22);
});

test('anchorCeiling: the larger of +50% and +0.33 ref', () => {
  assert.equal(anchorCeiling(null), null);
  assert.equal(anchorCeiling({ buy: 1, sell: 0 }), null);
  assert.equal(anchorCeiling({ buy: 3.4, sell: 3.5 }), 5.25);
  // Cheap item: 0.5 x 1.5 = 0.75 < 0.5 + 0.33.
  assert.ok(Math.abs(anchorCeiling({ buy: 0.4, sell: 0.5 }) - 0.83) < 1e-9);
  assert.equal(anchorCeiling({ buy: 3.4, sell: 3.5 }, { maxBidAbovePct: 1 }), 7);
});

test('rampCap: the larger of +25% and +0.33 ref, rounded down to a weapon', () => {
  assert.equal(rampCap(null), null);
  assert.equal(rampCap({ buy: 0, sell: 1 }), null);
  // 0.77 ref is 14 weapons; + 0.33 (6 weapons) = 20 weapons = 1.11, which
  // beats 0.77 x 1.25 = 0.96.
  assert.equal(rampCap({ buy: 0.77, sell: 0.88 }), 1.11);
  assert.equal(rampCap({ buy: 30, sell: 31 }), 37.5);
  assert.equal(rampCap({ buy: 3.4, sell: 3.5 }, { maxBuyRisePct: 0.5 }), 5.05);
});

test('loadAnchors: one query, medians as numbers, off when disabled', async () => {
  const calls = [];
  const db = {
    any: async (sql, params) => {
      calls.push({ sql, params });
      return [
        { sku: '31516;6', buy: '3.4', sell: '3.5', n: '96' },
        { sku: 'bad', buy: '0', sell: '1', n: '10' },
      ];
    },
  };
  const anchors = await loadAnchors(db, { windowHours: 12, minRows: 5 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [12, 5]);
  assert.match(calls[0].sql, /percentile_cont\(0\.5\)/);
  assert.deepEqual(anchors.get('31516;6'), { buy: 3.4, sell: 3.5, n: 96 });
  assert.equal(anchors.has('bad'), false);

  const off = await loadAnchors(db, { enabled: false });
  assert.equal(off.size, 0);
  assert.equal(calls.length, 1);
});
