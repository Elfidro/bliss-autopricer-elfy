// The 24 h history anchor against the Sep 28-30 pump (Snug Sharpshooter,
// Bigger Mann on Campus): see modules/historyAnchor.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  anchorCeiling,
  rampCap,
  loadAnchors,
  hardBuyCap,
  hardSellCap,
  limitSell,
} = require('../modules/historyAnchor');
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
        // Both windows.
        {
          sku: '31516;6',
          buy: '3.4',
          sell: '3.5',
          n: '96',
          long_buy: '3.3',
          long_sell: '3.45',
          long_n: '600',
        },
        // Enough rows for the 24 h anchor, not for the long one.
        {
          sku: 'new',
          buy: '2',
          sell: '2.2',
          n: '20',
          long_buy: '2',
          long_sell: '2.2',
          long_n: '20',
        },
        // Long anchor only (not priced in the last 24 h).
        {
          sku: 'idle',
          buy: null,
          sell: null,
          n: '0',
          long_buy: '9',
          long_sell: '10',
          long_n: '200',
        },
        // Unusable medians.
        { sku: 'bad', buy: '0', sell: '1', n: '10', long_buy: '0', long_sell: '1', long_n: '10' },
      ];
    },
  };
  const anchors = await loadAnchors(db, { windowHours: 12, minRows: 5 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [12, 5, 168, 96]);
  assert.match(calls[0].sql, /percentile_cont\(0\.5\)/);
  assert.match(calls[0].sql, /FILTER/);
  assert.deepEqual(anchors.get('31516;6'), {
    buy: 3.4,
    sell: 3.5,
    n: 96,
    longBuy: 3.3,
    longSell: 3.45,
    longN: 600,
  });
  assert.deepEqual(anchors.get('new'), {
    buy: 2,
    sell: 2.2,
    n: 20,
    longBuy: null,
    longSell: null,
    longN: 20,
  });
  assert.deepEqual(anchors.get('idle'), {
    buy: null,
    sell: null,
    n: 0,
    longBuy: 9,
    longSell: 10,
    longN: 200,
  });
  assert.equal(anchors.has('bad'), false);

  const off = await loadAnchors(db, { enabled: false });
  assert.equal(off.size, 0);
  assert.equal(calls.length, 1);
});

test('hard caps: 2x the long median, rounded down to a weapon', () => {
  const anchor = { buy: 6.5, sell: 7, longBuy: 3.4, longSell: 3.6 };
  // 3.4 ref is 61 weapons (3.38); x2 = 122 weapons = 6.77. 3.6 is 65 (3.61);
  // x2 = 130 = 7.22.
  assert.equal(hardBuyCap(anchor), 6.77);
  assert.equal(hardSellCap(anchor), 7.22);
  assert.equal(hardBuyCap({ longBuy: 30, longSell: 31 }), 60);
  assert.equal(hardBuyCap({ longBuy: 30, longSell: 31 }, { hardCapMultiplier: 1.5 }), 45);
  // No long anchor (or none at all): no hard cap.
  assert.equal(hardBuyCap({ buy: 3.4, sell: 3.5, longBuy: null, longSell: null }), null);
  assert.equal(hardSellCap({ buy: 3.4, sell: 3.5 }), null);
  assert.equal(hardBuyCap(null), null);
});

test('a pump that already moved the 24 h median is stopped by the hard cap', () => {
  // 24 h median 6.5 / 7 (pumped), 7-day median 3.4 / 3.6.
  const anchor = { buy: 6.5, sell: 7, longBuy: 3.4, longSell: 3.6 };
  const opts = { anchorSell: anchor.sell, hardBuyCap: hardBuyCap(anchor) };
  // The 24 h ceiling is 7 x 1.5 = 10.5; the hard cap 6.77 is lower.
  const m = chooseMarket([49], [8, 7.9, 6.6], opts);
  assert.equal(m.bidCeiling, 6.77);
  assert.deepEqual(m.bids, [6.6]);
  assert.equal(m.droppedAboveAnchor, 2);
  assert.equal(m.bid, 6.6);
  assert.ok(m.bid <= rampCap(anchor) && m.bid <= hardBuyCap(anchor), 'under both caps');

  // Bids at 7.2 are over the hard cap: chooseMarket drops them, and a buy
  // of 7.2 reached any other way is cut to the cap in getAverages.
  const over = chooseMarket([49], [7.2, 7.2], opts);
  assert.equal(over.bid, null);
  assert.equal(over.droppedAboveAnchor, 2);
  assert.equal(Math.min(7.2, hardBuyCap(anchor)), 6.77);
});

test('limitSell: caps the sell unless the cap would meet the buy', () => {
  assert.deepEqual(limitSell(49, 3.33, 7.22), { sell: 7.22, capped: true, blocked: false });
  // Under the cap: nothing to do.
  assert.deepEqual(limitSell(5, 3.33, 7.22), { sell: 5, capped: false, blocked: false });
  // The cap would equal the buy: leave the sell alone.
  assert.deepEqual(limitSell(9, 7.22, 7.22), { sell: 9, capped: false, blocked: true });
  // One weapon over the buy is enough.
  assert.deepEqual(limitSell(9, 7.16, 7.22), { sell: 7.22, capped: true, blocked: false });
  // No long anchor: nothing changes.
  assert.deepEqual(limitSell(49, 3.33, null), { sell: 49, capped: false, blocked: false });
});

test('no long anchor: chooseMarket is unchanged', () => {
  const book = [
    [49, 50],
    [20, 18, 3.33, 3.27, 3.22],
  ];
  const a = chooseMarket(...book, { anchorSell: 3.5 });
  const b = chooseMarket(...book, { anchorSell: 3.5, hardBuyCap: null });
  assert.deepEqual(a, b);
  // Only a long anchor: the hard cap alone is the bid ceiling, the ask is
  // judged by the no-anchor rule.
  const c = chooseMarket([10, 10.5], [25, 9.9, 9.8], { hardBuyCap: 20 });
  assert.equal(c.bidCeiling, 10.5);
  assert.equal(c.bid, 9.9);
  assert.equal(c.junkAsk, false);
  const d = chooseMarket([], [25, 9.9, 9.8], { hardBuyCap: 20 });
  assert.equal(d.bidCeiling, 20);
  assert.equal(d.droppedAboveAnchor, 1);
});
