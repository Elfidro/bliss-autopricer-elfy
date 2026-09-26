// This file is part of the BPTF Autopricer project.
// It is a Node.js application that connects to Backpack.tf's WebSocket API,
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit').default; // For limiting concurrent operations
const Schema = require('@tf2autobot/tf2-schema');
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
pricePolicy.init({ path: PRICE_POLICY_PATH, methods: Methods, config });
const rawEnqueue = emitQueue.enqueue.bind(emitQueue);
emitQueue.enqueue = (item) => {
  const adjusted = pricePolicy.apply(item);
  if (adjusted !== item) {
    console.log(`[POLICY] ${item.name || item.sku}: ${pricePolicy.describe(item.sku)} -> buy ${adjusted.buy.keys}k ${adjusted.buy.metal} / sell ${adjusted.sell.keys}k ${adjusted.sell.metal}`);
  }
  rawEnqueue(adjusted);
};

const {
  fetchKeyPriceFromPriceDB,
} = require('./modules/keyPriceUtils');

const { updateMovingAverages, updateListingStats } = require('./modules/listingAverages');
const { recordStatus, shortReason } = require('./modules/pricingStatus');
const { recordAccuracy } = require('./modules/marketAccuracy');
const { chooseAskIndex } = require('./modules/marketPrice');

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

// sku -> consecutive cycles a price move has been held back by the swing guard.
const swingStreaks = new Map();

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
    // Fetch key price directly from pricedb.io
    const key_item = await fetchKeyPriceFromPriceDB();

    console.log(`Key item fetched from pricedb.io: ${JSON.stringify(key_item)}`);

    // Add to pricelist
    Methods.addToPricelist(key_item, PRICELIST_PATH);

    // Update keyobj for internal use
    keyobj = {
      metal: key_item.sell.metal,
    };

    // Emit the price update
    socketIO.emit('price', key_item);
  } catch (error) {
    console.error('Failed to update key price from pricedb.io:', error);
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

async function isPriceSwingAcceptable(prev, next, sku) {
  // Fetch last 5 prices from DB
  const history = await db.any(
    'SELECT buy_metal, sell_metal FROM price_history WHERE sku = $1 ORDER BY timestamp DESC LIMIT 5',
    [sku]
  );
  if (history.length === 0) {
    return true;
  } // No history, allow

  const avgBuy = history.reduce((sum, p) => sum + Number(p.buy_metal), 0) / history.length;
  const avgSell = history.reduce((sum, p) => sum + Number(p.sell_metal), 0) / history.length;

  const nextBuy = Methods.toMetal(next.buy, keyobj.metal);
  const nextSell = Methods.toMetal(next.sell, keyobj.metal);

  const maxBuyIncrease = config.priceSwingLimits?.maxBuyIncrease ?? 0.1;
  const maxSellDecrease = config.priceSwingLimits?.maxSellDecrease ?? 0.1;

  if (nextBuy > avgBuy && (nextBuy - avgBuy) / avgBuy > maxBuyIncrease) {
    return false;
  }
  if (nextSell < avgSell && (avgSell - nextSell) / avgSell > maxSellDecrease) {
    return false;
  }
  return true;
}

const determinePrice = async (name, sku) => {
  // deleteOldListings is deliberately NOT called here. calculateAndEmitPrices
  // already runs it once per cycle; running it again per item (15 at a time)
  // re-swept the whole listings table thousands of times per cycle for deletes
  // that the first sweep had already made.

  // Try fetching listings for both name and 'The ' + name if needed
  var buyListings = await getListings(db, name, 'buy');
  var sellListings = await getListings(db, name, 'sell');

  // If not enough listings, try with 'The ' prefix (if not already present)
  if ((!buyListings || buyListings.rowCount === 0) && !name.startsWith('The ')) {
    buyListings = await getListings(db, 'The ' + name, 'buy');
  }
  if ((!sellListings || sellListings.rowCount === 0) && !name.startsWith('The ')) {
    sellListings = await getListings(db, 'The ' + name, 'sell');
  }

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
    if (buyListings.rowCount === 0 || (sellRequired && sellListings.rowCount === 0)) {
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

  // Listings are ordered by price. Trusted steam ids only break ties: moving
  // them to the front regardless of price made the pricer average a trusted
  // bot's low bid, or copy a trusted bot's high ask, over the real market.
  const priceOf = (l) => Methods.toMetal(l.currencies, keyobj.metal);
  const trustRank = (l) => (prioritySteamIds.includes(l.steamid) ? 0 : 1);
  const ownIds = new Set(config.ownBotSteamIDs || []);

  // May be empty when priceWithoutSellListings is on — the sell price is then
  // derived from the buy price in getAverages.
  const sellRows = (sellListings?.rows || []).filter((l) => !ownIds.has(l.steamid));

  // Ascending: cheapest ask first.
  var sellFiltered = sellRows.sort((a, b) => priceOf(a) - priceOf(b) || trustRank(a) - trustRank(b));

  // The ask we sell at. Not always the very lowest: see chooseAskIndex. Every
  // bid goes in, including the ones above the asks - the rule ignores those.
  const bidPrices = buyListings.rows.filter((l) => !ownIds.has(l.steamid)).map(priceOf);
  const askIndex = chooseAskIndex(sellFiltered.map(priceOf), bidPrices, {
    gap: config.isolatedAskGap,
    maxAskToBidRatio: config.maxAskToBidRatio,
  });
  const marketAsk = sellFiltered.length ? priceOf(sellFiltered[askIndex]) : Infinity;

  // Descending: best bid first. A buy order above the ask is not a bid for
  // this item — nobody would pay more than an instant-buy price — it is for a
  // painted/spelled/parted variant the listing filter did not catch. Keeping
  // those inflated the buy average and was the main reason prices were
  // rejected as "buying for too much".
  var buyFiltered = buyListings.rows
    .filter((l) => !ownIds.has(l.steamid) && priceOf(l) <= marketAsk)
    .sort((a, b) => priceOf(b) - priceOf(a) || trustRank(a) - trustRank(b));

  try {
    // If the buyFiltered or sellFiltered arrays are empty, we throw an error.
    let arr = await getAverages(name, buyFiltered, sellFiltered, sku, pricetfItem, askIndex);
    return arr;
  } catch (e) {
    throw new Error(e);
  }
};

// Function to calculate the Z-score for a given value.
// The Z-score is a measure of how many standard deviations a value is from the mean.
const calculateZScore = (value, mean, stdDev) => {
  if (stdDev === 0) {
    throw new Error('Standard deviation cannot be zero.');
  }
  return (value - mean) / stdDev;
};

const filterOutliers = (listingsArray) => {
  // Calculate mean and standard deviation of listings.
  const prices = listingsArray.map((listing) => Methods.toMetal(listing.currencies, keyobj.metal));
  const mean = Methods.getRight(prices.reduce((acc, curr) => acc + curr, 0) / prices.length);
  const stdDev = Math.sqrt(
    prices.reduce((acc, curr) => acc + Math.pow(curr - mean, 2), 0) / prices.length
  );

  // Filter out listings that are 3 standard deviations away from the mean.
  // To put it plainly, we're filtering out listings that are paying either
  // too little or too much compared to the mean. When every listing has the
  // same price there is nothing to filter (and the z-score would divide by
  // zero, which used to throw and leave the item unpriced).
  const filteredListings =
    stdDev === 0
      ? listingsArray
      : listingsArray.filter((listing) => {
          const zScore = calculateZScore(Methods.toMetal(listing.currencies, keyobj.metal), mean, stdDev);
          return zScore <= 3 && zScore >= -3;
        });

  if (filteredListings.length < 3) {
    throw new Error('Not enough listings after filtering outliers.');
  }
  // Get the first 3 buy listings from the filtered listings and calculate the mean.
  // The listings here should be free of outliers. It's also sorted in order of
  // trusted steam ids (when applicable).
  var filteredMean = 0;
  for (var i = 0; i <= 2; i++) {
    filteredMean += +Methods.toMetal(filteredListings[i].currencies, keyobj.metal);
  }
  filteredMean /= 3;

  // Validate the mean.
  if (!filteredMean || isNaN(filteredMean) || filteredMean === 0) {
    throw new Error('Mean calculated is invalid.');
  }

  return filteredMean;
};

// askIndex: which of the ascending sellFiltered rows is the market ask (from
// chooseAskIndex; 0 when not given).
const getAverages = async (name, buyFiltered, sellFiltered, sku, pricetfItem, askIndex = 0) => {
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
    if (buyFiltered.length < 3) {
      throw new Error(`| UPDATING PRICES |: ${name} not enough buy listings...`);
    } else if (buyFiltered.length < 10) {
      // 3-9 listings: mean of the top 3 bids, averaged in metal. (Exactly 3 used
      // to fall through to the outlier filter, which cannot work on 3 points;
      // and keys/metal were averaged separately with the keys truncated, so
      // bids of 1 key, 2 keys and 1 key averaged to 1 key.)
      let totalMetal = 0;
      for (let i = 0; i <= 2; i++) {
        totalMetal += Methods.toMetal(buyFiltered[i].currencies, keyobj.metal);
      }
      const meanMetal = totalMetal / 3;
      if (sku === '5021;6') {
        final_buyObj = { keys: 0, metal: meanMetal };
      } else {
        const keys = Math.trunc(meanMetal / keyobj.metal);
        final_buyObj = { keys, metal: Methods.getRight(meanMetal - keys * keyobj.metal) };
      }
    } else {
      // Filter out outliers from set, and calculate a mean average price in terms of metal value.
      let filteredMean = filterOutliers(buyFiltered);

      // For keys (5021;6), keep the price as pure metal (keys: 0, metal: filteredMean)
      // For other items, convert to key+metal format
      if (sku === '5021;6') {
        final_buyObj = {
          keys: 0,
          metal: filteredMean,
        };
        console.log(`DEBUG: Key buy price (>=10 listings) - keys: 0, metal: ${filteredMean}`);
      } else {
        // Calculate the maximum amount of keys that can be made with the metal value returned.
        let keys = Math.trunc(filteredMean / keyobj.metal);
        // Calculate the remaining metal value after the value of the keys has been removed.
        let metal = Methods.getRight(filteredMean - keys * keyobj.metal);
        // Create the final buy object.
        final_buyObj = {
          keys: keys,
          metal: metal,
        };
      }
    }
    // Sell at the market ask (the lowest listing, or the next one up when the
    // lowest is an isolated undercut — see chooseAskIndex). This used to skip
    // any ask that disagreed with the item's own recent sell prices, which
    // anchored a wrong price to itself: an item priced at 40 ref kept
    // rejecting the 1.44 ref asks as outliers for days.
    if (sellFiltered.length > 0) {
      const picked = sellFiltered[Math.min(askIndex, sellFiltered.length - 1)];

      // For keys, the listing currencies should already be in pure metal format (keys: 0, metal: X)
      // For other items, this preserves the key+metal format from the listing
      final_sellObj.keys = Object.is(picked.currencies.keys, undefined)
        ? 0
        : picked.currencies.keys;
      final_sellObj.metal = Object.is(picked.currencies.metal, undefined)
        ? 0
        : picked.currencies.metal;

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
        Methods.getRight(buyInMetal * (Number(config.priceWithoutSellListings.sellMarginPercent) || 0.1))
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

    var usePrices = false;
    // With a deep market (enough independent bids and asks) the listings are
    // the price. The bptf community value often lags by months, and letting it
    // veto a well-supported market price froze items at stale prices. The
    // baseline check stays for thin markets, where a few listings could mislead.
    const deep = config.baselineCheck?.skipWhenListingsAtLeast || { buy: 5, sell: 3 };
    const deepMarket = buyFiltered.length >= deep.buy && sellFiltered.length >= deep.sell;
    try {
      // Will return true or false. True if we are ok with the autopricers price, false if we are not.
      // We use prices.tf as a baseline.
      usePrices =
        deepMarket ||
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
      return [final_buyObj, final_sellObj];
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

      // We're taking the buy JSON and getting the metal price from it, then rounding down to the nearest .11.
      arr[0].metal = Methods.getRight(arr[0].metal);
      // We're taking the sell JSON and getting the metal price from it, then rounding down to the nearest .11.
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

      // A sell price at or below the buy price means the market is tight (the
      // best bids meet the lowest ask). The ask is the real market price, so
      // keep selling there and pull the buy price down under it by a margin.
      // The old rule did the opposite - kept the buy and set sell = buy + 5 ref -
      // which priced most cheap items at several times their value.
      const minSellMargin = config.minSellMargin ?? 0.11;
      var buyInMetal = Methods.toMetal(arr[0], keyobj.metal);
      var sellInMetal = Methods.toMetal(arr[1], keyobj.metal);
      let note = '';

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
      let swingConfirmed = false;
      if (prev && sku !== '5021;6') {
        const prevObj = { buy: prev.buy, sell: prev.sell };
        const nextObj = { buy: item.buy, sell: item.sell };
        const swingOk = await isPriceSwingAcceptable(prevObj, nextObj, sku);
        if (!swingOk) {
          // The guard stops one-cycle spikes. A move that is still there after
          // confirmCycles consecutive cycles is the market, not a spike - without
          // this an item whose price really moved stayed frozen forever, since
          // the history it is compared against only updates on acceptance.
          const needed = Number(config.priceSwingLimits?.confirmCycles) || 4;
          const streak = (swingStreaks.get(sku) || 0) + 1;
          if (streak < needed) {
            swingStreaks.set(sku, streak);
            console.log(`Price swing too large for ${name} (${sku}), holding (${streak}/${needed}).`);
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
// market.
pricePolicy.watch((skus) => {
  let stored;
  try {
    stored = JSON.parse(fs.readFileSync(PRICELIST_PATH, 'utf8')).items || [];
  } catch (err) {
    console.error('[POLICY] could not read pricelist for re-emit:', err.message);
    return;
  }
  const bySku = new Map();
  for (const entry of stored) if (!bySku.has(entry.sku)) bySku.set(entry.sku, entry);
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
