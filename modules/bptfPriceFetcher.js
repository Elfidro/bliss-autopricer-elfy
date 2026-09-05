const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { getBaseConfigManager } = require('./baseConfigManager');

const CACHE_PATH = path.resolve(__dirname, '../bptf-prices.json');

// Fetch all prices from backpack.tf
async function getBptfPrices(force = false) {
  const config = getBaseConfigManager().getConfig();
  let cacheValid = false;
  if (fs.existsSync(CACHE_PATH)) {
    const stats = fs.statSync(CACHE_PATH);
    const age = (Date.now() - stats.mtimeMs) / 1000;
    if (age < (config.bptfPriceCacheSeconds || 7200) && !force) {
      cacheValid = true;
    }
  }
  if (cacheValid) {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  }
  // Fetch from API (no raw param)
  const response = await axios.get('https://api.backpack.tf/api/IGetPrices/v4', {
    params: { key: config.bptfAPIKey },
  });
  if (response.data && response.data.response && response.data.response.items) {
    // Written compact on purpose: pretty-printing rebuilds the whole ~9 MB
    // pricelist as a second, much larger string in memory for no benefit.
    fs.writeFileSync(CACHE_PATH, JSON.stringify(response.data.response.items), 'utf8');
    return response.data.response.items;
  }
  throw new Error('Failed to fetch backpack.tf prices');
}

// defindex -> [[name, item], ...] index for one external pricelist object.
//
// getBptfItemPrice used to run Object.entries(items).filter(...) on every call.
// `items` is the whole backpack.tf pricelist (tens of thousands of entries), so
// every lookup allocated a fresh array of that many two-element arrays - and it
// runs once per item on every pricing cycle. Indexing once per pricelist and
// reusing it removes that churn entirely.
//
// Keyed weakly on the pricelist object itself, so when the scheduler swaps in a
// freshly fetched pricelist the old index becomes collectable along with it.
const defindexIndexCache = new WeakMap();

function getDefindexIndex(items) {
  let index = defindexIndexCache.get(items);
  if (index) {
    return index;
  }
  index = new Map();
  const seen = new Set();
  for (const entry of Object.entries(items)) {
    const item = entry[1];
    if (!item || !item.defindex) {
      continue;
    }
    // `seen` guards against a defindex listed twice on the same item, which
    // Array.prototype.filter would only ever have matched once.
    seen.clear();
    for (const defindex of item.defindex) {
      if (seen.has(defindex)) {
        continue;
      }
      seen.add(defindex);
      const bucket = index.get(defindex);
      if (bucket) {
        bucket.push(entry);
      } else {
        index.set(defindex, [entry]);
      }
    }
  }
  defindexIndexCache.set(items, index);
  return index;
}

// Helper to get price for a specific SKU (handles unusuals and effects)
function getBptfItemPrice(items, sku) {
  // eslint-disable-next-line spellcheck/spell-checker
  // SKU (defindex;quality;Effect;...;australium;uncraftable)
  const parts = sku.split(';');
  const defindex = parts[0];
  const quality = parts[1];
  const effectPart = parts[2];
  const effect = effectPart && effectPart.startsWith('u') ? effectPart.slice(1) : null;
  const isAustralium = parts.includes('australium');
  const isUncraftable = parts.includes('uncraftable');

  // Find all items with this defindex
  const candidates = getDefindexIndex(items).get(Number(defindex)) || [];

  // eslint-disable-next-line spellcheck/spell-checker
  // Prefer Australium-named item if SKU has australium
  let itemEntry;
  if (isAustralium) {
    itemEntry = candidates.find(([name]) => name.toLowerCase().includes('australium'));
  }
  // Otherwise, prefer non-Australium
  if (!itemEntry) {
    itemEntry = candidates.find(([name]) => !name.toLowerCase().includes('australium'));
  }
  // Fallback to first candidate
  if (!itemEntry && candidates.length > 0) {
    itemEntry = candidates[0];
  }
  if (!itemEntry) {
    return null;
  }

  const item = itemEntry[1];
  if (!item.prices || !item.prices[quality]) {
    return null;
  }

  const tradable = item.prices[quality].Tradable;
  if (!tradable) {
    return null;
  }

  // Determine which craft type to use
  const craftType = isUncraftable ? 'Non-Craftable' : 'Craftable';
  const craftTypeData = tradable[craftType];

  if (!craftTypeData) {
    return null;
  }

  // For unusuals, find the correct effect
  if (quality === '5' && effect) {
    if (Array.isArray(craftTypeData)) {
      // craftTypeData is an array for unusuals (rare, but handle just in case)
      const effectObj = craftTypeData.find(
        (e) => String(e.effect) === effect && (!isAustralium || e.australium)
      );
      if (effectObj) {
        return effectObj;
      }
      // fallback to just effect match
      const fallbackEffectObj = craftTypeData.find((e) => String(e.effect) === effect);
      return fallbackEffectObj || craftTypeData[0];
    } else {
      // craftTypeData is an object keyed by effect ID
      const craftableArr = Object.entries(craftTypeData).map(([effectId, obj]) => ({
        ...obj,
        effect: effectId, // inject effect ID as property
      }));
      const effectObj = craftableArr.find(
        (e) => String(e.effect) === effect && (!isAustralium || e.australium)
      );
      if (effectObj) {
        return effectObj;
      }
      // fallback to just effect match
      const fallbackEffectObj = craftableArr.find((e) => String(e.effect) === effect);
      return fallbackEffectObj;
    }
  }

  // For australium, pick the entry with australium: true if present
  if (isAustralium && Array.isArray(craftTypeData)) {
    const aussieEntry = craftTypeData.find((e) => e.australium === true);
    if (aussieEntry) {
      return aussieEntry;
    }
  }

  // Otherwise, just return the first
  if (Array.isArray(craftTypeData)) {
    return craftTypeData[0];
  } else {
    // Sometimes it's an object keyed by price index
    return Object.values(craftTypeData)[0];
  }
}

async function getAllPricedItemNamesWithEffects(
  external_pricelist,
  schemaManager,
  dbConnection = null
) {
  // A Set from the start: this can generate hundreds of thousands of names, and
  // the old array-then-dedupe held both copies alive at peak.
  const names = new Set();
  const qualities = schemaManager.schema.qualities || {};
  const qualitiesById = {};
  for (const [name, id] of Object.entries(qualities)) {
    qualitiesById[id] = name.charAt(0).toUpperCase() + name.slice(1);
  }
  // Build effect ID -> name map using getUnusualEffects()
  const effectArray = schemaManager.schema.getUnusualEffects();
  const effects = {};
  for (const { id, name } of effectArray) {
    effects[id] = name;
  }

  // Build killstreak lookup map from database
  const killstreakMap = new Map();
  if (dbConnection) {
    try {
      // Query database once for all killstreak SKUs
      const query = `
        SELECT DISTINCT name, sku FROM tf2.listings 
        WHERE sku LIKE '%;kt-%'
      `;
      const result = await dbConnection.any(query);

      // Build map of item name -> set of killstreak tiers
      for (const row of result) {
        const { name: itemName, sku } = row;
        const ktMatch = sku.match(/;kt-(\d+)/);
        if (ktMatch) {
          const tier = parseInt(ktMatch[1], 10);
          if (!killstreakMap.has(itemName)) {
            killstreakMap.set(itemName, new Set([null])); // Always include base variant
          }
          killstreakMap.get(itemName).add(tier);
        }
      }
    } catch (error) {
      console.warn('Failed to query killstreak variants from database:', error.message);
    }
  }

  // Helper function to get killstreak variants for an item
  function getKillstreakTiers(itemName) {
    if (killstreakMap.has(itemName)) {
      return Array.from(killstreakMap.get(itemName)).sort((a, b) => (a || 0) - (b || 0));
    }
    return [null]; // Base variant only
  }

  // Killstreak tier mapping
  const killstreakTierNames = {
    null: null, // Base item (no killstreak)
    1: 'Killstreak',
    2: 'Specialized Killstreak',
    3: 'Professional Killstreak',
  };

  for (const itemName in external_pricelist) {
    const item = external_pricelist[itemName];

    // Get actual killstreak variants from database
    const killstreakTiers = getKillstreakTiers(itemName);

    for (const qualityId in item.prices) {
      const qualityObj = item.prices[qualityId];
      const qualityName = qualitiesById[qualityId] || '';
      if (qualityObj.Tradable) {
        // Process both Craftable and Non-Craftable items
        for (const craftType in qualityObj.Tradable) {
          const arrOrObj = qualityObj.Tradable[craftType];
          const isNonCraftable = craftType === 'Non-Craftable';
          const craftPrefix = isNonCraftable ? 'Non-Craftable ' : '';

          // Unusuals and rare qualities: Craftable/Non-Craftable is an object keyed by effect ID
          if (typeof arrOrObj === 'object' && !Array.isArray(arrOrObj)) {
            // Only add effect name for Unusuals (qualityId === '5')
            if (qualityId === '5') {
              for (const effectId in arrOrObj) {
                const effectName = effects[effectId] || effectId;
                // Generate all killstreak variants found in database
                for (const ksTier of killstreakTiers) {
                  const ksName = killstreakTierNames[ksTier];
                  const ksPrefix = ksName ? ksName + ' ' : '';
                  // Only add quality if not Unique (6) and not Unusual (5)
                  const prefix = qualityId !== '6' && qualityId !== '5' ? qualityName + ' ' : '';
                  // Compose: "Non-Craftable Strange Professional Killstreak Burning Flames Item"
                  names.add(`${craftPrefix}${prefix}${ksPrefix}${effectName} ${itemName}`.trim());
                }
              }
            } else {
              // For non-unusuals, do NOT prepend effect name
              for (const ksTier of killstreakTiers) {
                const ksName = killstreakTierNames[ksTier];
                const ksPrefix = ksName ? ksName + ' ' : '';
                const prefix = qualityId !== '6' && qualityId !== '5' ? qualityName + ' ' : '';
                // Compose: "Non-Craftable Strange Professional Killstreak Item"
                names.add(`${craftPrefix}${prefix}${ksPrefix}${itemName}`.trim());
              }
            }
          } else if (Array.isArray(arrOrObj)) {
            // Generate all killstreak variants found in database
            for (const ksTier of killstreakTiers) {
              const ksName = killstreakTierNames[ksTier];
              const ksPrefix = ksName ? ksName + ' ' : '';
              // Only add quality if not Unique (6) and not Unusual (5)
              const prefix = qualityId !== '6' && qualityId !== '5' ? qualityName + ' ' : '';
              // Compose: "Non-Craftable Strange Professional Killstreak Item"
              names.add(`${craftPrefix}${prefix}${ksPrefix}${itemName}`.trim());
            }
          }
        }
      }
    }
  }
  return [...names];
}

module.exports = { getBptfPrices, getBptfItemPrice, getAllPricedItemNamesWithEffects };
