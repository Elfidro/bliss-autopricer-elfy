// eslint-disable-next-line spellcheck/spell-checker
/* eslint-disable no-prototype-builtins */
var Methods = function () {};
var fs = require('fs');

const AsyncLock = require('async-lock');
const lock = new AsyncLock();

const { getBaseConfigManager } = require('./modules/baseConfigManager');

const { getBptfItemPrice } = require('./modules/bptfPriceFetcher');

// Helper function to get config
function getConfig() {
  return getBaseConfigManager().getConfig();
}

// Returns true if baseline is OK, false if too different
Methods.prototype.calculateBptfBaselineDifference = function (
  bptfItems,
  final_buyObj,
  final_sellObj,
  keyobj,
  sku
) {
  // Allow all prices for unusuals (quality 5) and rare qualities (e.g. 11, 13, 14, 15, 16, 17, 18)
  const quality = sku.split(';')[1];
  const rareQualities = ['5', '14'];
  if (rareQualities.includes(quality)) {
    return true;
  }

  const bptfPrice = getBptfItemPrice(bptfItems, sku);
  if (!bptfPrice) {
    return true;
  } // No baseline, allow

  // Backpack.tf prices can be in keys or metal
  let bptfBuy = bptfPrice.value;
  let bptfSell = bptfPrice.value_high || bptfPrice.value;
  if (bptfPrice.currency === 'keys') {
    bptfBuy = bptfBuy * keyobj.metal;
    bptfSell = bptfSell * keyobj.metal;
  }

  const ourBuy = this.toMetal(final_buyObj, keyobj.metal);
  const ourSell = this.toMetal(final_sellObj, keyobj.metal);

  // Calculate % difference
  const buyDiff = Math.abs((ourBuy - bptfBuy) / bptfBuy);
  const sellDiff = Math.abs((ourSell - bptfSell) / bptfSell);

  const config = getConfig();
  if (buyDiff > (config.maxPercentageDifferences?.buy ?? 0.1)) {
    return false;
  }
  if (sellDiff > (config.maxPercentageDifferences?.sell ?? 0.1)) {
    return false;
  }
  return true;
};

// Rounds the metal value to the nearest scrap.
Methods.prototype.getRight = function (v) {
  var i = Math.floor(v),
    f = Math.round((v - i) / 0.11);
  return parseFloat((i + (f === 9 ? 1 : f * 0.11)).toFixed(2));
};

// This method first takes the amount of keys the item costs and multiplies it by
// the current key metal sell price. This gives us the amount of metal the key cost
// is worth in terms of a keys current sell price. Then it adds this result onto
// the metal cost. It's then rounded down to the nearest 0.11.

// From here, the metal (being both the worth of the keys and the metal value), is
// divided into the sell price of a key. Totalling the amount of keys that could be
// afforded with the pure metal value. The metal component is calculated by taking the
// remainder of the rounded total value divided by keyPrice. This gives the amount of
// metal that couldn't be converted into a whole key.

// This method ensures we make prices that take into account the current price of the key.
Methods.prototype.parsePrice = function (original, keyPrice) {
  // Defensive: ensure keys is always an integer
  if (!Number.isInteger(original.keys)) {
    console.error('parsePrice called with non-integer keys:', original);
    original.keys = Math.trunc(original.keys);
  }
  var metal = this.getRight(original.keys * keyPrice) + original.metal;
  return {
    keys: Math.trunc(metal / keyPrice),
    metal: this.getRight(metal % keyPrice),
  };
};

Methods.prototype.toMetal = function (obj, keyPriceInMetal) {
  var metal = 0;
  metal += obj.keys * keyPriceInMetal;
  metal += obj.metal;
  return this.getRight(metal);
};

Methods.prototype.calculatePercentageDifference = function (value1, value2) {
  if (value1 === 0) {
    return value2 === 0 ? 0 : 100; // Handle division by zero
  }
  return ((value2 - value1) / Math.abs(value1)) * 100;
};

Methods.prototype.getItemPriceFromExternalPricelist = function (
  sku,
  external_pricelist,
  keyPrice,
  schemaManager
) {
  const priceObj = getBptfItemPrice(external_pricelist, sku);

  const item = schemaManager.schema.getItemBySKU(sku);
  const name = item ? item.item_name : sku;

  if (!priceObj || typeof priceObj.value !== 'number') {
    return {
      pricetfItem: {
        name,
        sku,
        source: 'bptf',
        buy: { keys: null, metal: null },
        sell: { keys: null, metal: null },
        time: Math.floor(Date.now() / 1000),
      },
    };
  }

  // Special case for Mann Co. Supply Crate Key
  if (sku === '5021;6') {
    return {
      pricetfItem: {
        name,
        sku,
        source: 'bptf',
        buy: { keys: 0, metal: priceObj.value },
        sell: { keys: 0, metal: priceObj.value },
        time: Math.floor(Date.now() / 1000),
      },
    };
  }
  // Ensure price object has the expected structure
  if (!priceObj) {
    throw new Error('Item not found in backpack.tf pricelist.');
  }

  // Determine value in metal
  let value = priceObj.value;
  if (priceObj.currency === 'keys') {
    value = value * keyPrice;
  }

  // Calculate buy/sell with ±10% offset
  const buyValue = value * 0.9;
  const sellValue = value * 1.1;

  // Convert back to keys/metal
  const buy = {
    keys: Math.floor(buyValue / keyPrice),
    metal: +(buyValue % keyPrice).toFixed(2),
  };
  const sell = {
    keys: Math.floor(sellValue / keyPrice),
    metal: +(sellValue % keyPrice).toFixed(2),
  };

  return {
    pricetfItem: {
      name,
      sku,
      buy,
      sell,
      source: 'bptf',
      time: priceObj.last_update || Math.floor(Date.now() / 1000),
    },
  };
};

// Calculate percentage differences and decide on rejecting or accepting the autopricers price
// based on limits defined in config.json.
Methods.prototype.calculatePricingAPIDifferences = function (
  pricetfItem,
  final_buyObj,
  final_sellObj,
  keyobj
) {
  // Unusual/rare quality clause
  const rareQualities = ['5', '14'];
  if (pricetfItem.sku) {
    const quality = pricetfItem.sku.split(';')[1];
    if (rareQualities.includes(quality) || pricetfItem.sku.includes(';australium')) {
      // Only allow if buy is not more than sell
      const buyInMetal = this.toMetal(final_buyObj, keyobj.metal);
      const sellInMetal = this.toMetal(final_sellObj, keyobj.metal);
      return buyInMetal <= sellInMetal;
    }
  }

  //If pricetfitem contains ;kt-, it is killstreak, so we allow it.
  if (pricetfItem.sku && pricetfItem.sku.includes(';kt-')) {
    // Only allow if buy is not more than sell
    const buyInMetal = this.toMetal(final_buyObj, keyobj.metal);
    const sellInMetal = this.toMetal(final_sellObj, keyobj.metal);
    if (buyInMetal >= sellInMetal) {
      //log buyinmetal and sellinmetal along with the sku and name of the item.
      console.log(`Blocking killstreak item: ${pricetfItem.sku} (${pricetfItem.name})`);
      console.log(
        `Buy in metal: ${buyInMetal}, Sell in metal: ${sellInMetal} buy is higher than sell!`
      );
    }
    return buyInMetal <= sellInMetal;
  }

  var percentageDifferences = {};

  var sell_Price_In_Metal = this.toMetal(final_sellObj, keyobj.metal);
  var buy_Price_In_Metal = this.toMetal(final_buyObj, keyobj.metal);

  var priceTFSell = {};
  priceTFSell.keys = pricetfItem.sell.keys;
  priceTFSell.metal = pricetfItem.sell.metal;

  var priceTFBuy = {};
  priceTFBuy.keys = pricetfItem.buy.keys;
  priceTFBuy.metal = pricetfItem.buy.metal;

  var priceTF_Sell_Price_In_Metal = this.toMetal(priceTFSell, keyobj.metal);
  var priceTF_Buy_Price_In_Metal = this.toMetal(priceTFBuy, keyobj.metal);

  var results = {};
  results.priceTFSellPrice = priceTF_Sell_Price_In_Metal;
  results.autopricerSellPrice = sell_Price_In_Metal;
  results.priceTFBuyPrice = priceTF_Buy_Price_In_Metal;
  results.autopricerBuyPrice = buy_Price_In_Metal;

  percentageDifferences.buyDifference = this.calculatePercentageDifference(
    results.priceTFBuyPrice,
    results.autopricerBuyPrice
  );
  percentageDifferences.sellDifference = this.calculatePercentageDifference(
    results.priceTFSellPrice,
    results.autopricerSellPrice
  );

  // Ensures that data we're going to use in comparison are numbers. If not we throw an error.
  if (isNaN(percentageDifferences.buyDifference) || isNaN(percentageDifferences.sellDifference)) {
    // Can't compare percentages because the external API likely returned malformed data.
    throw new Error('External API returned NaN. Critical error.');
  }
  // Calls another method that uses this percentage difference object to make decision on whether to use our autopricers price or not.
  try {
    var usePrice = this.validatePrice(percentageDifferences);
    // We should use this price, resolves as true.
    return usePrice;
  } catch (e) {
    // We should not use this price.
    throw new Error(e);
  }
};

Methods.prototype.validatePrice = function (percentageDifferences) {
  // If the percentage difference in how much our pricer has determined we should buy an item
  // for compared to prices.tf is greater than the limit set in the config, we reject the price.

  // And if the percentage difference in how much our pricer has determined we should sell an item
  // for compared to prices.tf is less than the limit set in the config, we reject the price.

  // A greater percentage difference for buying, means that our pricer is buying for more than prices.tf.
  // A lesser percentage difference for selling, means that our pricer is selling for less than prices.tf.
  const config = getConfig();
  if (percentageDifferences.buyDifference > config.maxPercentageDifferences.buy) {
    throw new Error('Autopricer is buying for too much.');
  } else if (percentageDifferences.sellDifference < config.maxPercentageDifferences.sell) {
    throw new Error('Autopricer is selling for too cheap.');
  }
  return true;
};

Methods.prototype.waitXSeconds = async function (seconds) {
  return new Promise((resolve) => {
    // Convert to milliseconds and then set timeout.
    setTimeout(resolve, seconds * 1000);
  });
};

Methods.prototype.validateObject = function (obj) {
  // Check if the object is undefined, empty etc.
  if (!obj) {
    return false;
  }
  if (Object.keys(obj).length > 0) {
    if (obj.hasOwnProperty('keys') || obj.hasOwnProperty('metal')) {
      // The object is valid as it contains at least one expected key.
      return true;
    } else {
      // The object is invalid as it doesn't contain any expected keys.
      return false;
    }
  } else {
    // The object is empty.
    return false;
  }
};

Methods.prototype.createCurrencyObject = function (obj) {
  let newObj = {
    keys: 0,
    metal: 0,
  };

  if (obj.hasOwnProperty('keys')) {
    newObj.keys = obj.keys;
  }

  if (obj.hasOwnProperty('metal')) {
    newObj.metal = obj.metal;
  }

  return newObj;
};

//const comparePrices = (item1, item2) => {
//  return item1.keys === item2.keys && item1.metal === item2.metal;
//};

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy-wait loop to simulate sleep
  }
}

function safeRenameSync(src, dest, retries = 5, delay = 100) {
  for (let i = 0; i < retries; i++) {
    try {
      fs.renameSync(src, dest);
      return;
    } catch (err) {
      if (err.code === 'EPERM' && i < retries - 1) {
        sleepSync(delay); // Use busy-wait sleep instead of Atomics
      } else {
        throw err;
      }
    }
  }
}

Methods.prototype.addToPricelist = function (item, PRICELIST_PATH) {
  try {
    lock.acquire('pricelist', () => {
      const data = fs.readFileSync(PRICELIST_PATH, 'utf8');
      let existingData = JSON.parse(data);
      let items = Array.isArray(existingData.items) ? existingData.items : [];

      // Filter out empty or malformed items
      items = items.filter((i) => i && i.name && i.sku && i.buy && i.sell);

      // Validate new item
      if (!item || !item.name || !item.sku || !item.buy || !item.sell) {
        console.error('Attempted to add malformed item to pricelist:', item);
        return;
      }

      const existingIndex = items.findIndex((pricelist_item) => pricelist_item.sku === item.sku);

      if (existingIndex !== -1) {
        items[existingIndex] = item;
      } else {
        items.push(item);
      }

      existingData.items = items;

      // Atomic write
      const tempPath = PRICELIST_PATH + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(existingData, null, 2), 'utf8');
      safeRenameSync(tempPath, PRICELIST_PATH);
    });
  } catch (error) {
    console.error('Error:', error);
  }
};

// Request related methods.
Methods.prototype.getKeyFromExternalAPI = async function (
  external_pricelist,
  keyPrice,
  schemaManager
) {
  // Always use the backpack.tf cached pricelist for the key price
  const { pricetfItem } = this.getItemPriceFromExternalPricelist(
    '5021;6',
    external_pricelist,
    keyPrice,
    schemaManager
  );
  return {
    name: 'Mann Co. Supply Crate Key',
    sku: '5021;6',
    source: 'bptf',
    buy: {
      keys: pricetfItem.buy.keys,
      metal: pricetfItem.buy.metal,
    },
    sell: {
      keys: pricetfItem.sell.keys,
      metal: pricetfItem.sell.metal,
    },
    time: Math.floor(Date.now() / 1000),
  };
};

/**
 * Get key price from pricelist with PriceDB.io fallback
 * Always falls back to PriceDB.io if pricelist fails
 * @param {string} pricelistPath - Path to pricelist.json
 * @returns {Promise<number>} Key price in refined metal
 */
Methods.prototype.getKeyPrice = async function (pricelistPath) {
  const defaultKeyPrice = 52.22;

  // Try to load from pricelist first
  if (pricelistPath && fs.existsSync(pricelistPath)) {
    try {
      const pricelistData = JSON.parse(fs.readFileSync(pricelistPath, 'utf8'));
      const keyItem = pricelistData?.items?.find((i) => i.sku === '5021;6');
      const keyPrice = keyItem?.sell?.metal;

      if (keyPrice && keyPrice > 0 && keyPrice < 1000) {
        return keyPrice;
      }
    } catch (error) {
      console.log('Could not load key price from pricelist:', error.message);
    }
  }

  // Fall back to PriceDB.io
  try {
    console.log('Fetching key price from PriceDB.io...');
    const response = await fetch('https://pricedb.io/api/item/5021;6', {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json();
      const keyPrice = data?.sell?.metal;

      if (keyPrice && keyPrice > 0 && keyPrice < 1000) {
        console.log(`Key price from PriceDB.io: ${keyPrice} ref`);
        return keyPrice;
      }
    }
  } catch (error) {
    console.warn('Failed to fetch key price from PriceDB.io:', error.message);
  }

  // Final fallback to default
  console.log(`Using default key price: ${defaultKeyPrice} ref`);
  return defaultKeyPrice;
};

module.exports = Methods;
