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
  alwaysQuerySnapshotAPI: false,
  fallbackOntoPricesTf: false,
  excludedSteamIDs: [],
  trustedSteamIDs: [],
  excludedListingDescriptions: [],
  blockedAttributes: {},
  minSellMargin: 0.11,
  // When the best bids meet the lowest ask, buy at ask minus this share of it
  // (never less than minSellMargin).
  minSellMarginPercent: 0.03,
  // backpack.tf prices some craft hats in "hats"; value of one hat in ref.
  hatPriceRef: 1.33,
  // Our own bots. Their listings are ignored as market data and left out of the
  // dashboard's market numbers.
  ownBotSteamIDs: [],
  priceSwingLimits: {
    maxBuyIncrease: 0.1,
    maxSellDecrease: 0.1,
    // A move the guard blocks is accepted once it persists this many cycles.
    confirmCycles: 4,
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
