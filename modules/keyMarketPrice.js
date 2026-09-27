// Prices the Mann Co. Supply Crate Key from the backpack.tf listings the
// websocket mirrors into tf2.listings, the same way every other item is
// priced: sell at the market ask (chooseAskIndex), buy at the mean of the top
// three bids at or under that ask, one scrap under the ask when the book is
// locked. The key is the unit every other price is quoted in, so this is the
// one price that has to track the live market rather than a lagging index.
//
// pricedb.io stays as the fallback when the book is thin, and as a sanity
// reference: a listings price further than maxDeviationFromReference from it
// is refused, so a poisoned or half-empty book can never move the key.

const KEY_NAME = 'Mann Co. Supply Crate Key';

const DEFAULTS = {
  fromListings: true,
  minBids: 3,
  minAsks: 3,
  maxDeviationFromReference: 0.06,
};

function settings(config) {
  return { ...DEFAULTS, ...((config && config.keyPricing) || {}) };
}

// Returns { buy, sell, nBids, nAsks } in metal, or { reason } when the
// listings cannot be trusted for a price.
async function priceKeyFromListings({ db, config, methods, chooseAskIndex, reference }) {
  const opt = settings(config);
  if (!opt.fromListings) {
    return { reason: 'keyPricing.fromListings is off' };
  }
  const skip = new Set([...(config.ownBotSteamIDs || []), ...(config.excludedSteamIDs || [])]);
  const rows = await db.any('SELECT intent, currencies, steamid FROM listings WHERE name = $1', [KEY_NAME]);

  const bids = [];
  const asks = [];
  for (const row of rows) {
    if (skip.has(row.steamid)) {
      continue;
    }
    const c = typeof row.currencies === 'string' ? JSON.parse(row.currencies) : row.currencies;
    // A key priced in keys is not a price.
    if (!c || (Number(c.keys) || 0) > 0) {
      continue;
    }
    const metal = Number(c.metal) || 0;
    if (!(metal > 0)) {
      continue;
    }
    (row.intent === 'buy' ? bids : asks).push(metal);
  }
  asks.sort((a, b) => a - b);
  if (asks.length < opt.minAsks) {
    return { reason: `only ${asks.length} key sell listings` };
  }

  const askIndex = chooseAskIndex(asks, bids, {
    gap: config.isolatedAskGap,
    maxAskToBidRatio: config.maxAskToBidRatio,
  });
  const ask = asks[askIndex];
  const realBids = bids.filter((b) => b <= ask).sort((a, b) => b - a);
  if (realBids.length < opt.minBids) {
    return { reason: `only ${realBids.length} key buy orders at or under the ${ask} ref ask` };
  }

  let sell = methods.getRight(ask);
  let buy = methods.getRight((realBids[0] + realBids[1] + realBids[2]) / 3);
  if (buy >= sell) {
    // Locked book (top bids meet the ask): buy one scrap under the ask. The
    // percentage margin used for hats would be almost two ref on a key.
    buy = methods.getRight(sell - (config.minSellMargin ?? 0.11));
  }

  if (reference) {
    const dev = (a, b) => (b > 0 ? Math.abs(a - b) / b : 0);
    const worst = Math.max(dev(buy, reference.buy.metal), dev(sell, reference.sell.metal));
    if (worst > opt.maxDeviationFromReference) {
      return {
        reason:
          `listings price ${buy} / ${sell} is ${Math.round(worst * 100)}% from pricedb.io ` +
          `${reference.buy.metal} / ${reference.sell.metal} (limit ${Math.round(opt.maxDeviationFromReference * 100)}%)`,
      };
    }
  }
  return { buy, sell, nBids: realBids.length, nAsks: asks.length };
}

module.exports = { priceKeyFromListings, KEY_NAME };
