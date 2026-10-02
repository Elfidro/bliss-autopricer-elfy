// How far the sell price may sit above the buy price.
//
// The pricer buys at the bids and sells at the market ask (chooseAskIndex),
// and nothing tied the two together. When the whole ask side is a herd of
// bots listing at an absurd price there is no undercut to skip - every ask is
// the outlier - so the pricer copied it: The Triple Jumper had 19 bids at
// 18-24 ref and five asks at 52-73 ref, and sold at 52 ref against a 23.66 ref
// buy for two days (bptf community value 18.11 ref). Titanium Tyrolean went
// out as 1.55 / 10.00 the same way.
//
// The rule: with enough real bids to trust the buy price, the sell may be at
// most `maxAboveBuyPct` above it. Cheap items get a flat `maxAboveBuyMetal`
// allowance instead, since a 0.33 ref item legitimately sells at 0.66 (100%
// over). The bptf community sell can raise the allowance: when the baseline
// says the item is worth more than the bids suggest, the cap is at least
// `maxAboveBaselinePct` over the baseline. With fewer than `minBids` bids the
// buy is not trustworthy enough to anchor to, so nothing is capped.
//
// Pure: no I/O, no config reads. All prices are in metal.

const DEFAULTS = {
  enabled: true,
  minBids: 3,
  maxAboveBuyPct: 0.6,
  maxAboveBuyMetal: 0.66,
  maxAboveBaselinePct: 0.25,
};

// Same rounding as Methods.getRight: nearest weapon, written as 2 dp.
function toWeaponNotation(v) {
  const halfScraps = Math.round(v * 18);
  const scrap = halfScraps / 2;
  return Math.floor(Math.round((scrap / 9) * 10000) / 100) / 100;
}

function num(v, fallback) {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

// anchorSell({ buyMetal, sellMetal, baselineSellMetal, nBids }, opts)
//   -> { sellMetal, capped, reason }
function anchorSell({ buyMetal, sellMetal, baselineSellMetal, nBids } = {}, opts = {}) {
  const unchanged = (reason) => ({ sellMetal, capped: false, reason });

  if (opts && opts.enabled === false) {
    return unchanged('disabled');
  }
  if (!(Number.isFinite(buyMetal) && buyMetal > 0) || !Number.isFinite(sellMetal)) {
    return unchanged('no usable buy/sell');
  }
  const minBids = num(opts.minBids, DEFAULTS.minBids);
  if (!(Number(nBids) >= minBids)) {
    return unchanged(`only ${nBids} bid(s), need ${minBids} to anchor`);
  }

  const pct = num(opts.maxAboveBuyPct, DEFAULTS.maxAboveBuyPct);
  const flat = num(opts.maxAboveBuyMetal, DEFAULTS.maxAboveBuyMetal);
  const basePct = num(opts.maxAboveBaselinePct, DEFAULTS.maxAboveBaselinePct);

  let cap = Math.max(buyMetal * (1 + pct), buyMetal + flat);
  if (Number.isFinite(baselineSellMetal) && baselineSellMetal > 0) {
    cap = Math.max(cap, baselineSellMetal * (1 + basePct));
  }

  if (!(sellMetal > cap + 0.005)) {
    return unchanged('within cap');
  }

  // Round down to a whole weapon so the cap is never exceeded.
  let anchored = toWeaponNotation(Math.floor(cap * 18) / 18);
  // Never at or below the buy (only possible with a zero flat allowance):
  // one weapon over the buy is the smallest legal sell.
  if (!(anchored > buyMetal)) {
    anchored = toWeaponNotation((Math.round(buyMetal * 18) + 1) / 18);
  }
  // Capping must never raise the sell.
  if (!(anchored < sellMetal)) {
    return unchanged('within cap');
  }

  return {
    sellMetal: anchored,
    capped: true,
    reason:
      `ask ${sellMetal} ref is over the ${Math.round(cap * 100) / 100} ref cap ` +
      `(buy ${buyMetal} ref)`,
  };
}

module.exports = { anchorSell, SELL_ANCHOR_DEFAULTS: DEFAULTS };
