// This file is part of the BPTF Autopricer project.
// It is a Node.js application that connects to Backpack.tf's WebSocket API,
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit').default; // For limiting concurrent operations
const Schema = require('@tf2autobot/tf2-schema');
require('./modules/schemaNameFix'); // before any name lookup
const EnhancedSchemaManager = require('./modules/steamSchemaManager');
const methods = require('./methods');
const Methods = new methods();
const { validateConfig } = require('./modules/configValidation');
const CONFIG_PATH = path.resolve(__dirname, 'config.json');
const config = validateConfig(CONFIG_PATH);
const PriceWatcher = require('./modules/PriceWatcher'); //outdated price logging
const SCHEMA_PATH = './schema.json';
// Paths to the pricelist and item list files.
const PRICELIST_PATH = './files/pricelist.json';
// The 24 h / 7 d medians, published each cycle for pricelist-ui's inflow guard.
const ANCHORS_PATH = './files/anchors.json';
const ITEM_LIST_PATH = './files/item_list.json';
const { listen, socketIO, setSchemaManager } = require('./API/server.js');
const { setWebSocketStatsProvider } = require('./API/routes/websocket-status.js');
const { startPriceWatcher } = require('./modules/index');
const scheduleTasks = require('./modules/scheduler');
const { getBptfPrices, getAllPricedItemNamesWithEffects } = require('./modules/bptfPriceFetcher');
const EmitQueue = require('./modules/emitQueue');
const emitQueue = new EmitQueue(socketIO, 5); // 5ms between emits
emitQueue.start();

// Stock-aware adjustments (see modules/pricePolicy.js). Everything that goes
// out to the bots passes through here; the stored pricelist stays at market.
const pricePolicy = require('./modules/pricePolicy');
const PRICE_POLICY_PATH = './files/price-policy.json';
// The schema gives item grades for the sell floors; the key price converts
// key-priced items to metal for the spread rule (keyobj is set once the key
// price has been fetched, later in this file).
pricePolicy.init({
  path: PRICE_POLICY_PATH,
  methods: Methods,
  config,
  getSchema: () => schemaManager.schema,
  getKeyMetal: () => (keyobj ? keyobj.metal : null),
});
const rawEnqueue = emitQueue.enqueue.bind(emitQueue);
emitQueue.enqueue = (item) => {
  const adjusted = pricePolicy.apply(item);
  if (adjusted !== item) {
    console.log(
      `[POLICY] ${item.name || item.sku}: ${pricePolicy.describe(item.sku)} -> buy ${adjusted.buy.keys}k ${adjusted.buy.metal} / sell ${adjusted.sell.keys}k ${adjusted.sell.metal}`
    );
  }
  // tf2autobot drops a price that falls by exactly half a scrap (its rounding
  // gate, see pricePolicy.bridgeFor): send a bridging price first so it lands.
  const prev = adjusted && pricePolicy.lastSentFor(adjusted.sku);
  const bridge = pricePolicy.bridgeFor(prev, adjusted);
  if (bridge) {
    console.log(
      `[POLICY] ${adjusted.name || adjusted.sku}: half-scrap decrease bridged (${pricePolicy.describeBridge(prev, bridge, adjusted)})`
    );
    rawEnqueue(bridge);
  }
  pricePolicy.recordSent(adjusted);
  rawEnqueue(adjusted);
};

const { fetchKeyPriceFromPriceDB } = require('./modules/keyPriceUtils');

const { updateMovingAverages, updateListingStats } = require('./modules/listingAverages');
const { recordStatus, getStatus, shortReason } = require('./modules/pricingStatus');
const { recordAccuracy } = require('./modules/marketAccuracy');
const { chooseAskIndex, chooseMarket, marketOptions } = require('./modules/marketPrice');
const { guardPrice } = require('./modules/priceGuard');
const { pruneStaleEntries } = require('./modules/pricelistPrune');
const {
  loadAnchors,
  writeAnchorsFile,
  ensureIndex: ensureAnchorIndex,
  rampCap,
  sellFloor,
  floorSell,
} = require('./modules/historyAnchor');
const { anchorSell, SELL_ANCHOR_DEFAULTS } = require('./modules/sellAnchor');
const { priceKeyFromListings } = require('./modules/keyMarketPrice');

const {
  getListings,
  insertListing,
  insertListingsBatch,
  deleteRemovedListing,
  deleteOldListings,
} = require('./modules/listings');
const logDir = path.join(__dirname, 'logs');
const logFile = path.join(logDir, 'websocket.log');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
  // Optionally: process.exit(1); // Only if you want to force a restart
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Optionally: process.exit(1); // Only if you want to force a restart
});

// Steam API key is required for the schema manager to work.
const originalSchemaManager = new Schema({
  apiKey: config.steamAPIKey,
});

// Enhanced schema manager with retry logic and fallbacks
const schemaManager = new EnhancedSchemaManager(originalSchemaManager, config);

// Connect schema manager to API for monitoring
setSchemaManager(schemaManager);

// Share it with the web routes so /add-item can verify names against the schema
require('./modules/schemaInstance').setSchemaManager(schemaManager);

// Steam IDs of bots that we want to ignore listings from.
const excludedSteamIds = config.excludedSteamIDs;

// Steam IDs of bots that we want to prioritize listings from.
const prioritySteamIds = config.trustedSteamIDs;

// Listing descriptions that we want to ignore.
const excludedListingDescriptions = config.excludedListingDescriptions;

// Blocked attributes that we want to ignore. (Paints, parts, etc.)
const blockedAttributes = config.blockedAttributes;

const fallbackOntoPricesTf = config.fallbackOntoPricesTf;

const updatedSkus = new Set();

// sku -> { buy, sell, n }: the 24 h median of our own prices
// (modules/historyAnchor.js), loaded at the start of every cycle before that
// cycle's price_history rows are written. Empty when the anchor is off or the
// query failed, which turns every anchor rule off.
let cycleAnchors = new Map();
// Per-cycle counts for the one [ANCHOR] summary line.
const anchorStats = { rampCapped: 0, sellFloored: 0, droppedAboveAnchor: 0 };

// sku -> consecutive cycles a price move has been held back by the swing guard.
// Persisted to disk: the guard needs confirmCycles consecutive holds before it
// accepts a move, and with the streaks only in memory every restart started
// the count over. On a day with several deploys an item could stay on a
// wrong price for hours (The Firestalker sat at 9.22 ref against a 4.11 ref
// market through five restarts).
const SWING_STREAKS_PATH = './files/swing-streaks.json';
const swingStreaks = (() => {
  const map = new Map();
  try {
    const saved = JSON.parse(fs.readFileSync(SWING_STREAKS_PATH, 'utf8'));
    for (const [sku, n] of Object.entries(saved || {})) {
      if (Number.isInteger(n) && n > 0) {
        map.set(sku, n);
      }
    }
  } catch {
    // No file yet, or unreadable: start empty.
  }
  const save = () => {
    try {
      fs.writeFileSync(SWING_STREAKS_PATH, JSON.stringify(Object.fromEntries(map)));
    } catch (err) {
      console.warn(`Could not save swing streaks: ${err.message}`);
    }
  };
  return {
    get: (sku) => map.get(sku),
    set: (sku, n) => {
      map.set(sku, n);
      save();
    },
    delete: (sku) => {
      if (map.delete(sku)) {
        save();
      }
    },
  };
})();

// Create database instance for pg-promise.
const { db, pgp } = require('./modules/dbInstance');

if (fs.existsSync(SCHEMA_PATH)) {
  // A cached schema exists.

  // Read and parse the cached schema.
  // Note the encoding goes to readFileSync, not JSON.parse - without it this
  // read the whole ~20 MB schema into a Buffer and then decoded it again.
  const cachedData = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  // Set the schema data.
  schemaManager.setSchema(cachedData);
}

// Pricelist doesn't exist.
if (!fs.existsSync(PRICELIST_PATH)) {
  try {
    fs.writeFileSync(PRICELIST_PATH, '{"items": []}', 'utf8');
  } catch (err) {
    console.error(err);
  }
}

// Item list doesn't exist.
if (!fs.existsSync(ITEM_LIST_PATH)) {
  try {
    fs.writeFileSync(ITEM_LIST_PATH, '{"items": []}', 'utf8');
  } catch (err) {
    console.error(err);
  }
}

// This event is emitted when the schema has been fetched.
schemaManager.on('schema', function (schema) {
  // Writes the schema data to disk.
  fs.writeFileSync(SCHEMA_PATH, JSON.stringify(schema.toJSON()));
});

let keyobj;
let external_pricelist;

const updateKeyObject = async () => {
  try {
    // pricedb.io is the reference and the fallback; the live backpack.tf
    // book is the price (modules/keyMarketPrice.js).
    let reference = null;
    try {
      reference = await fetchKeyPriceFromPriceDB();
    } catch (err) {
      console.error(`pricedb.io key price unavailable: ${err.message}`);
    }
    const market = await priceKeyFromListings({
      db,
      config,
      methods: Methods,
      chooseAskIndex,
      reference,
    });

    let key_item;
    if (market.buy) {
      key_item = {
        name: 'Mann Co. Supply Crate Key',
        sku: '5021;6',
        source: 'bptf',
        time: Math.floor(Date.now() / 1000),
        buy: { keys: 0, metal: market.buy },
        sell: { keys: 0, metal: market.sell },
      };
      console.log(
        `Key price from backpack.tf listings: buy ${market.buy} / sell ${market.sell} ref ` +
          `(${market.nBids} bids, ${market.nAsks} asks` +
          (reference ? `; pricedb.io ${reference.buy.metal} / ${reference.sell.metal}` : '') +
          ')'
      );
    } else if (reference) {
      key_item = reference;
      console.log(`Key price from pricedb.io (listings not usable: ${market.reason})`);
    } else {
      throw new Error(`no key price: listings not usable (${market.reason}) and pricedb.io failed`);
    }

    // Add to pricelist
    Methods.addToPricelist(key_item, PRICELIST_PATH);

    // Update keyobj for internal use
    keyobj = {
      metal: key_item.sell.metal,
    };

    // Emit the price update. The key goes out through the policy like every
    // other item, so the bots get the key-fee buy price (see pricePolicy).
    socketIO.emit('price', pricePolicy.apply(key_item));
  } catch (error) {
    console.error('Failed to update key price:', error);
    // If we fail, we'll retry on the next scheduled update
  }
};

const { initBptfWebSocket } = require('./websocket/bptfWebSocket');

// Load item names and bounds from item_list.json
const createItemListManager = require('./modules/itemList');
const itemListManager = createItemListManager(ITEM_LIST_PATH, config);
const { watchItemList, getAllowedItemNames, getItemBounds, allowAllItems } = itemListManager;
watchItemList();

// When priceWithoutSellListings is on, an item only needs buy-side depth to be
// worth pricing — the sell price is derived from the buy price until real sell
// listings show up. Otherwise both sides must have depth.
function requiresSellListings() {
  return config.priceWithoutSellListings?.enabled !== true;
}

async function getPricableItems(db) {
  const minListings = config.minListingCount || 3;
  const sellClause = requiresSellListings() ? 'AND current_sell_count >= $1' : '';
  const rows = await db.any(
    `
    SELECT sku FROM listing_stats
    WHERE current_buy_count >= $1 ${sellClause}
  `,
    [minListings]
  );
  return rows.map((r) => r.sku);
}

async function emitDefaultBptfPricesForUnpriceableItems() {
  // 1. Get all item names
  const allItemNames = await getAllPricedItemNamesWithEffects(
    external_pricelist,
    schemaManager,
    db
  );

  // 2. Read current pricelist
  const pricelist = JSON.parse(fs.readFileSync(PRICELIST_PATH, 'utf8'));
  const pricedSkus = new Set(pricelist.items.map((i) => i.sku));

  // 3. Get SKUs with 3+ buy and 3+ sell listings
  const pricableSkus = new Set(await getPricableItems(db));

  // 4. Filter out items already in pricelist or with enough listings
  const unpriceableNames = allItemNames.filter((name) => {
    const sku = schemaManager.schema.getSkuFromName(name);
    return sku && !pricedSkus.has(sku) && !pricableSkus.has(sku);
  });

  // 5. For each, get BPTF price, adjust, and emit
  for (const name of unpriceableNames) {
    const sku = schemaManager.schema.getSkuFromName(name);
    if (!sku) {
      continue;
    }
    const data = Methods.getItemPriceFromExternalPricelist(
      sku,
      external_pricelist,
      keyobj.metal,
      schemaManager
    );
    const pricetfItem = data.pricetfItem;
    if (
      !pricetfItem ||
      (pricetfItem.buy.keys === 0 && pricetfItem.buy.metal === 0) ||
      (pricetfItem.sell.keys === 0 && pricetfItem.sell.metal === 0)
    ) {
      continue; // skip if no valid price
    }

    // Adjust prices: +25% sell, -25% buy
    const adjust = (val, percent) => Math.max(0, Math.round((val + percent * val) * 100) / 100);

    const buy = {
      keys: pricetfItem.buy.keys,
      metal: adjust(pricetfItem.buy.metal, -0.25),
    };
    const sell = {
      keys: pricetfItem.sell.keys,
      metal: adjust(pricetfItem.sell.metal, 0.25),
    };

    // Auto bots expect: { name, sku, source, time, buy, sell }
    const item = {
      name,
      sku,
      source: 'bptf',
      time: Math.floor(Date.now() / 1000),
      buy,
      sell,
    };

    emitQueue.enqueue(item);
  }
  console.log(
    `Emitted default BPTF prices for ${unpriceableNames.length} items not in pricelist and with <3 buy/sell listings.`
  );
}

const KILLSTREAK_TIERS = {
  1: 'Killstreak',
  2: 'Specialized Killstreak',
  3: 'Professional Killstreak',
};

async function getKsItemNamesToPrice(db, allItemNames) {
  console.log(`Getting killstreak items with enough listings...`);
  const minListings = config.minListingCount || 3;
  const sellClause = requiresSellListings() ? 'AND current_sell_count >= $1' : '';
  const rows = await db.any(
    `
    SELECT sku FROM listing_stats
    WHERE (sku LIKE '%;kt-1' OR sku LIKE '%;kt-2' OR sku LIKE '%;kt-3')
      AND current_buy_count >= $1 ${sellClause}
  `,
    [minListings]
  );
  console.log(`Found ${rows.length} killstreak items with enough listings.`);

  // Build a map from baseSku (defindex + qualities except kt/effect) to name
  const baseSkuToName = new Map();
  for (const name of allItemNames) {
    const sku = schemaManager.schema.getSkuFromName(name);
    if (!sku) {
      continue;
    }
    // Remove killstreak and effect parts for base matching
    const parts = sku.split(';');
    const baseParts = [
      parts[0],
      ...parts.slice(1).filter((p) => !p.startsWith('kt-') && !p.startsWith('u')),
    ];
    const baseSku = baseParts.join(';');
    baseSkuToName.set(baseSku, name);
  }

  const ksNames = [];
  for (const { sku } of rows) {
    console.log(`Processing SKU: ${sku}`);
    // Parse the SKU
    const parts = sku.split(';');
    const defindex = parts[0];
    let ksTier = null;
    let isStrange = false;
    let isAustralium = false;
    let isFestivized = false;
    let qualities = [];

    for (const part of parts.slice(1)) {
      if (part.startsWith('kt-')) {
        ksTier = Number(part.split('-')[1]);
      } else if (part === '11') {
        isStrange = true;
        qualities.push(part);
      } else if (part === 'australium') {
        isAustralium = true;
        qualities.push(part);
      } else if (part === 'festivized') {
        isFestivized = true;
        qualities.push(part);
      } else if (!part.startsWith('u')) {
        qualities.push(part);
      }
    }

    // Build baseSku for lookup (defindex + all qualities except kt/effect)
    const baseParts = [defindex, ...qualities];
    const baseSku = baseParts.join(';');
    let baseName = baseSkuToName.get(baseSku);

    if (!baseName) {
      console.warn(`Base name not found for baseSku ${baseSku} (from KS SKU ${sku}), skipping.`);
      continue;
    }

    // Remove "Strange" if present for baseName, will re-add if needed
    let displayName = baseName
      .replace(/^Strange\s+/i, '')
      .replace(/^Festivized\s+/i, '')
      .replace(/^Australium\s+/i, '');

    // Compose KS name in correct order
    let ksName = '';
    if (isStrange) {
      ksName += 'Strange ';
    }
    if (isFestivized) {
      ksName += 'Festivized ';
    }
    ksName += KILLSTREAK_TIERS[ksTier] + ' ';
    if (isAustralium) {
      ksName += 'Australium ';
    }
    ksName += displayName;

    ksNames.push(ksName.trim());
    console.log(`Added killstreak item name: ${ksName}`);
  }
  console.log(`Found ${ksNames.length} killstreak item names to price.`);
  return ksNames;
}

const calculateAndEmitPrices = async () => {
  await deleteOldListings(db);

  // The 24 h history anchor, read before this cycle's prices are recorded.
  try {
    cycleAnchors =
      config.historyAnchor?.enabled === false
        ? new Map()
        : await loadAnchors(db, config.historyAnchor);
  } catch (err) {
    console.error('[ANCHOR] could not load the 24 h price anchors:', err.message);
    cycleAnchors = new Map();
  }
  // Publish them for pricelist-ui. Skipped when the anchor is off or the
  // query failed (an empty file would read as "no item has a normal price").
  if (cycleAnchors.size > 0) {
    try {
      writeAnchorsFile(cycleAnchors, ANCHORS_PATH, {
        windowHours: Number(config.historyAnchor?.windowHours) || 24,
        longWindowHours: Number(config.historyAnchor?.longWindowHours) || 168,
        keyMetal: keyobj ? keyobj.metal : null,
      });
    } catch (err) {
      console.error(`[ANCHOR] could not write ${ANCHORS_PATH}:`, err.message);
    }
  }
  anchorStats.rampCapped = 0;
  anchorStats.sellFloored = 0;
  anchorStats.droppedAboveAnchor = 0;

  // Only use items added through GUI or item_list.json
  // priceAllItems functionality removed for public release
  const itemNames = Array.from(getAllowedItemNames());
  console.log(`Pricing ${itemNames.length} items from item_list.json and GUI additions`);
  updatedSkus.clear();

  const limit = pLimit(15); // Limit concurrency to 15, adjust as needed
  const priceHistoryEntries = [];
  const itemsToWrite = [];

  // Read the pricelist once for the whole cycle. finalisePrice used to read and
  // parse the entire file for every single item, 15 parses in flight at a time.
  let prevBySku = new Map();
  try {
    const currentPricelist = JSON.parse(fs.readFileSync(PRICELIST_PATH, 'utf8'));
    for (const entry of currentPricelist.items || []) {
      // First entry wins, matching the .find() this replaced.
      if (!prevBySku.has(entry.sku)) {
        prevBySku.set(entry.sku, entry);
      }
    }
  } catch (err) {
    // Hand finalisePrice a null so it falls back to its own per-item read (and
    // its own failure handling). An empty map here would mean "no previous
    // price for anything" and silently switch off the swing check.
    console.error('Could not read pricelist for previous prices:', err.message);
    prevBySku = null;
  }

  console.log(`About to price ${itemNames.length} items. `);

  await Promise.allSettled(
    itemNames.map((name) =>
      limit(async () => {
        try {
          let sku = schemaManager.schema.getSkuFromName(name);

          // Skip the key entirely - it's handled by updateKeyObject via pricedb.io
          if (sku === '5021;6') {
            return;
          }

          let arr = await determinePrice(name, sku);
          let result = await finalisePrice(arr, name, sku, prevBySku);

          let item = result?.item;
          if (!result || !result.item) {
            return;
          }
          if (
            (item.buy.keys === 0 && item.buy.metal === 0) ||
            (item.sell.keys === 0 && item.sell.metal === 0)
          ) {
            recordStatus(name, 'error', 'Buy or sell side came out as zero');
            return;
          }

          itemsToWrite.push(item);
          priceHistoryEntries.push(result.priceHistory);
          emitQueue.enqueue(item);
          if (!result.swingConfirmed) {
            recordStatus(name, 'updated', result.note || '');
          }
        } catch (e) {
          console.log("Couldn't create a price for " + name + ' due to: ' + e.message);
          recordStatus(name, 'rejected', shortReason(e.message));
        }
      })
    )
  );

  const windowHours = Number(config.historyAnchor?.windowHours) || 24;
  console.log(
    `[ANCHOR] ${anchorStats.rampCapped} buys ramp-capped, ${anchorStats.sellFloored} sells ` +
      `ramp-floored, ${anchorStats.droppedAboveAnchor} bids dropped above the ${windowHours} h ` +
      `anchor (${cycleAnchors.size} SKUs anchored)`
  );

  // Items that did not price this cycle keep their old price; make sure that
  // price does not cross the live market (modules/priceGuard.js).
  try {
    await guardUnpricedItems(itemNames, itemsToWrite, priceHistoryEntries, prevBySku, limit);
  } catch (err) {
    console.error('[GUARD] crossing guard failed:', err.message);
  }

  // The per-item previous prices are no longer needed; drop the reference so
  // the whole parsed pricelist can be collected before the rewrite below.
  prevBySku = null;

  // Batch write pricelist at the end
  try {
    // Read current pricelist
    const pricelist = JSON.parse(fs.readFileSync(PRICELIST_PATH, 'utf8'));
    // Remove items with the same SKU as those we're updating
    const updatedSkus = new Set(itemsToWrite.map((i) => i.sku));
    const filtered = pricelist.items.filter((i) => !updatedSkus.has(i.sku));
    // Add new/updated items
    pricelist.items = [...filtered, ...itemsToWrite];
    // Drop entries nobody prices any more: names gone from the item list and
    // leftovers under broken SKUs (modules/pricelistPrune.js). The list rule
    // is skipped when every item is priced, or when the list came back empty
    // (a failed item_list.json read must not wipe the pricelist).
    const allowedNow = getAllowedItemNames();
    const pruned = pruneStaleEntries(pricelist.items, {
      allowed: allowAllItems() || !allowedNow || allowedNow.size === 0 ? null : allowedNow,
      resolveSku: (n) => schemaManager.schema.getSkuFromName(n),
    });
    const removed = pruned.notAllowed + pruned.brokenSku;
    if (removed > 0) {
      pricelist.items = pruned.items;
      console.log(
        `[PRUNE] removed ${removed} stale pricelist entries (${pruned.notAllowed} not in item list, ` +
          `${pruned.brokenSku} broken sku)`
      );
    }
    // Write back to file
    fs.writeFileSync(PRICELIST_PATH, JSON.stringify(pricelist, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to batch write pricelist:', err);
  }

  // After all items processed, batch insert price history:
  if (priceHistoryEntries.length > 0) {
    const cs = new pgp.helpers.ColumnSet(['sku', 'buy_metal', 'sell_metal'], {
      table: 'price_history',
    });
    const values = priceHistoryEntries.map((e) => ({
      sku: e.sku,
      buy_metal: e.buy,
      sell_metal: e.sell,
    }));
    await db.none(pgp.helpers.insert(values, cs) + ' ON CONFLICT DO NOTHING');
  }

  // Score the fresh pricelist against the live market for the dashboard.
  try {
    await recordAccuracy(db);
  } catch (err) {
    console.error('Could not record pricer accuracy:', err.message);
  }
};

// When the schema manager is ready we proceed.
schemaManager.init(async function (err) {
  if (err) {
    console.error('❌ [Schema] All schema initialization attempts failed:', err.message);
    process.exit(1);
  }

  // Start watching pricelist.json for “old” entries
  // pricelist.json lives in ./files/pricelist.json relative to this file:
  const pricelistPath = path.resolve(__dirname, './files/pricelist.json');
  // You can pass a custom ageThresholdSec (default is 2*3600) and intervalSec (default is 300)
  PriceWatcher.watchPrices(pricelistPath /*, ageThresholdSec, intervalSec */);

  // Get external pricelist. (Fetched once - this used to be called twice in a
  // row on startup, parsing the ~9 MB pricelist a second time for nothing.)
  external_pricelist = await getBptfPrices(); //await Methods.getExternalPricelist();
  // Update key object from pricedb.io
  await updateKeyObject();
  console.log(`Key object initialised from pricedb.io: ${JSON.stringify(keyobj)}`);
  // The history anchor reads price_history by SKU and time.
  try {
    await ensureAnchorIndex(db);
  } catch (err) {
    console.error('[ANCHOR] could not create the price_history index:', err.message);
  }
  // Calculate and emit prices on start up.
  await calculateAndEmitPrices();
  console.log('Prices calculated and emitted on startup.');

  // Start scheduled tasks after everything is ready
  scheduleTasks({
    updateExternalPricelist: async () => {
      external_pricelist = await getBptfPrices(true);
    },
    calculateAndEmitPrices,
    updateKeyObject, // Update key price from pricedb.io
    updateMovingAverages: async (db, pgp) => {
      await updateMovingAverages(db, pgp);
    },
    db,
    pgp,
  });
  console.log('Scheduled tasks started.');

  startPriceWatcher();
  console.log('PriceWatcher started.');

  // After main pricing, fallback for unpriced items
  async function fallbackForUnpricedItems() {
    const allItemNames = await getAllPricedItemNamesWithEffects(
      external_pricelist,
      schemaManager,
      db
    );
    const pricelist = JSON.parse(fs.readFileSync(PRICELIST_PATH, 'utf8'));
    const pricedSkus = new Set(pricelist.items.map((i) => i.sku));
    const pricableSkus = new Set(await getPricableItems(db));
    const unpricedNames = allItemNames.filter((name) => {
      const sku = schemaManager.schema.getSkuFromName(name);
      return sku && !pricedSkus.has(sku) && !pricableSkus.has(sku);
    });
    const BATCH_SIZE = 10;
    const RATE_LIMIT_DELAY = 1500; // ms between batches
    const limit = pLimit(3); // Max 3 concurrent SCM requests
    for (let i = 0; i < unpricedNames.length; i += BATCH_SIZE) {
      const batch = unpricedNames.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map((name) =>
          limit(async () => {
            const sku = schemaManager.schema.getSkuFromName(name);
            if (!sku) {
              return;
            }
            // Prevent SCM fallback for keys
            if (sku === '5021;6') {
              console.warn(
                `SCM fallback attempted for keys (${name}, ${sku}) in fallbackForUnpricedItems - this is not allowed. Skipping SCM fallback.`
              );
              return;
            }
            // Try SCM fallback (if enabled)
            if (config.useScmFallback !== false) {
              try {
                const hashName = sku ? toMarketHashName(sku, schemaManager.schema) : name;
                const scmPrice = await getSCMPriceObject({
                  name: hashName,
                  keyMetal: keyobj.metal,
                  currency: 'USD',
                  scmMarginBuy: config.scmMarginBuy ?? 0,
                  scmMarginSell: config.scmMarginSell ?? 0,
                });
                if (scmPrice && (scmPrice.buy.metal > 0 || scmPrice.sell.metal > 0)) {
                  const item = {
                    name,
                    sku,
                    source: 'bptf',
                    time: Math.floor(Date.now() / 1000),
                    buy: scmPrice.buy,
                    sell: scmPrice.sell,
                  };
                  emitQueue.enqueue(item);
                  return;
                }
              } catch (e) {
                console.warn(`SCM fallback failed for ${name} (${sku}): ${e.message}`);
              }
            }
            // Try BPTF fallback
            try {
              const data = Methods.getItemPriceFromExternalPricelist(
                sku,
                external_pricelist,
                keyobj.metal,
                schemaManager
              );
              const pricetfItem = data.pricetfItem;
              if (
                !pricetfItem ||
                (pricetfItem.buy.keys === 0 && pricetfItem.buy.metal === 0) ||
                (pricetfItem.sell.keys === 0 && pricetfItem.sell.metal === 0)
              ) {
                return; // skip if no valid price
              }

              // Adjust prices: +25% sell, -25% buy
              const adjust = (val, percent) =>
                Math.max(0, Math.round((val + percent * val) * 100) / 100);

              const buy = {
                keys: pricetfItem.buy.keys,
                metal: adjust(pricetfItem.buy.metal, -0.25),
              };
              const sell = {
                keys: pricetfItem.sell.keys,
                metal: adjust(pricetfItem.sell.metal, 0.25),
              };
              if (
                pricetfItem &&
                (pricetfItem.buy.keys > 0 ||
                  pricetfItem.buy.metal > 0 ||
                  pricetfItem.sell.keys > 0 ||
                  pricetfItem.sell.metal > 0)
              ) {
                const item = {
                  name,
                  sku,
                  source: 'bptf',
                  time: Math.floor(Date.now() / 1000),
                  buy: buy,
                  sell: sell,
                };
                emitQueue.enqueue(item);
              }
            } catch (e) {
              console.warn(`BPTF fallback failed for ${name} (${sku}): ${e.message}`);
            }
          })
        )
      );
      if (i + BATCH_SIZE < unpricedNames.length) {
        await new Promise((res) => setTimeout(res, RATE_LIMIT_DELAY));
      }
    }
    console.log(
      `Fallback pass: emitted fallback prices for ${unpricedNames.length} items not in pricelist and with <3 buy/sell listings.`
    );
  }

  // priceAllItems functionality has been removed for public release
  // Users must now add items manually through GUI or file editing
  console.log('Auto-pricing only items added through GUI or item_list.json');
});

// Is the move from the last accepted price (prev, from the pricelist) to next
// small enough to take at once? A large move is held and only accepted once it
// persists confirmCycles cycles (the streak in finalisePrice).
//
// The reference is the last accepted price, not the average of the last five
// price_history rows as it used to be: after a large move was confirmed and
// written, four of those five rows still held the old price, so the very same
// price was a "swing" again on the next cycle - Classy Capper logged
// "persisted 4 cycles, accepting" immediately followed by "holding (1/4)". The
// confirm streak already provides the persistence.
function isPriceSwingAcceptable(prev, next) {
  const prevBuy = Methods.toMetal(prev.buy, keyobj.metal);
  const prevSell = Methods.toMetal(prev.sell, keyobj.metal);
  const nextBuy = Methods.toMetal(next.buy, keyobj.metal);
  const nextSell = Methods.toMetal(next.sell, keyobj.metal);

  const maxBuyIncrease = config.priceSwingLimits?.maxBuyIncrease ?? 0.1;
  const maxSellDecrease = config.priceSwingLimits?.maxSellDecrease ?? 0.1;
  // Cheap items move in whole scrap: one scrap on a 1 ref hat is already 11%,
  // so a percentage-only guard held every routine one or two scrap move for
  // confirmCycles (an hour) and left the item off the market meanwhile. A
  // move of at most ignoreBelowMetal is never a swing.
  const small = Number(config.priceSwingLimits?.ignoreBelowMetal);
  const ignoreBelow = Number.isFinite(small) ? small : 0.33;

  const buyUp = nextBuy - prevBuy;
  if (prevBuy > 0 && buyUp > ignoreBelow && buyUp / prevBuy > maxBuyIncrease) {
    return false;
  }
  const sellDown = prevSell - nextSell;
  if (prevSell > 0 && sellDown > ignoreBelow && sellDown / prevSell > maxSellDecrease) {
    return false;
  }
  return true;
}

// A metal amount as keys + metal, the way the pricelist stores prices.
function metalToCurrencies(metal) {
  const keys = Math.trunc(metal / keyobj.metal);
  return { keys, metal: Methods.getRight(metal - keys * keyobj.metal) };
}

// The live book for an item: its buy and sell listings from the websocket
// mirror (with the 'The ' + name fallback), and the same rows without our own
// bots' listings. Shared by determinePrice and the crossing guard.
//
// deleteOldListings is deliberately NOT called here. calculateAndEmitPrices
// already runs it once per cycle; running it again per item (15 at a time)
// re-swept the whole listings table thousands of times per cycle for deletes
// that the first sweep had already made.
async function loadBook(name) {
  let buyListings = await getListings(db, name, 'buy');
  let sellListings = await getListings(db, name, 'sell');

  // If not enough listings, try with 'The ' prefix (if not already present)
  if ((!buyListings || buyListings.rowCount === 0) && !name.startsWith('The ')) {
    buyListings = await getListings(db, 'The ' + name, 'buy');
  }
  if ((!sellListings || sellListings.rowCount === 0) && !name.startsWith('The ')) {
    sellListings = await getListings(db, 'The ' + name, 'sell');
  }

  const ownIds = new Set(config.ownBotSteamIDs || []);
  const notOwn = (l) => !ownIds.has(l.steamid);
  return {
    buyListings,
    sellListings,
    buyRows: (buyListings?.rows || []).filter(notOwn),
    sellRows: (sellListings?.rows || []).filter(notOwn),
  };
}

// Sort the book and pick the market (modules/marketPrice.js chooseMarket),
// with the item's 24 h history anchor when it has one. Returns the
// chooseMarket result plus the listing rows behind it: buyFiltered = the real
// bids (descending), sellFiltered = every ask (ascending), so market.askIndex
// / market.sellIndex index sellFiltered. `anchor` is the item's anchor or null.
//
// Listings are ordered by price. Trusted steam ids only break ties: moving
// them to the front regardless of price made the pricer average a trusted
// bot's low bid, or copy a trusted bot's high ask, over the real market.
function readMarket(buyRows, sellRows, sku) {
  const anchor = (sku && cycleAnchors.get(sku)) || null;
  const priceOf = (l) => Methods.toMetal(l.currencies, keyobj.metal);
  const trustRank = (l) => (prioritySteamIds.includes(l.steamid) ? 0 : 1);
  const priced = (rows) => rows.filter((l) => Number.isFinite(priceOf(l)));

  // Ascending: cheapest ask first.
  const sellFiltered = priced(sellRows).sort(
    (a, b) => priceOf(a) - priceOf(b) || trustRank(a) - trustRank(b)
  );
  // Descending: best bid first. Every bid goes into chooseMarket, which drops
  // the ones too far above the ask to be for this item (painted/spelled/parted
  // variants the listing filter did not catch).
  const sortedBids = priced(buyRows).sort(
    (a, b) => priceOf(b) - priceOf(a) || trustRank(a) - trustRank(b)
  );

  const market = chooseMarket(sellFiltered.map(priceOf), sortedBids.map(priceOf), {
    ...marketOptions(config),
    anchorSell: anchor ? anchor.sell : null,
  });
  // Same cut-off chooseMarket applied, so these rows are exactly market.bids.
  const buyFiltered = sortedBids.filter((l) => priceOf(l) <= market.bidCeiling);
  return { market, buyFiltered, sellFiltered, anchor };
}

// Safety pass after the pricing loop. An item that was rejected, held or
// errored keeps its old price, and the market may have moved through it:
// Aristocravat sat at 3.5 / 3.83 for 18 hours with bids at 5.11, so the bots
// sold under the best bid. For every allowed item not written this cycle, read
// its book and let guardPrice fix a sell under the best bid or a buy over the
// market sell. Only the items that did not price are checked (a few dozen per
// cycle), one item's listings at a time, with the cycle's concurrency limit.
async function guardUnpricedItems(itemNames, itemsToWrite, priceHistoryEntries, prevBySku, limit) {
  const written = new Set(itemsToWrite.map((i) => i.sku));
  let bySku = prevBySku;
  if (!bySku) {
    bySku = new Map();
    for (const entry of JSON.parse(fs.readFileSync(PRICELIST_PATH, 'utf8')).items || []) {
      if (!bySku.has(entry.sku)) {
        bySku.set(entry.sku, entry);
      }
    }
  }

  const targets = [];
  for (const name of itemNames) {
    const sku = schemaManager.schema.getSkuFromName(name);
    if (!sku || sku === '5021;6' || written.has(sku)) {
      continue;
    }
    const entry = bySku.get(sku);
    if (entry && entry.buy && entry.sell) {
      targets.push({ name, sku, entry });
    }
  }
  if (targets.length === 0) {
    return;
  }

  let fixed = 0;
  await Promise.allSettled(
    targets.map(({ name, sku, entry }) =>
      limit(async () => {
        try {
          const { buyRows, sellRows } = await loadBook(name);
          if (buyRows.length === 0 && sellRows.length === 0) {
            return;
          }
          const { market } = readMarket(buyRows, sellRows, sku);
          const fix = guardPrice({
            buy: Methods.toMetal(entry.buy, keyobj.metal),
            sell: Methods.toMetal(entry.sell, keyobj.metal),
            bid: market.bid,
            // A junk ask (far above our own 24 h sell) is not where the item
            // sells: raising a crossed sell to it would park the item at 49
            // ref. Without it the sell goes one weapon over the best bid.
            marketSell: market.junkAsk ? null : market.sell,
          });
          if (!fix) {
            return;
          }
          const item = {
            ...entry,
            sku,
            source: 'bptf',
            time: Math.floor(Date.now() / 1000),
            buy: metalToCurrencies(fix.buy),
            sell: metalToCurrencies(fix.sell),
          };
          itemsToWrite.push(item);
          priceHistoryEntries.push({ sku, buy: fix.buy, sell: fix.sell });
          emitQueue.enqueue(item);
          // Keep why the item did not price next to what the guard did.
          const before = getStatus(name);
          const why =
            before && before.status !== 'guarded'
              ? ` (not priced: ${before.reason || before.status})`
              : '';
          recordStatus(name, 'guarded', fix.reason + why);
          console.log(`[GUARD] ${name}: ${fix.reason}`);
          fixed++;
        } catch (err) {
          console.warn(`[GUARD] ${name}: could not check the market (${err.message})`);
        }
      })
    )
  );
  console.log(
    `[GUARD] checked ${targets.length} item(s) that did not price this cycle, fixed ${fixed}.`
  );
}

const determinePrice = async (name, sku) => {
  const { buyListings, sellListings, buyRows, sellRows } = await loadBook(name);

  // Get the price of the item from the in-memory external pricelist.
  var data;
  try {
    data = Methods.getItemPriceFromExternalPricelist(
      sku,
      external_pricelist,
      keyobj.metal,
      schemaManager
    );
  } catch {
    throw new Error(`| UPDATING PRICES |: Couldn't price ${name}. Issue with BPTF baseline`);
  }

  var pricetfItem = data.pricetfItem;

  if (
    (pricetfItem.buy.keys === 0 && pricetfItem.buy.metal === 0) ||
    (pricetfItem.sell.keys === 0 && pricetfItem.sell.metal === 0)
  ) {
    // Prevent SCM fallback for keys
    if (sku === '5021;6') {
      console.warn(
        `SCM fallback attempted for keys (${name}, ${sku}) - this is not allowed. Skipping SCM fallback.`
      );
      throw new Error(
        `| UPDATING PRICES |: SCM fallback attempted for keys (${name}, ${sku}) - not allowed.`
      );
    }
    // Try SCM fallback before BPTF fallback (if enabled)
    if (config.useScmFallback !== false) {
      try {
        // Prefer SKU if available for hash name
        const hashName = sku ? toMarketHashName(sku, schemaManager.schema) : name;
        const scmPrice = await getSCMPriceObject({
          name: hashName,
          keyMetal: keyobj.metal,
          currency: 'USD',
        });
        if (scmPrice && (scmPrice.buy.metal > 0 || scmPrice.sell.metal > 0)) {
          return [scmPrice.buy, scmPrice.sell];
        }
      } catch (e) {
        // SCM fallback failed, continue to BPTF fallback
        console.warn(
          `SCM fallback failed for ${name} (${sku}): ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
    throw new Error(
      `| UPDATING PRICES |: Couldn't price ${name}. Item is not priced on bptf, PriceDB, or SCM yet, make a suggestion!, therefore we can't compare our average price to its average price.`
    );
  }

  const sellRequired = requiresSellListings();

  try {
    // Check for undefined. No listings.
    if (!buyListings || (sellRequired && !sellListings)) {
      throw new Error(`| UPDATING PRICES |: ${name} not enough listings...`);
    }
    // No bids at all is still priceable when the ask side is deep: getAverages
    // treats it as a sell-only market.
    const sellCount = sellListings?.rowCount || 0;
    if ((buyListings.rowCount === 0 && sellCount < 3) || (sellRequired && sellCount === 0)) {
      throw new Error(`| UPDATING PRICES |: ${name} not enough listings...`);
    }
  } catch (e) {
    // Prevent SCM fallback for keys
    if (sku === '5021;6') {
      console.warn(
        `SCM fallback attempted for keys (${name}, ${sku}) - this is not allowed. Skipping SCM fallback.`
      );
      throw new Error(
        `| UPDATING PRICES |: SCM fallback attempted for keys (${name}, ${sku}) - not allowed.`
      );
    }
    // Try PriceDB fallback first if enabled
    if (config.usePriceDbFallback) {
      try {
        const { getPriceDbPrice } = require('./modules/priceDbFetcher');
        const priceDbData = await getPriceDbPrice(sku);
        if (priceDbData && (priceDbData.buy.metal > 0 || priceDbData.sell.metal > 0)) {
          console.log(
            `PriceDB.io fallback used for ${name} (${sku}) due to insufficient listings.`
          );
          return [priceDbData.buy, priceDbData.sell];
        }
      } catch (priceDbErr) {
        console.warn(
          `PriceDB.io fallback failed for ${name} (${sku}): ${priceDbErr instanceof Error ? priceDbErr.message : String(priceDbErr)}`
        );
      }
    }

    // Try SCM fallback if PriceDB didn't work (if enabled)
    if (config.useScmFallback !== false) {
      try {
        const hashName = sku ? toMarketHashName(sku, schemaManager.schema) : name;
        const scmPrice = await getSCMPriceObject({
          name: hashName,
          keyMetal: keyobj.metal,
          currency: 'USD',
        });
        if (scmPrice && (scmPrice.buy.metal > 0 || scmPrice.sell.metal > 0)) {
          console.log(`SCM fallback used for ${name} (${sku}) due to insufficient listings.`);
          return [scmPrice.buy, scmPrice.sell];
        }
      } catch (scmErr) {
        console.warn(
          `SCM fallback failed for ${name} (${sku}): ${scmErr instanceof Error ? scmErr.message : String(scmErr)}`
        );
      }
    }
    if (fallbackOntoPricesTf) {
      const final_buyObj = {
        keys: pricetfItem.buy.keys,
        metal: pricetfItem.buy.metal,
      };
      const final_sellObj = {
        keys: pricetfItem.sell.keys,
        metal: pricetfItem.sell.metal,
      };
      // Return prices.tf price.
      return [final_buyObj, final_sellObj];
    }
    // If we don't fallback onto bptf, re-throw the error.
    throw e;
  }

  // The market: which ask to sell at (not always the very lowest, see
  // chooseAskIndex), which bids are real, which bid to buy at, and what to do
  // when the bids meet the ask. sellFiltered may be empty when
  // priceWithoutSellListings is on - the sell price is then derived from the
  // buy price in getAverages.
  const { market, buyFiltered, sellFiltered, anchor } = readMarket(buyRows, sellRows, sku);
  anchorStats.droppedAboveAnchor += market.droppedAboveAnchor || 0;

  try {
    // If the buyFiltered or sellFiltered arrays are empty, we throw an error.
    let arr = await getAverages(name, buyFiltered, sellFiltered, sku, pricetfItem, market, anchor);
    return arr;
  } catch (e) {
    throw new Error(e);
  }
};

// buyFiltered: the real bids, descending. sellFiltered: every ask, ascending.
// market: the chooseMarket result for them (see readMarket). anchor: the
// item's 24 h history anchor, or null.
const getAverages = async (
  name,
  buyFiltered,
  sellFiltered,
  sku,
  pricetfItem,
  market,
  anchor = null
) => {
  const askIndex = market.askIndex;
  // Initialise two objects to contain the items final buy and sell prices.
  var final_buyObj = {
    keys: 0,
    metal: 0,
  };
  var final_sellObj = {
    keys: 0,
    metal: 0,
  };

  try {
    // Three bids normally. Two will do when the ask side is deep (3+ asks):
    // variant bids far above the ask are already dropped, and the thin-market
    // baseline check still runs. Without this an item that never reached three
    // bids kept its last price forever - the Winter cosmetic cases sat on buy
    // prices many times the market for days.
    const minBids = sellFiltered.length >= 3 ? 2 : 3;
    // Nobody bidding but plenty asking is a sell-only market (junk cases: 167
    // bots selling at a weapon, no buyers). The buy side is then derived from
    // the ask below, after the ask is picked.
    let sellOnly = false;
    if (buyFiltered.length < minBids) {
      if (sellFiltered.length < 3) {
        throw new Error(`| UPDATING PRICES |: ${name} not enough buy listings...`);
      }
      sellOnly = true;
    } else {
      // Buy at the best supported bid (robustBestBid in modules/marketPrice.js):
      // the highest bid that a second bidder backs or that sits close under the
      // ask. This replaced the mean of the top three bids (and a z-score outlier
      // filter from 10 bids up), which under-priced the buy whenever the bids
      // were spread out: Standing Offer, bids 19.22 / 15 / 2.88 under a 19.33
      // ask, was bought at 12.38 instead of 19.22; Sir Buildsalot, two bidders
      // at 16.11, at 13.44. Keys stay pure metal.
      final_buyObj =
        sku === '5021;6' ? { keys: 0, metal: market.bid } : metalToCurrencies(market.bid);
    }
    // Sell at the market ask (the lowest listing, or the next one up when the
    // lowest is an isolated undercut — see chooseAskIndex). This used to skip
    // any ask that disagreed with the item's own recent sell prices, which
    // anchored a wrong price to itself: an item priced at 40 ref kept
    // rejecting the 1.44 ref asks as outliers for days.
    //
    // In a locked market (the best bid meets the ask) the sell is the first
    // ask above the best bid instead, or a margin over the bid when no ask
    // within lockedNextAskMaxPct is above it (chooseMarket). The sell-only branch
    // keeps the market ask. No per-item log line here: ~128 items are locked
    // at any time and the note on the result reaches the dashboard.
    let marketNote = '';
    if (sellFiltered.length > 0) {
      let picked = sellFiltered[Math.min(askIndex, sellFiltered.length - 1)];
      if (!sellOnly && market.sellFrom === 'next-ask') {
        picked = sellFiltered[market.sellIndex];
        marketNote = `Locked market: selling at the next ask ${market.sell} ref`;
      } else if (!sellOnly && market.sellFrom === 'margin') {
        picked = null;
        final_sellObj =
          sku === '5021;6' ? { keys: 0, metal: market.sell } : metalToCurrencies(market.sell);
        marketNote = `Locked market, no usable ask above the bid: selling at ${market.sell} ref`;
      }

      if (picked) {
        // For keys, the listing currencies should already be in pure metal format (keys: 0, metal: X)
        // For other items, this preserves the key+metal format from the listing
        final_sellObj.keys = Object.is(picked.currencies.keys, undefined)
          ? 0
          : picked.currencies.keys;
        final_sellObj.metal = Object.is(picked.currencies.metal, undefined)
          ? 0
          : picked.currencies.metal;
      }

      if (sellOnly) {
        // Buy a margin under the ask. Below a weapon the pair cannot be
        // expressed - tf2autobot needs buy > 0 and sell > buy - so the
        // smallest legal pair is buy 0.05 / sell 0.11, one weapon over the
        // market. Anything priced in keys is left unpriced instead: a lone
        // ask on a key-priced item with no bids is not a market.
        const askInMetal = Methods.toMetal(final_sellObj, keyobj.metal);
        if (askInMetal >= keyobj.metal) {
          throw new Error(
            `| UPDATING PRICES |: ${name} not enough buy listings (sell-only market at ${askInMetal} ref is too large to price from the ask alone)`
          );
        }
        // With no bids at all the buy would be 0.05 against whatever the ask
        // is - fine for junk at a weapon or two, nonsense for an item that
        // momentarily has nobody bidding (31488;6 went out as 0.05 / 42.33).
        // Keep the last price instead.
        const maxAskWithoutBids = Number(config.sellOnly?.maxAskWithoutBidsMetal ?? 1);
        if (buyFiltered.length === 0 && askInMetal > maxAskWithoutBids) {
          throw new Error(
            `| UPDATING PRICES |: ${name} not enough buy listings (no bids and the ${askInMetal} ref ask is above ${maxAskWithoutBids} ref, so it cannot be priced from the ask alone)`
          );
        }
        // A margin under the ask, but never above the best bid if there is
        // one (a lone 0.05 bid under a 0.88 ask says nobody wants the item),
        // and the smallest legal buy when there are no bids at all.
        const pct = Number(config.minSellMarginPercent) || 0.03;
        const margin = Math.max(config.minSellMargin ?? 0.11, Methods.getRight(askInMetal * pct));
        let buyInMetal = Methods.getRight(askInMetal - margin);
        if (buyFiltered.length) {
          buyInMetal = Math.min(
            buyInMetal,
            Methods.toMetal(buyFiltered[0].currencies, keyobj.metal)
          );
        } else {
          buyInMetal = 0.05;
        }
        let sellInMetal = askInMetal;
        if (!(buyInMetal >= 0.05)) {
          buyInMetal = 0.05;
        }
        // tf2autobot rejects buy >= sell, and finalisePrice would try to push
        // the buy under a 0.05 ask and find no room. Sell a weapon over the
        // buy instead: 0.05 / 0.11 is the smallest legal pair.
        if (sellInMetal <= buyInMetal) {
          sellInMetal = Methods.getRight(buyInMetal + 0.05);
        }
        final_buyObj = { keys: 0, metal: buyInMetal };
        final_sellObj = { keys: 0, metal: sellInMetal };
        console.log(
          `| UPDATING PRICES |: ${name} has ${buyFiltered.length} bid(s) and ${sellFiltered.length} asks - ` +
            `sell-only market, buying ${buyInMetal} ref under the ${askInMetal} ref ask, selling ${sellInMetal} ref.`
        );
      }

      if (sku === '5021;6') {
        console.log(
          `DEBUG: Key sell price from picked listing - keys: ${final_sellObj.keys}, metal: ${final_sellObj.metal}`
        );
      }
    } else if (config.priceWithoutSellListings?.enabled === true) {
      // No sell listings yet. Rather than leave the item unpriced, derive a
      // placeholder sell price from the buy price so the bot can start
      // stocking it. Replaced by a real average as soon as sell listings
      // arrive. The maxPercentageDifferences.sell guard below still applies,
      // so a placeholder that undercuts the bptf baseline is rejected.
      const buyInMetal = Methods.toMetal(final_buyObj, keyobj.metal);
      // buy + max(flat ref, percent of buy). A flat 5 ref turned 1 ref hats into
      // 6 ref sell prices that never sold.
      const marginRef = Math.max(
        Number(config.priceWithoutSellListings.sellMarginRef) || 0.22,
        Methods.getRight(
          buyInMetal * (Number(config.priceWithoutSellListings.sellMarginPercent) || 0.1)
        )
      );

      // A flat margin only makes sense below a key. At or above that, the margin
      // is a rounding error against the item's value, so fall back to the normal
      // rule and wait for real sell listings. Keys themselves are excluded
      // outright — a key's buy price sits just under keyobj.metal and would
      // otherwise slip through this check.
      if (sku === '5021;6' || buyInMetal >= keyobj.metal) {
        throw new Error(
          `| UPDATING PRICES |: ${name} not enough sell listings... ` +
            `(buy ${buyInMetal} ref is at or above a key, so the ` +
            `buy + ${marginRef} ref placeholder does not apply)`
        );
      }

      // The buy price is below a key but buy + margin can still cross one, so
      // normalise into keys + remainder the same way the main path does.
      const sellInMetal = Methods.getRight(buyInMetal + marginRef);
      const sellKeys = Math.trunc(sellInMetal / keyobj.metal);
      final_sellObj.keys = sellKeys;
      final_sellObj.metal = Methods.getRight(sellInMetal - sellKeys * keyobj.metal);

      console.log(
        `| UPDATING PRICES |: ${name} has no sell listings — using buy + ${marginRef} ref ` +
          `placeholder (${final_sellObj.keys} keys + ${final_sellObj.metal} ref).`
      );
    } else {
      throw new Error(`| UPDATING PRICES |: ${name} not enough sell listings...`);
    }

    // Ramp cap: the buy may rise at most maxBuyRisePct (min maxBuyRiseMetal)
    // over our own 24 h median buy (modules/historyAnchor.js). The swing guard
    // only sees one cycle's step, so a pump that walks the bids up 1-3% a
    // cycle went straight through it: Snug Sharpshooter's buy crept 4.44 ->
    // 6.5 ref in 16 hours, then jumped to 18 and 24, and Lia bought 50 of a
    // 3.3 ref hat at 6.40 and 22.20. Only ever lowers the buy.
    let rampNote = '';
    const buyCap = rampCap(anchor, config.historyAnchor);
    if (buyCap !== null) {
      const buyMetal = Methods.toMetal(final_buyObj, keyobj.metal);
      if (buyMetal > buyCap + 0.005) {
        final_buyObj = sku === '5021;6' ? { keys: 0, metal: buyCap } : metalToCurrencies(buyCap);
        anchorStats.rampCapped++;
        const h = config.historyAnchor || {};
        const risePct = Math.round(Number(h.maxBuyRisePct ?? 0.25) * 100);
        const hours = Number(h.windowHours) || 24;
        rampNote =
          `Buy ramp-capped at +${risePct}%/${hours === 24 ? 'day' : `${hours} h`}: ` +
          `market bid ${buyMetal} ref, ${hours} h median ${Methods.getRight(anchor.buy)} ref`;
      }
    }
    const dropNote = market.droppedAboveAnchor
      ? `${market.droppedAboveAnchor} bid(s) above the ${Number(config.historyAnchor?.windowHours) || 24} h anchor ignored`
      : '';

    // Tie the sell to the bids: an ask side that is all bots at an absurd
    // price is not the market (modules/sellAnchor.js). Only on a real ask
    // (the market ask or the next ask up), not the sell-only, locked-margin or
    // placeholder paths.
    let anchorNote = '';
    if (!sellOnly && sellFiltered.length > 0 && market.sellFrom !== 'margin' && sku !== '5021;6') {
      const buyMetal = Methods.toMetal(final_buyObj, keyobj.metal);
      const askMetal = Methods.toMetal(final_sellObj, keyobj.metal);
      const baselineSellMetal =
        pricetfItem?.sell && typeof pricetfItem.sell.metal === 'number'
          ? Methods.toMetal(
              { keys: Number(pricetfItem.sell.keys) || 0, metal: pricetfItem.sell.metal },
              keyobj.metal
            )
          : null;
      const anchorOpts = config.sellAnchor || {};
      const anchored = anchorSell(
        {
          buyMetal,
          sellMetal: askMetal,
          baselineSellMetal,
          nBids: market.nBids,
          anchorSellMetal: anchor ? anchor.sell : null,
          junkAsk: market.junkAsk === true,
        },
        anchorOpts
      );
      if (anchored.capped) {
        const cap = anchored.sellMetal;
        const keys = Math.trunc(cap / keyobj.metal);
        final_sellObj = { keys, metal: Methods.getRight(cap - keys * keyobj.metal) };
        const pct = Number(anchorOpts.maxAboveBuyPct ?? SELL_ANCHOR_DEFAULTS.maxAboveBuyPct);
        console.log(
          `| UPDATING PRICES |: ${name} sell anchored: the ${askMetal} ref ask is more than ` +
            `${Math.round(pct * 100)}% over the ${buyMetal} ref buy (${buyFiltered.length} bids) - ` +
            `selling at ${cap} ref instead.`
        );
        anchorNote = `Sell anchored: ask ${askMetal} ref far above bids`;
      }
    }

    // Sell ramp floor, the mirror of the buy ramp: the sell may fall at most
    // maxSellDropPct (or maxSellDropMetal) under our own 24 h median sell,
    // and never to or under the buy (modules/historyAnchor.js). Without it
    // only the swing guard's four-cycle hold stood between three fake cheap
    // asks and our stock being sold to the lister cheap. Only on a real ask:
    // the sell-only, placeholder and locked-margin sells are derived from the
    // bids/ask already.
    let floorNote = '';
    if (!sellOnly && sellFiltered.length > 0 && market.sellFrom !== 'margin') {
      const floor = sellFloor(anchor, config.historyAnchor);
      const askMetal = Methods.toMetal(final_sellObj, keyobj.metal);
      const floored = floorSell(askMetal, Methods.toMetal(final_buyObj, keyobj.metal), floor);
      if (floored.floored) {
        final_sellObj =
          sku === '5021;6' ? { keys: 0, metal: floored.sell } : metalToCurrencies(floored.sell);
        anchorStats.sellFloored++;
        const h = config.historyAnchor || {};
        const dropPct = Math.round(Number(h.maxSellDropPct ?? 0.25) * 100);
        const hours = Number(h.windowHours) || 24;
        floorNote =
          `Sell ramp-floored at -${dropPct}%/${hours === 24 ? 'day' : `${hours} h`}: ` +
          `market ask ${askMetal} ref, ${hours} h median ${Methods.getRight(anchor.sell)} ref`;
      }
    }

    var usePrices = false;
    // When the listings agree with each other they are the price, and the bptf
    // community value is not consulted. That value lags badly: the median
    // baseline entry is 165 days old (90% are older than 30 days), and letting
    // it veto a consistent market froze items at stale prices for many hours -
    // Aristocravat (bids 5.11 x2 and 5 x4, one ask at 6.33) was rejected for
    // 18 h as "buying for too much" against a 3.22 ref baseline while the bots
    // sold it under the bids. The listings are trusted when either
    //   - the market is deep: enough bids and enough asks (the old rule, which
    //     a one-ask market never meets), or
    //   - it is self-consistent: two or more real bids, at least one ask, at
    //     least `total` listings in all, and the market ask within
    //     maxAskToBidRatio of the supported bid (so the two sides describe the
    //     same item, not a junk ask over a lowball bid).
    // The baseline check stays for thin, one-sided or contradictory markets.
    const deep = {
      buy: 5,
      sell: 3,
      total: 5,
      ...(config.baselineCheck?.skipWhenListingsAtLeast || {}),
    };
    const nAsks = sellFiltered.length;
    const deepMarket = market.nBids >= deep.buy && nAsks >= deep.sell;
    const askToBidRatio = Number.isFinite(Number(config.maxAskToBidRatio))
      ? Number(config.maxAskToBidRatio)
      : 3;
    const consistentMarket =
      !sellOnly &&
      market.nBids >= 2 &&
      nAsks >= 1 &&
      market.nBids + nAsks >= Number(deep.total) &&
      market.bid > 0 &&
      market.ask !== null &&
      market.ask <= market.bid * askToBidRatio;
    try {
      // Will return true or false. True if we are ok with the autopricers price, false if we are not.
      // We use prices.tf as a baseline.
      usePrices =
        deepMarket ||
        consistentMarket ||
        Methods.calculatePricingAPIDifferences(pricetfItem, final_buyObj, final_sellObj, keyobj);
    } catch (e) {
      // Create an error object with a message detailing this difference.
      throw new Error(`| UPDATING PRICES |: Our autopricer determined that name ${name} should sell for : ${final_sellObj.keys} keys and 
            ${final_sellObj.metal} ref, and buy for ${final_buyObj.keys} keys and ${final_buyObj.metal} ref. Baseline
            determined I should sell for ${pricetfItem.sell.keys} keys and ${pricetfItem.sell.metal} ref, and buy for
            ${pricetfItem.buy.keys} keys and ${pricetfItem.buy.metal} ref. Message returned by the method: ${e.message}`);
    }

    // if-else statement probably isn't needed, but I'm just being cautious.
    if (usePrices) {
      // The final averages are returned here. But work is still needed to be done. We can't assume that the buy average is
      // going to be lower than the sell average price. So we need to check for this later.
      if (sku === '5021;6') {
        console.log(
          `DEBUG: Key final prices from getAverages - buy: {keys: ${final_buyObj.keys}, metal: ${final_buyObj.metal}}, sell: {keys: ${final_sellObj.keys}, metal: ${final_sellObj.metal}}`
        );
      }
      const result = [final_buyObj, final_sellObj];
      const note = [marketNote, dropNote, rampNote, anchorNote, floorNote]
        .filter(Boolean)
        .join('; ');
      if (note) {
        result.note = note;
      }
      return result;
    } else {
      throw new Error(`| UPDATING PRICES |: ${name} pricing average generated by autopricer is too dramatically
            different to one returned by bptf`);
    }
  } catch (error) {
    // If configured, we fallback onto bptf for the price.
    if (fallbackOntoPricesTf) {
      const final_buyObj = {
        keys: pricetfItem.buy.keys,
        metal: pricetfItem.buy.metal,
      };
      const final_sellObj = {
        keys: pricetfItem.sell.keys,
        metal: pricetfItem.sell.metal,
      };
      if (sku === '5021;6') {
        console.log(
          `DEBUG: Key fallback prices from bptf - buy: {keys: ${final_buyObj.keys}, metal: ${final_buyObj.metal}}, sell: {keys: ${final_sellObj.keys}, metal: ${final_sellObj.metal}}`
        );
      }
      return [final_buyObj, final_sellObj];
    } else {
      // We re-throw the error.
      throw error;
    }
  }
};

function clamp(val, min, max) {
  // If min is not a number, we don't clamp the value.
  // If max is not a number, we don't clamp the value.
  if (typeof min === 'number' && val < min) {
    return min;
  }
  if (typeof max === 'number' && val > max) {
    return max;
  }
  return val;
}

const finalisePrice = async (arr, name, sku, prevBySku = null) => {
  let item = {};
  try {
    if (!arr) {
      console.log(
        `| UPDATING PRICES |:${name} couldn't be updated. CRITICAL, something went wrong in the getAverages logic.`
      );
      throw new Error('Something went wrong in the getAverages() logic. DEVELOPER LOOK AT THIS.');
      // Will ensure that neither the buy, nor sell side is completely unpriced. If it is, this means we couldn't get
      // enough listings to create a price, and we also somehow bypassed our prices.tf safety check. So instead, we
      // just skip this item, disregarding the price.
    } else if (
      (arr[0].metal === 0 && arr[0].keys === 0) ||
      (arr[1].metal === 0 && arr[1].keys === 0)
    ) {
      throw new Error('Missing buy and/or sell side.');
    } else {
      // Creating item fields/filling in details.
      // Name of the item. Left as it was.
      item.name = name;
      // Add sku to item object.
      item.sku = sku;
      // If the source isn't provided as bptf it's ignored by tf2autobot.
      item.source = 'bptf';
      // Generates a UNIX timestamp of the present time, used to show a client when the prices were last updated.
      item.time = Math.floor(Date.now() / 1000);

      // Round both sides to the nearest weapon (half scrap), see getRight.
      arr[0].metal = Methods.getRight(arr[0].metal);
      arr[1].metal = Methods.getRight(arr[1].metal);

      // We are taking the buy array price as a whole, and also passing in the current selling price
      // for a key into the parsePrice method.
      // We are taking the sell array price as a whole, and also passing in the current selling price
      // for a key into the parsePrice method.
      // Skip parsePrice for keys - they should always be in pure metal format
      if (sku !== '5021;6') {
        arr[0] = Methods.parsePrice(arr[0], keyobj.metal);
        arr[1] = Methods.parsePrice(arr[1], keyobj.metal);
      }

      // Clamp prices to bounds if set
      const bounds = getItemBounds().get(name) || {};
      // Clamp the buy and sell prices to the bounds set in the config.
      // If the bounds are not set, it will just use the default values of 0 and Infinity.
      arr[0].keys = clamp(arr[0].keys, bounds.minBuyKeys, bounds.maxBuyKeys);
      arr[0].metal = clamp(arr[0].metal, bounds.minBuyMetal, bounds.maxBuyMetal);
      arr[1].keys = clamp(arr[1].keys, bounds.minSellKeys, bounds.maxSellKeys);
      arr[1].metal = clamp(arr[1].metal, bounds.minSellMetal, bounds.maxSellMetal);

      // Safety net: a sell price at or below the buy price. getAverages now
      // handles locked markets itself (it sells at the next ask above the best
      // bid, see chooseMarket), so this should almost never fire - only when
      // item bounds or the sell anchor squeeze the pair together. Keep selling
      // at the sell and pull the buy price down under it by a margin. The old
      // rule did the opposite - kept the buy and set sell = buy + 5 ref -
      // which priced most cheap items at several times their value.
      const minSellMargin = config.minSellMargin ?? 0.11;
      var buyInMetal = Methods.toMetal(arr[0], keyobj.metal);
      var sellInMetal = Methods.toMetal(arr[1], keyobj.metal);
      // getAverages hangs a note on the array when it anchored the sell.
      let note = arr.note || '';

      if (buyInMetal >= sellInMetal) {
        const margin = Math.max(
          minSellMargin,
          Methods.getRight(sellInMetal * (Number(config.minSellMarginPercent) || 0.03))
        );
        const targetBuy = Methods.getRight(sellInMetal - margin);
        if (!(targetBuy > 0)) {
          throw new Error(`Sell ${sellInMetal} ref leaves no room for a buy price.`);
        }
        note = `Tight market: buy lowered to ask − ${margin} ref`;
        console.log(
          `| UPDATING PRICES |: ${name} buy (${buyInMetal} ref) was not below sell ` +
            `(${sellInMetal} ref) — buying at ${targetBuy} ref instead.`
        );
        const buyKeys = Math.trunc(targetBuy / keyobj.metal);
        item.buy = {
          keys: buyKeys,
          metal: Methods.getRight(targetBuy - buyKeys * keyobj.metal),
        };
        item.sell = {
          keys: arr[1].keys,
          metal: Methods.getRight(arr[1].metal),
        };
      } else {
        // For keys, always use pure metal format
        if (sku === '5021;6') {
          item.buy = {
            keys: 0,
            metal: Methods.getRight(arr[0].metal),
          };
          item.sell = {
            keys: 0,
            metal: Methods.getRight(arr[1].metal),
          };
        } else {
          item.buy = {
            keys: arr[0].keys,
            metal: Methods.getRight(arr[0].metal),
          };
          item.sell = {
            keys: arr[1].keys,
            metal: Methods.getRight(arr[1].metal),
          };
        }
      }

      // Previous price, from the map the caller built once for this cycle.
      // Falls back to a disk read only if called without one.
      const prev = prevBySku
        ? prevBySku.get(sku)
        : JSON.parse(fs.readFileSync(PRICELIST_PATH, 'utf8')).items.find((i) => i.sku === sku);

      // Only check if previous price exists (skip price swing check for keys)
      // A previous price that is hours old is not "the" price any more, so a
      // big move away from it is not a spike to confirm. Without this a
      // stale item was re-held for confirmCycles after every restart (the
      // streaks live in memory) and could stay wrong for days.
      const staleHoursCfg = Number(config.priceSwingLimits?.staleAfterHours);
      const staleAfterSec =
        (Number.isFinite(staleHoursCfg) && staleHoursCfg > 0 ? staleHoursCfg : 6) * 3600;
      const prevAgeSec = prev ? Math.floor(Date.now() / 1000) - Number(prev.time || 0) : 0;
      const prevIsStale = !!prev && prevAgeSec > staleAfterSec;
      if (prevIsStale) {
        console.log(
          `| UPDATING PRICES |: ${name} previous price is ${Math.round(prevAgeSec / 3600)}h old, swing guard skipped.`
        );
        swingStreaks.delete(sku);
      }

      let swingConfirmed = false;
      if (prev && !prevIsStale && sku !== '5021;6') {
        const prevObj = { buy: prev.buy, sell: prev.sell };
        const nextObj = { buy: item.buy, sell: item.sell };
        const swingOk = isPriceSwingAcceptable(prevObj, nextObj);
        if (!swingOk) {
          // The guard stops one-cycle spikes. A move that is still there after
          // confirmCycles consecutive cycles is the market, not a spike - without
          // this an item whose price really moved stayed frozen forever, since
          // the history it is compared against only updates on acceptance.
          const needed = Number(config.priceSwingLimits?.confirmCycles) || 4;
          const streak = (swingStreaks.get(sku) || 0) + 1;
          if (streak < needed) {
            swingStreaks.set(sku, streak);
            console.log(
              `Price swing too large for ${name} (${sku}), holding (${streak}/${needed}).`
            );
            recordStatus(name, 'swing-held', `Large move, confirming ${streak}/${needed}`);
            return;
          }
          console.log(`Price swing for ${name} (${sku}) persisted ${streak} cycles, accepting.`);
          recordStatus(name, 'swing-confirmed', `Large move accepted after ${streak} cycles`);
          swingConfirmed = true;
        }
        swingStreaks.delete(sku);
      }

      // Save to price history
      return {
        item,
        note,
        swingConfirmed,
        priceHistory: {
          sku,
          buy: Methods.toMetal(item.buy, keyobj.metal),
          sell: Methods.toMetal(item.sell, keyobj.metal),
        },
      };
    }
  } catch (err) {
    // If the autopricer failed to price the item, we don't update the items price.
    recordStatus(name, 'error', shortReason(err?.message));
    return;
  }
};

// Initialize the websocket and pass in dependencies
const bptfWebSocket = initBptfWebSocket({
  getAllowedItemNames,
  allowAllItems,
  schemaManager,
  Methods,
  onListingUpdate: (sku) => updatedSkus.add(sku),
  insertListing: (...args) => insertListing(db, updateListingStats, ...args),
  insertListingsBatch: (listings) => insertListingsBatch(pgp, db, updateListingStats, listings),
  deleteRemovedListing: (...args) => deleteRemovedListing(db, updateListingStats, ...args),
  excludedSteamIds,
  excludedListingDescriptions,
  blockedAttributes,
  logFile,
  config,
});

// Provide websocket stats to the API
setWebSocketStatsProvider(() => bptfWebSocket.getStats());

// Add websocket health monitoring to the periodic tasks
setInterval(() => {
  const stats = bptfWebSocket.getStats();
  const timeSinceLastMessage = Math.round(stats.timeSinceLastMessage / 1000);

  if (timeSinceLastMessage > 300) {
    // 5 minutes
    console.warn(`[HEALTH] WebSocket hasn't received messages for ${timeSinceLastMessage}s`);
  }

  // Log periodic health status
  console.log(
    `[HEALTH] WebSocket: ${stats.messageCount} messages, last ${timeSinceLastMessage}s ago, connected: ${stats.isConnected}`
  );
}, 60000); // Check every minute

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing websocket...');
  bptfWebSocket.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing websocket...');
  bptfWebSocket.close();
  process.exit(0);
});

listen();

// When the policy file changes, push the affected SKUs to the bots at once
// from the stored market prices, instead of waiting for the next pricing
// cycle. SKUs that left the policy are re-emitted too, so they fall back to
// market. A change to the global rules (skus === null) re-emits everything.
pricePolicy.watch((changed) => {
  let stored;
  try {
    stored = JSON.parse(fs.readFileSync(PRICELIST_PATH, 'utf8')).items || [];
  } catch (err) {
    console.error('[POLICY] could not read pricelist for re-emit:', err.message);
    return;
  }
  const bySku = new Map();
  for (const entry of stored) {
    if (!bySku.has(entry.sku)) {
      bySku.set(entry.sku, entry);
    }
  }
  const skus = changed === null ? [...bySku.keys()] : changed;
  if (changed === null) {
    console.log(`[POLICY] global rules changed; re-emitting all ${skus.length} items`);
  }
  let sent = 0;
  for (const sku of skus) {
    const entry = bySku.get(sku);
    if (!entry) {
      console.log(`[POLICY] ${sku} changed but is not in the pricelist; nothing to re-emit`);
      continue;
    }
    emitQueue.enqueue({ ...entry, time: Math.floor(Date.now() / 1000) });
    sent++;
  }
  console.log(`[POLICY] policy changed for ${skus.length} SKU(s), re-emitted ${sent}`);
});

const { getSCMPriceObject, toMarketHashName } = require('./modules/scmPriceCalculator');

module.exports = { db };
