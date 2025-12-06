const { getBaseConfigManager } = require('./baseConfigManager');

/**
 * Fetches the Mann Co. Supply Crate Key price from pricedb.io
 * @returns {Promise<Object>} Key price object with buy/sell prices
 */
async function fetchKeyPriceFromPriceDB() {
  const config = getBaseConfigManager().getConfig();
  const apiSettings = config.apiSettings || {
    priceDbBaseUrl: 'https://pricedb.io/api',
    keyPriceTimeout: 10000,
  };

  try {
    const response = await fetch(`${apiSettings.priceDbBaseUrl}/item/5021;6`, {
      signal: AbortSignal.timeout(apiSettings.keyPriceTimeout),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Validate the response has the expected structure
    if (!data.buy || !data.sell || typeof data.buy.metal !== 'number' || typeof data.sell.metal !== 'number') {
      throw new Error('Invalid response structure from pricedb.io');
    }

    const keyItem = {
      name: 'Mann Co. Supply Crate Key',
      sku: '5021;6',
      source: 'BPTF',
      time: data.time || Math.floor(Date.now() / 1000),
      buy: {
        keys: 0,
        metal: data.buy.metal,
      },
      sell: {
        keys: 0,
        metal: data.sell.metal,
      },
    };

    console.log(`Key price fetched from pricedb.io - Buy: ${data.buy.metal}, Sell: ${data.sell.metal}`);
    return keyItem;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error fetching key price from pricedb.io:', errorMessage);
    throw error;
  }
}

module.exports = {
  fetchKeyPriceFromPriceDB,
};
