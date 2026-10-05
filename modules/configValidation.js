const fs = require('fs');

const DEFAULTS = {
  bptfAPIKey: '',
  bptfToken: '',
  steamAPIKey: '',
  database: {
    schema: 'tf2',
    host: 'localhost',
    port: 5432,
    name: 'bptf-autopricer',
    user: 'postgres',
    password: '',
  },
  pricerPort: 3456,
  // Sanity band against the backpack.tf community price (baseline buy = 0.9 x
  // value, sell = 1.1 x value). It is there to catch broken prices, not to
  // steer them: community values lag the market, and the old 5 / -8 band
  // rejected most correct market prices.
  maxPercentageDifferences: {
    buy: 20,
    sell: -25,
  },
  // The band above is only applied to thin markets; with at least this many
  // bids and asks the market price is used as is. It is also skipped when the
  // market is self-consistent: 2+ bids, an ask, at least `total` listings in
  // all, and the ask within maxAskToBidRatio of the best bid. The baseline
  // lags by months (median entry 165 days old), and a one-ask market never met
  // the buy/sell rule, so items such as Aristocravat were rejected for hours.
  baselineCheck: {
    skipWhenListingsAtLeast: { buy: 5, sell: 3, total: 5 },
  },
  alwaysQuerySnapshotAPI: false,
  fallbackOntoPricesTf: false,
  // The key is priced from the live backpack.tf book (modules/keyMarketPrice.js)
  // with pricedb.io as reference and fallback. A listings price further than
  // maxDeviationFromReference from pricedb.io is refused.
  keyPricing: {
    fromListings: true,
    minBids: 3,
    minAsks: 3,
    maxDeviationFromReference: 0.06,
    // Key buy price handed to the bots is this many ref under the market
    // buy, as a fee on customers who pay in keys (tf2autobot values their
    // keys at the key buy price). 0 = off. The stored price stays at market.
    botBuyDiscountMetal: 0,
  },
  // Steam Community Market prices are wallet-dollar prices with no relation
  // to the backpack.tf market: a case that trades for one weapon on bptf came
  // back as 0.88 ref. Off unless asked for.
  useScmFallback: false,
  excludedSteamIDs: [],
  trustedSteamIDs: [],
  excludedListingDescriptions: [],
  blockedAttributes: {},
  minSellMargin: 0.11,
  // In a locked market with no usable ask above the best bid, sell at the bid
  // plus this share of it (never less than minSellMargin). Also the margin the
  // pricer keeps when a buy would come out at or above the sell.
  minSellMarginPercent: 0.03,
  // backpack.tf prices some craft hats in "hats"; value of one hat in ref.
  hatPriceRef: 1.33,
  // Our own bots. Their listings are ignored as market data and left out of the
  // dashboard's market numbers.
  ownBotSteamIDs: [],
  // The lowest sell listing is the market ask unless it is an isolated
  // undercut: more than this fraction below the next ask, with at least two
  // asks above it. Then the next ask is used (modules/marketPrice.js).
  isolatedAskGap: 0.25,
  // ...unless the buyers back the low ask: when the best bid at or under it
  // is within this ratio of the next ask, the next ask is a plausible market;
  // when the next ask is further above the bid than this, the asks above are
  // the outliers and the low ask stands.
  maxAskToBidRatio: 3,
  // How the bids are read (modules/marketPrice.js chooseMarket). The buy is
  // the highest bid backed by at least minSupport bids within supportPct of
  // it, or within askProximityPct under the ask; a lone bid far above the pack
  // is not copied. Bids up to lockTolerancePct over the ask are a locked
  // market (sell at the next ask above the bid), not a painted variant.
  marketModel: {
    lockTolerancePct: 0.05,
    supportPct: 0.05,
    // ...or within this many ref, whichever is wider: on cheap items 5% is
    // under one scrap (Tin-1000's 1.66 was unsupported by 1.55 bids).
    supportMetal: 0.11,
    minSupport: 2,
    askProximityPct: 0.1,
    // In a locked market the next ask up is the sell only when it is at most
    // this fraction above the best bid, else bid + minSellMargin. A 3x band let
    // Fizzy Pharmacist (bids and asks at 23.33, next ask 49.33) sell at 49.33.
    lockedNextAskMaxPct: 0.25,
  },
  // A 24 h history anchor (modules/historyAnchor.js): the median of our own
  // buy and sell over the last windowHours, for SKUs with at least minRows
  // price_history rows. Bids above anchor sell x (1 + maxBidAbovePct) (or
  // + maxBidAboveMetal) are dropped, and the buy may rise at most
  // maxBuyRisePct (or maxBuyRiseMetal) over the anchor buy per window. A pump
  // walked Snug Sharpshooter's buy from 4.44 to 24 ref in 1-3% steps that the
  // swing guard never saw, and Lia lost ~700 ref.
  // The anchor only ever limits UPWARD buy moves and bids far above our own
  // recent sell, so a wrong-low anchor costs missed purchases (a 3 -> 18 ref
  // move takes ~8 days at 25%/day) while a wrong-high anchor is never
  // reinforced - the opposite of the old self-anchoring sell rule that stuck
  // The Birdcage at 40 ref.
  historyAnchor: {
    enabled: true,
    windowHours: 24,
    minRows: 8,
    maxBidAbovePct: 0.5,
    maxBidAboveMetal: 0.33,
    maxBuyRisePct: 0.25,
    maxBuyRiseMetal: 0.33,
    // A buy anchor under this share of the sell anchor came from a sell-only
    // placeholder, not bids, and gets no ramp cap (Hard Hearing: anchor buy
    // 4.5 / sell 118.11 held the buy at 5.61 against bids at 64-75 ref).
    minBuyOfSellPct: 0.5,
    // The mirror of the buy ramp: the sell may fall at most maxSellDropPct
    // (or maxSellDropMetal, whichever drop is larger) under the anchor sell,
    // never to or under the buy. Fake cheap asks would otherwise pull our
    // sell down within an hour.
    maxSellDropPct: 0.25,
    maxSellDropMetal: 0.33,
    // A second, longer median (needs longMinRows rows, a day of cycles). Not
    // used for pricing: it is published with the 24 h one in
    // files/anchors.json for pricelist-ui's inflow guard.
    longWindowHours: 168,
    longMinRows: 96,
  },
  // The sell follows the ask, but the ask is not always a market: when every
  // seller is a bot parked at an absurd price there is no undercut to skip,
  // and the pricer copied the herd (The Triple Jumper sold at 52 ref against
  // a 23.66 ref buy for two days). With at least minBids bids, the sell is
  // capped at the highest of buy x (1 + maxAboveBuyPct), buy +
  // maxAboveBuyMetal (so cheap items keep their weapon-or-two spread) and the
  // bptf community sell x (1 + maxAboveBaselinePct). See modules/sellAnchor.js.
  sellAnchor: {
    enabled: true,
    minBids: 3,
    maxAboveBuyPct: 0.6,
    maxAboveBuyMetal: 0.66,
    maxAboveBaselinePct: 0.25,
  },
  // The no-bid sell-only rule (buy 0.05 under the ask) exists for junk cases
  // that trade at a weapon or two. A hat with no bids at all is not a market:
  // above this ask it keeps its last price instead of going out as 0.05 / ask.
  sellOnly: {
    maxAskWithoutBidsMetal: 1,
  },
  priceSwingLimits: {
    maxBuyIncrease: 0.1,
    maxSellDecrease: 0.1,
    // A move the guard blocks is accepted once it persists this many cycles.
    confirmCycles: 4,
    // Moves of at most this many ref are never a swing, whatever the
    // percentage: one scrap is 11% of a 1 ref hat.
    ignoreBelowMetal: 0.33,
    // A previous price older than this is stale and does not hold a move.
    staleAfterHours: 6,
  },
  websocketRelay: {
    enabled: false,
    host: 'localhost',
    port: 7789,
    protocol: 'ws',
  },
  // Price an item from its buy listings alone when no sell listings exist yet,
  // using buy + max(sellMarginRef, sellMarginPercent of buy) as a placeholder
  // sell price. Favours getting items in stock over waiting for both sides of
  // the market to fill in.
  priceWithoutSellListings: {
    enabled: true,
    sellMarginRef: 0.22,
    sellMarginPercent: 0.1,
  },
  // Percentage tolerances are meaningless on cheap items: metal moves in scrap
  // (0.11 ref), so below roughly 2.2 ref a single scrap already exceeds a 5%
  // limit and nothing can ever price. Items whose baseline buy price is under
  // thresholdRef are judged against these looser limits instead.
  // Re-broadcast the backpack.tf feed to other local processes. backpack.tf
  // refuses a second connection from the same host, so consumers such as
  // TradingToolsTF2 read the stream from here instead of opening their own.
  // Loopback-bound: same-host only, nothing exposed publicly.
  websocketBroadcast: {
    enabled: true,
    host: '127.0.0.1',
    port: 7791,
  },
  lowValuePricing: {
    thresholdRef: 5,
    maxPercentageDifferences: {
      buy: 25,
      sell: -25,
    },
  },
};

function deepMerge(target, src) {
  for (const key in src) {
    if (typeof src[key] === 'object' && src[key] !== null && !Array.isArray(src[key])) {
      if (!target[key]) {
        target[key] = {};
      }
      deepMerge(target[key], src[key]);
    } else if (target[key] === undefined) {
      target[key] = src[key];
    }
  }
  return target;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const REQUIRED_FIELDS = ['bptfAPIKey', 'bptfToken', 'steamAPIKey', 'database', 'pricerPort'];

function validateConfig(configPath) {
  let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const original = deepClone(config);

  // Add missing defaults
  const merged = deepMerge(config, DEFAULTS);

  // If any keys were added, save the config
  if (JSON.stringify(original) !== JSON.stringify(merged)) {
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
  }

  // Check for required top-level fields
  for (const field of REQUIRED_FIELDS) {
    if (merged[field] === undefined) {
      throw new Error(`Missing required config field: ${field}`);
    }
  }
  // Check for required database fields
  const db = merged.database;
  const dbRequired = ['schema', 'host', 'port', 'name', 'user', 'password'];
  for (const field of dbRequired) {
    if (db[field] === undefined) {
      throw new Error(`Missing required database config field: ${field}`);
    }
  }

  return merged;
}

module.exports = { validateConfig };
