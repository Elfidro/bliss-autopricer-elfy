// What "the market" is for an item: which ask to sell at, which bids are real,
// and which bid to buy at.
//
// Shared by the pricer (bptf-autopricer.js), the crossing guard
// (modules/priceGuard.js) and the accuracy dashboard (modules/marketAccuracy.js),
// so the three never disagree about where the bid and the ask are.
//
// Pure: no I/O, no config reads (marketOptions maps a config object to the
// options). All prices are in metal.

function num(v, fallback) {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

// Index of the ask to price against. `asks` is ascending and `bids` is any
// order, both in metal.
//
// The lowest ask is the market price unless it is an isolated undercut: a
// single listing more than `gap` (a fraction) below the next one, e.g. 1.66 ref
// when everyone else asks 4.11+. Copying that would sell the item at a mislisted
// or dumped price, and it also hid every real bid, since bids above the "ask"
// are dropped as being for a painted/spelled variant. A listing is only ever
// skipped while at least two asks remain above it, so with one or two asks the
// lowest is always used.
//
// The bids decide between "undercut" and "the only honest ask". If the buyers
// agree with the low ask (the best bid at or under it is close to it) and the
// next ask up is more than `maxAskToBidRatio` times that bid, the asks above
// are the outliers, not the one below: Defiant Spartan had eight bids at
// 1.22-1.33, one ask at 1.33 and two junk asks at 26 and 28 ref. Wet Works, by
// contrast, had bids at 1.55, one ask at 1.66 and twenty-four at 4.11+, and
// 4.11 is within three times the bid, so 1.66 is skipped as an undercut.
//
// Time-based protection is the price swing guard; this rule only looks at the
// shape of the current market. It replaced a check that compared each ask to
// the pricer's own recent sell prices, which anchored a wrong price to itself:
// once an item sold at 40 ref, the 1.44 ref asks were "outliers" and the one
// 40 ref listing was not.
function chooseAskIndex(asks, bids = [], opts = {}) {
  const gap = Number.isFinite(opts.gap) ? opts.gap : 0.25;
  const ratio = Number.isFinite(opts.maxAskToBidRatio) ? opts.maxAskToBidRatio : 3;
  let i = 0;
  while (i < asks.length - 2 && asks[i] < asks[i + 1] * (1 - gap)) {
    let support = 0;
    for (const b of bids || []) {
      if (b <= asks[i] && b > support) {
        support = b;
      }
    }
    if (support > 0 && asks[i + 1] > support * ratio) {
      break;
    }
    i++;
  }
  return i;
}

// The highest bid that is actually supported. `bids` is descending and `ask`
// is the market ask (null or Infinity when there is none).
//
// The buy used to be the mean of the top three bids, which mixed price levels
// and lowballers into a number nobody bids: Standing Offer had bids 19.22, 15
// and 2.88 under a 19.33 ask and was bought at 12.38. Cigarillo Caballero had
// two bidders at 43.33 and was bought at 36.05. For a buyer the relevant number
// is the best bid that is not a one-off, so a bid counts when
//   - at least `minSupport` bids (itself included) are within `supportPct` of
//     it: two bidders at 43.33 (Cigarillo), or 24.44 with 24.33 behind it
//     (Slumber Slacks), or
//   - it sits within `askProximityPct` under the ask, i.e. the two sides agree
//     on the price: Standing Offer's lone 19.22 is 1% under the 19.33 ask.
// A lone bid far above the pack and far under the ask is not copied: The
// Triple Jumper's 23.11 sits 16% over a pack at 19.88 and 17% under the 28 ref
// ask, so the buy is 19.88. Likewise Crusader's Getup (646.6 alone, 544.28 x3,
// ask 777.92 -> 544.28) and The Vascular Vestment (9.77 alone, 7.66 and
// 7.55 x6, ask 16 -> 7.66).
//
// This replaced the z-score outlier filter too, which deleted the honest top
// bids whenever a crowd of lowballers sat far below them.
//
// When nothing is supported (only possible with fewer bids than minSupport)
// the second-highest bid is used - a price at least two bidders would pay - or
// the only bid when there is one. null when there are no bids.
function robustBestBid(bids, ask, opts = {}) {
  const list = (bids || []).filter((b) => Number.isFinite(b)).sort((a, b) => b - a);
  if (list.length === 0) {
    return null;
  }
  const supportPct = num(opts.supportPct, 0.05);
  const minSupport = num(opts.minSupport, 2);
  const proximity = num(opts.askProximityPct, 0.1);
  const hasAsk = Number.isFinite(ask) && ask > 0;

  for (const bid of list) {
    if (hasAsk && bid >= ask * (1 - proximity)) {
      return bid;
    }
    const floor = bid * (1 - supportPct);
    let support = 0;
    for (const b of list) {
      if (b < floor) {
        break;
      }
      support++;
    }
    if (support >= minSupport) {
      return bid;
    }
  }
  return list.length >= 2 ? list[1] : list[0];
}

// The whole market for an item. `asks` is ascending, `bids` any order, both in
// metal. Returns
//   { askIndex, ask, bid, bids, nBids, locked, sell, sellFrom, sellIndex, bidCeiling }
// where `ask` is the market ask (chooseAskIndex), `bids` the real bids
// (descending), `bid` the supported best bid (robustBestBid), and `sell` the
// price to sell at:
//   sellFrom 'ask'      the market ask (sellIndex = askIndex)
//   sellFrom 'next-ask' the market is locked, `sell` is the first ask above the
//                       best bid (sellIndex is its index in `asks`)
//   sellFrom 'margin'   locked with no ask above the bid: sell is null, the
//                       caller adds a margin over the bid
//   sellFrom 'none'     no asks at all: sell is null
//
// Bids above the ask are mostly for a painted/spelled/parted variant the
// listing filter missed, so they are dropped - but only above
// ask x (1 + lockTolerancePct). A bid at or a hair over the ask is a locked
// market, not a variant, and the cut-off used to be exactly the ask.
//
// Locked (best bid >= market ask) is common on liquid items, where a buying
// bot and a selling bot will not trade with each other or the ask is a seller
// meeting the bidders that is about to be taken. The pricer used to keep
// selling at that ask and cut the buy 3% under it, a buy that never wins an
// item: Backpack Expander had bids 29.88 x3 and 29.77 x13, asks 29.88, 30 x4,
// and went out as 29 / 29.88. The sustained ask is the first one above the
// best bid, so it is 29.88 / 30. Non-Craftable Tour of Duty Ticket (bids 26,
// asks 26 x7, 26.22) is 26 / 26.22 instead of selling under the best bid;
// Veteran's Attire (bids 65.54 x3, asks 65.32, 68.54 x4) is 65.54 / 68.54.
function chooseMarket(asks, bids, opts = {}) {
  const askList = asks || [];
  const allBids = (bids || []).filter((b) => Number.isFinite(b)).sort((a, b) => b - a);
  const askIndex = chooseAskIndex(askList, allBids, opts);
  const ask = askList.length ? askList[askIndex] : null;

  if (ask === null) {
    const bid = robustBestBid(allBids, null, opts);
    return {
      askIndex,
      ask: null,
      bid,
      bids: allBids,
      nBids: allBids.length,
      locked: false,
      sell: null,
      sellFrom: 'none',
      sellIndex: -1,
      bidCeiling: Infinity,
    };
  }

  const lockTolerance = num(opts.lockTolerancePct, 0.05);
  const bidCeiling = ask * (1 + lockTolerance);
  const realBids = allBids.filter((b) => b <= bidCeiling);
  const bid = robustBestBid(realBids, ask, opts);
  const locked = bid !== null && bid >= ask - 0.005;

  let sell = ask;
  let sellFrom = 'ask';
  let sellIndex = askIndex;
  if (locked) {
    sellIndex = askList.findIndex((a) => a > bid + 0.005);
    if (sellIndex >= 0) {
      sell = askList[sellIndex];
      sellFrom = 'next-ask';
    } else {
      sell = null;
      sellFrom = 'margin';
    }
  }

  return {
    askIndex,
    ask,
    bid,
    bids: realBids,
    nBids: realBids.length,
    locked,
    sell,
    sellFrom,
    sellIndex,
    bidCeiling,
  };
}

// chooseMarket options from the pricer config (config.json keys
// isolatedAskGap, maxAskToBidRatio and marketModel). Missing values fall back
// to the defaults above.
function marketOptions(config = {}) {
  const m = (config && config.marketModel) || {};
  return {
    gap: config?.isolatedAskGap,
    maxAskToBidRatio: config?.maxAskToBidRatio,
    lockTolerancePct: m.lockTolerancePct,
    supportPct: m.supportPct,
    minSupport: m.minSupport,
    askProximityPct: m.askProximityPct,
  };
}

module.exports = { chooseAskIndex, robustBestBid, chooseMarket, marketOptions };
