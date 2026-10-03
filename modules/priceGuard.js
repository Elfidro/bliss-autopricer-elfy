// Safety pass for items that kept an old price this cycle.
//
// An item that is rejected (baseline mismatch), held by the swing guard or
// errors out keeps whatever is in the pricelist, however far the market has
// moved since. Aristocravat sat at buy 3.5 / sell 3.83 for 18 hours while the
// bids were at 5.11, and Hot Heels sold at 6.22 with bids at 6.33: the bots
// were selling under the best bid, an instant loss to anyone who flips it into
// that bid. Selling under the best bid or buying over where the market sells
// is a guaranteed loss whatever the reason the item did not price, so this
// fixes those two crossings and nothing else.
//
// It only ever moves a price in the safe direction - sell up, buy down - so it
// bypasses the swing guard and the baseline check on purpose.
//
// Pure: no I/O, no config reads. All prices are in metal.

// Same rounding as Methods.getRight: nearest weapon, written as 2 dp.
function toWeaponNotation(v) {
  const halfScraps = Math.round(v * 18);
  const scrap = halfScraps / 2;
  return Math.floor(Math.round((scrap / 9) * 10000) / 100) / 100;
}

// One weapon (1/18 ref) above / below a price, in weapon notation.
const weaponAbove = (v) => toWeaponNotation((Math.round(v * 18) + 1) / 18);
const weaponBelow = (v) => toWeaponNotation((Math.round(v * 18) - 1) / 18);

const EPS = 0.005;

const finitePositive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

// guardPrice({ buy, sell, bid, marketSell }, opts) -> null | { buy, sell, reason }
//   buy, sell   the price the item has now
//   bid         the supported best bid (chooseMarket(...).bid), or null
//   marketSell  where the market sells (chooseMarket(...).sell: the market ask,
//               or the next ask up / bid + margin when locked), or null when
//               there are no asks
//   opts.minBuyMetal  the smallest buy price (default 0.05, one weapon)
//
// - sell under the bid: raise the sell to the market sell, and at least a
//   weapon over the bid (and over the buy).
// - buy over the market sell: lower the buy to the best bid, and at most a
//   weapon under the market sell, never under minBuyMetal.
// Returns null when there is nothing to fix.
function guardPrice({ buy, sell, bid, marketSell } = {}, opts = {}) {
  if (!finitePositive(buy) || !finitePositive(sell)) {
    return null;
  }
  const minBuy = finitePositive(opts.minBuyMetal) ? opts.minBuyMetal : 0.05;
  const hasBid = finitePositive(bid);
  const hasMarketSell = finitePositive(marketSell);
  const reasons = [];
  let newBuy = buy;
  let newSell = sell;

  // The buy first, so a sell that has to clear the buy clears the new one.
  if (hasMarketSell && buy > marketSell + EPS) {
    let target = weaponBelow(marketSell);
    if (hasBid) {
      target = Math.min(target, bid);
    }
    target = Math.max(minBuy, toWeaponNotation(target));
    if (target < buy) {
      newBuy = target;
      reasons.push(
        `buy ${buy} ref was over the ${marketSell} ref market sell, lowered to ${newBuy} ref`
      );
    }
  }

  if (hasBid && sell < bid - EPS) {
    newSell = Math.max(hasMarketSell ? marketSell : 0, weaponAbove(bid));
    if (!(newSell > newBuy + EPS)) {
      newSell = weaponAbove(newBuy);
    }
    reasons.push(`sell ${sell} ref was under the ${bid} ref best bid, raised to ${newSell} ref`);
  }

  if (reasons.length === 0) {
    return null;
  }

  // tf2autobot needs buy < sell. Prefer pulling the buy down (the safe side);
  // raise the sell only when the buy cannot go any lower.
  if (!(newBuy < newSell - EPS)) {
    const lowered = Math.max(minBuy, weaponBelow(newSell));
    if (lowered < newSell - EPS) {
      newBuy = Math.min(newBuy, lowered);
    } else {
      newSell = weaponAbove(newBuy);
    }
  }

  return { buy: newBuy, sell: newSell, reason: reasons.join('; ') };
}

module.exports = { guardPrice };
