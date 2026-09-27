const Methods = require('../methods');
const { getSCMPrice, getSCMKeyPrice } = require('./steamMarketFetcher');
const EFFECTS = require('./unusualEffects');
const methods = new Methods();

function getEffectName(effectId) {
  return EFFECTS[effectId] || `Effect ${effectId}`;
}

/**
 * Converts a SKU or item name to a Steam Market hash name.
 * This is a placeholder; you may want to improve this for unusuals, skins, etc.
 * @param {string} name - The item name.
 * @param nameOrSku
 * @param schema
 * @returns {string} - The market hash name.
 */
function toMarketHashName(nameOrSku, schema) {
  if (nameOrSku.includes(';')) {
    const skuObj = parseSku(nameOrSku);
    return skuToMarketHashName(skuObj, schema);
  }
  return nameOrSku;
}

/**
 * Gets a price object for an item using SCM prices.
 * @param {object} opts
 * @param {string} opts.name - The item name (market hash name).
 * @param {string} [opts.sku] - The SKU (optional, for future use).
 * @param {number} opts.keyMetal - The current key price in metal.
 * @param {string} [opts.currency] - The currency code (default: 'USD').
 * @param {number} [opts.scmMarginBuy] - Optional buy margin (default: 0).
 * @param {number} [opts.scmMarginSell] - Optional sell margin (default: 0).
 * @returns {Promise<{buy: {keys: number, metal: number}, sell: {keys: number, metal: number}}|null>}
 */
async function getSCMPriceObject({
  name,
  keyMetal,
  currency = 'USD',
  scmMarginBuy = 0,
  scmMarginSell = 0,
}) {
  const marketHashName = toMarketHashName(name);
  const [itemSCM, keySCM] = await Promise.all([
    getSCMPrice(marketHashName, currency),
    getSCMKeyPrice(currency),
  ]);
  if (!itemSCM || !keySCM || keySCM === 0) {
    return null;
  }
  let priceInKeys = itemSCM / keySCM;
  let priceInMetal = priceInKeys * keyMetal;
  // Apply margin
  let buyMetal = priceInMetal * (1 - scmMarginBuy);
  let sellMetal = priceInMetal * (1 + scmMarginSell);
  // Always round to the nearest weapon (half scrap) using getRight
  buyMetal = methods.getRight(buyMetal);
  sellMetal = methods.getRight(sellMetal);
  return {
    buy: { keys: 0, metal: buyMetal },
    sell: { keys: 0, metal: sellMetal },
  };
}

/**
 * Parses a SKU string into its components.
 * @param {string} sku
 * @returns {object}
 */
function parseSku(sku) {
  // Example SKU: 5021;6;kt-3;u-3001;australium;festive
  const parts = sku.split(';');
  const out = { defindex: parts[0], quality: parts[1] };
  for (let i = 2; i < parts.length; i++) {
    if (parts[i].startsWith('kt-')) {
      out.killstreak = parseInt(parts[i].slice(3));
    } else if (parts[i].startsWith('u-')) {
      out.effect = parseInt(parts[i].slice(2));
    } else if (parts[i] === 'australium') {
      out.australium = true;
    } else if (parts[i] === 'festive') {
      out.festivized = true;
    }
    // Add more as needed (paint, wear, etc)
  }
  return out;
}

/**
 * Converts a parsed SKU to a Steam Market hash name.
 * @param {object} skuObj - Output of parseSku
 * @param {object} [schema] - Optional TF2 schema for defindex->name
 * @returns {string}
 */
function skuToMarketHashName(skuObj, schema) {
  // This is a simplified version. For full accuracy, use the schema for defindex->name.
  let name = `Item ${skuObj.defindex}`;
  if (schema && schema.getItemBySKU) {
    // Reconstruct a minimal SKU for lookup
    const minimalSku = `${skuObj.defindex};${skuObj.quality}`;
    const item = schema.getItemBySKU(minimalSku);
    if (item && item.item_name) {
      name = item.item_name;
    }
  }
  // Quality
  if (skuObj.quality === '1') {
    name = `Genuine ${name}`;
  } else if (skuObj.quality === '3') {
    name = `Vintage ${name}`;
  } else if (skuObj.quality === '5') {
    name = `Unusual ${name}`;
  } else if (skuObj.quality === '11') {
    name = `Strange ${name}`;
  } else if (skuObj.quality === '13') {
    name = `Haunted ${name}`;
  } else if (skuObj.quality === '14') {
    name = `Collector's ${name}`;
  }
  // Note: Quality 6 (Unique) and 0 (Normal) don't get prefixes
  // Killstreak
  if (skuObj.killstreak === 1) {
    name = `Killstreak ${name}`;
  } else if (skuObj.killstreak === 2) {
    name = `Specialized Killstreak ${name}`;
  } else if (skuObj.killstreak === 3) {
    name = `Professional Killstreak ${name}`;
  }
  // Australium
  if (skuObj.australium) {
    name = `Australium ${name}`;
  }
  // Festivized
  if (skuObj.festivized) {
    name = `Festivized ${name}`;
  }
  // Unusual effect (SCM: "Unusual Effect Name Item Name")
  if (skuObj.effect) {
    name = `${getEffectName(skuObj.effect)} ${name}`;
  }
  // TODO: handle skins, wear, paint, etc.
  return name;
}

module.exports = {
  getSCMPriceObject,
  toMarketHashName,
  parseSku,
  skuToMarketHashName,
  getEffectName,
};
