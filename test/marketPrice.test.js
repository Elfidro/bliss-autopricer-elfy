// Market model tests. The books are real backpack.tf books (metal, bids
// descending, asks ascending) that the old mean-of-top-3 / cut-the-buy-3%
// rules priced wrong; see the comments in modules/marketPrice.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chooseAskIndex,
  robustBestBid,
  chooseMarket,
  marketOptions,
} = require('../modules/marketPrice');

const times = (price, n) => Array(n).fill(price);

// Each case: the book and the buy (bid) / sell the pricer should pick.
const BOOKS = [
  {
    name: 'Standing Offer: a lone top bid 1% under the ask is the price',
    bids: [19.22, 15, 2.88],
    asks: [19.33, 19.55, 35.33],
    bid: 19.22,
    sell: 19.33,
    sellFrom: 'ask',
  },
  {
    name: 'Cigarillo Caballero: two bidders at the top',
    bids: [43.33, 43.33, 38.11, 38.11, 24, ...times(17.66, 7)],
    asks: [47.72, 47.83],
    bid: 43.33,
    sell: 47.72,
    sellFrom: 'ask',
  },
  {
    name: 'Sir Buildsalot: two bidders at the top over a pack',
    bids: [16.11, 16.11, 13.44, 13.44, 13.44, 4, 4],
    asks: [16.22],
    bid: 16.11,
    sell: 16.22,
    sellFrom: 'ask',
  },
  {
    name: 'Slumber Slacks: 24.33 supports 24.44',
    bids: [24.44, 24.33, ...times(22.44, 8)],
    asks: [24.55],
    bid: 24.44,
    sell: 24.55,
    sellFrom: 'ask',
  },
  {
    name: 'The Triple Jumper: a lone bid far over the pack and under the ask is not copied',
    bids: [23.11, ...times(19.88, 4), 19.83, 19.77],
    asks: [28, 28.11],
    bid: 19.88,
    sell: 28,
    sellFrom: 'ask',
  },
  {
    name: "Crusader's Getup: lone 646.6, pack at 544.28",
    bids: [646.6, 544.28, 544.28, 544.28, 544.16],
    asks: [777.92],
    bid: 544.28,
    sell: 777.92,
    sellFrom: 'ask',
  },
  {
    name: 'The Vascular Vestment: lone 9.77, 7.55 x6 supports 7.66',
    bids: [9.77, 7.66, ...times(7.55, 6)],
    asks: [16],
    bid: 7.66,
    sell: 16,
    sellFrom: 'ask',
  },
  {
    name: 'Backpack Expander: locked, sell at the next ask',
    bids: [...times(29.88, 3), ...times(29.77, 13), 29.22],
    asks: [29.88, 30, 30, 30, 30, 30.22],
    bid: 29.88,
    sell: 30,
    sellFrom: 'next-ask',
    locked: true,
  },
  {
    name: 'Non-Craftable Tour of Duty Ticket: locked at 26',
    bids: [26, ...times(25.94, 3), ...times(25.88, 5)],
    asks: [...times(26, 7), 26.22, 26.33],
    bid: 26,
    sell: 26.22,
    sellFrom: 'next-ask',
    locked: true,
  },
  {
    name: "Veteran's Attire: best bid over the lowest ask",
    bids: [65.54, 65.54, 65.54, 65.43, 65.32],
    asks: [65.32, ...times(68.54, 4)],
    bid: 65.54,
    sell: 68.54,
    sellFrom: 'next-ask',
    locked: true,
  },
  {
    name: 'Private Eye: locked at 1.55',
    bids: times(1.55, 15),
    asks: [1.55, 1.77],
    bid: 1.55,
    sell: 1.77,
    sellFrom: 'next-ask',
    locked: true,
  },
  {
    name: 'Momma Kiev: locked at 15.44',
    bids: [15.44, 15.22, 13.44],
    asks: [15.44, 15.55],
    bid: 15.44,
    sell: 15.55,
    sellFrom: 'next-ask',
    locked: true,
  },
  {
    name: 'Aristocravat: one ask, bids at 5.11',
    bids: [5.11, 5.11, 5, 5, 5, 5, 4.33, 4.11],
    asks: [6.33],
    bid: 5.11,
    sell: 6.33,
    sellFrom: 'ask',
  },
];

for (const book of BOOKS) {
  test(`chooseMarket - ${book.name}`, () => {
    const m = chooseMarket(book.asks, book.bids);
    assert.equal(m.bid, book.bid, 'buy (best supported bid)');
    assert.equal(m.sell, book.sell, 'sell');
    assert.equal(m.sellFrom, book.sellFrom);
    assert.equal(m.locked, !!book.locked);
    assert.equal(book.asks[m.sellIndex], book.sell, 'sellIndex points at the sell ask');
  });
}

test('chooseMarket takes bids in any order and reports them descending', () => {
  const m = chooseMarket([16.22], [4, 13.44, 16.11, 4, 16.11, 13.44, 13.44]);
  assert.equal(m.bid, 16.11);
  assert.deepEqual(m.bids, [16.11, 16.11, 13.44, 13.44, 13.44, 4, 4]);
  assert.equal(m.nBids, 7);
});

test('chooseAskIndex - Defiant Spartan: the bids back the low ask, the junk asks above are outliers', () => {
  const bids = [1.33, 1.27, 1.27, 1.27, 1.22, 1.22, 1.22, 1.22];
  const asks = [1.33, 26, 28];
  assert.equal(chooseAskIndex(asks, bids), 0);
  const m = chooseMarket(asks, bids);
  assert.equal(m.askIndex, 0);
  assert.equal(m.ask, 1.33);
  // The 1.33 bid meets the 1.33 ask, and the next ask (26) is a junk price far
  // over 3x the bid: sell a margin over the bid, 1.33 + 0.11.
  assert.equal(m.bid, 1.33);
  assert.equal(m.locked, true);
  assert.equal(m.sellFrom, 'margin');
  assert.equal(m.sell, 1.44);
  assert.equal(m.sellIndex, -1);
});

test('locked: the next ask is used only within lockedNextAskMaxPct of the bid', () => {
  // 12.44 is 24.4% over the bid: inside the 25% band.
  const inside = chooseMarket([10, 12.44], [10, 10]);
  assert.equal(inside.locked, true);
  assert.equal(inside.sellFrom, 'next-ask');
  assert.equal(inside.sell, 12.44);

  // 29 is under 3x the bid (the old rule) but far outside the band: margin.
  // 3% of 10 is 0.3 ref, which rounds to 0.27 (five weapons) like
  // Methods.getRight, so the sell is 10.27.
  const outside = chooseMarket([10, 29], [10, 10]);
  assert.equal(outside.locked, true);
  assert.equal(outside.sellFrom, 'margin');
  assert.equal(outside.sell, 10.27);
  assert.equal(chooseMarket([10, 31], [10, 10]).sell, 10.27);

  // The band and margins come from the options.
  const wider = chooseMarket([10, 29], [10, 10], { lockedNextAskMaxPct: 2 });
  assert.equal(wider.sell, 29);
  const flat = chooseMarket([10, 31], [10, 10], { marginMetal: 0.5, marginPct: 0 });
  assert.equal(flat.sell, 10.5);
});

test('Fizzy Pharmacist: a locked market with a junk next ask sells at the margin', () => {
  // Bids 23.33 meet the 23.33 ask; the only ask above is 49.33 (111% up).
  const m = chooseMarket([23.33, 49.33], times(23.33, 3));
  assert.equal(m.bid, 23.33);
  assert.equal(m.locked, true);
  assert.equal(m.sellFrom, 'margin');
  // 23.33 + max(0.11, 3% of 23.33 = 0.70 -> 0.72) = 24.05.
  assert.equal(m.sell, 24.05);
});

test('The Lightning Lid: not locked, sells at the honest 36.77 ask', () => {
  const m = chooseMarket([36.77, 36.77, 51.11], times(33.88, 3));
  assert.equal(m.locked, false);
  assert.equal(m.bid, 33.88);
  assert.equal(m.sellFrom, 'ask');
  assert.equal(m.sell, 36.77);
});

test('a bid within lockTolerancePct above the ask is the bid, and the market is locked', () => {
  const m = chooseMarket([10], [10.4, 10.3]);
  assert.deepEqual(m.bids, [10.4, 10.3]);
  assert.equal(m.bid, 10.4);
  assert.equal(m.locked, true);
  assert.equal(m.sellFrom, 'margin');
  assert.ok(m.sell > m.bid);
});

test('chooseAskIndex - Wet Works: an isolated undercut is skipped', () => {
  const bids = times(1.55, 6);
  const asks = [1.66, ...times(4.11, 24)];
  assert.equal(chooseAskIndex(asks, bids), 1);
  const m = chooseMarket(asks, bids);
  assert.equal(m.askIndex, 1);
  assert.equal(m.ask, 4.11);
  assert.equal(m.bid, 1.55);
  assert.equal(m.sell, 4.11);
  assert.equal(m.sellFrom, 'ask');
});

test('a variant bid above the lock ceiling is dropped, one a hair over the ask is kept', () => {
  // 12 ref is over 6.33 x 1.05: a painted/spelled variant, not this item.
  const m = chooseMarket([6.33], [12, 5.11, 5.11]);
  assert.deepEqual(m.bids, [5.11, 5.11]);
  assert.equal(m.nBids, 2);
  assert.equal(m.bid, 5.11);
  assert.equal(m.locked, false);

  // 6.44 is within 5% of the 6.33 ask: a locked market.
  const locked = chooseMarket([6.33, 7], [6.44, 6.44, 5.11]);
  assert.deepEqual(locked.bids, [6.44, 6.44, 5.11]);
  assert.equal(locked.bid, 6.44);
  assert.equal(locked.locked, true);
  assert.equal(locked.sell, 7);
  assert.equal(locked.sellFrom, 'next-ask');
});

test('locked with no ask above the bid: sell a margin over the bid', () => {
  const m = chooseMarket([1.55, 1.55], times(1.55, 3));
  assert.equal(m.locked, true);
  assert.equal(m.bid, 1.55);
  assert.equal(m.sell, 1.66);
  assert.equal(m.sellFrom, 'margin');
  assert.equal(m.sellIndex, -1);
});

test('one bid is the bid', () => {
  const m = chooseMarket([5], [3]);
  assert.equal(m.bid, 3);
  assert.equal(m.nBids, 1);
  assert.equal(m.sell, 5);
  assert.equal(m.sellFrom, 'ask');
});

test('no asks: every bid counts, no sell', () => {
  const m = chooseMarket([], [2, 1, 2]);
  assert.equal(m.ask, null);
  assert.equal(m.bid, 2);
  assert.deepEqual(m.bids, [2, 2, 1]);
  assert.equal(m.sell, null);
  assert.equal(m.sellFrom, 'none');
  assert.equal(m.locked, false);
});

test('an empty book has no bid and no sell', () => {
  const m = chooseMarket([], []);
  assert.equal(m.bid, null);
  assert.equal(m.nBids, 0);
  assert.equal(m.sellFrom, 'none');
});

test('support within one scrap on cheap items', () => {
  // Tin-1000: 5% of 1.66 is 0.08, under one scrap, so the 1.66 bid used to be
  // unsupported by the 1.55s and the buy was 1.55.
  assert.equal(robustBestBid([1.66, 1.55, 1.55], null), 1.66);
  assert.equal(chooseMarket([2.11, 2.22], [1.66, 1.55, 1.55]).bid, 1.66);
  // The Birdcage 1.55 / 1.44 and the Winter 2018 case 0.27 / 0.22.
  assert.equal(robustBestBid([1.55, 1.44], null), 1.55);
  assert.equal(robustBestBid([0.27, 0.22], null), 0.27);
  // Two scrap apart is not within one scrap.
  assert.equal(robustBestBid([1.66, 1.44], null), 1.44);
  // A 30 ref item: 28 is 6.7% under 30 (more than 5% and more than a scrap),
  // so 30 is only the bid once a second bidder backs it.
  assert.equal(robustBestBid([30, 28], null), 28);
  assert.equal(robustBestBid([30, 29.88, 28], null), 30);
  // supportMetal comes from the options.
  assert.equal(robustBestBid([1.66, 1.55], null, { supportMetal: 0.05 }), 1.55);
});

test('robustBestBid', () => {
  assert.equal(robustBestBid([], 5), null);
  assert.equal(robustBestBid([3], 10), 3);
  // Supported by proximity to the ask alone.
  assert.equal(robustBestBid([9.5, 2], 10), 9.5);
  // Not near the ask and alone: the next bid down, which the top one backs.
  assert.equal(robustBestBid([8, 5, 1], 10), 5);
  // Without an ask only support counts.
  assert.equal(robustBestBid([8, 7.9, 1], null), 8);
  assert.equal(robustBestBid([8, 7.9, 1], Infinity), 8);
  // minSupport 3: the highest price three bidders would pay.
  assert.equal(robustBestBid([10, 6, 2], 100, { minSupport: 3 }), 2);
  // Fewer bids than minSupport, nothing supported: the second-highest bid.
  assert.equal(robustBestBid([10, 6], 100, { minSupport: 3 }), 6);
});

test('marketOptions maps the config', () => {
  const opts = marketOptions({
    isolatedAskGap: 0.3,
    maxAskToBidRatio: 4,
    minSellMargin: 0.22,
    minSellMarginPercent: 0.05,
    marketModel: {
      lockTolerancePct: 0.02,
      supportPct: 0.03,
      supportMetal: 0.22,
      minSupport: 3,
      askProximityPct: 0.05,
      lockedNextAskMaxPct: 0.2,
    },
  });
  assert.deepEqual(opts, {
    maxBidAbovePct: undefined,
    maxBidAboveMetal: undefined,
    gap: 0.3,
    maxAskToBidRatio: 4,
    marginMetal: 0.22,
    marginPct: 0.05,
    lockTolerancePct: 0.02,
    lockedNextAskMaxPct: 0.2,
    supportPct: 0.03,
    supportMetal: 0.22,
    minSupport: 3,
    askProximityPct: 0.05,
  });
  // Missing values fall back to the defaults inside chooseMarket.
  const m = chooseMarket([19.33, 19.55, 35.33], [19.22, 15, 2.88], marketOptions({}));
  assert.equal(m.bid, 19.22);
});
