// Use built-in fetch (Node.js 18+) or fall back to node-fetch for older versions
const fetch = globalThis.fetch || require('node-fetch');
const { getBaseConfigManager } = require('./baseConfigManager');

/**
 * Fetches price data from pricedb.io for a given SKU
 * @param {string} sku - The item SKU (e.g., "5021;6")
 * @returns {Promise<{name: string, sku: string, source: string, time: number, buy: {keys: number, metal: number}, sell: {keys: number, metal: number}}|null>}
 */
async function getPriceDbPrice(sku) {
  const config = getBaseConfigManager().getConfig();
  const apiSettings = config.apiSettings || {
    priceDbBaseUrl: 'https://pricedb.io/api',
    priceDbTimeout: 5000,
  };

  const url = `${apiSettings.priceDbBaseUrl}/item/${encodeURIComponent(sku)}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), apiSettings.priceDbTimeout);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'BPTF-Autopricer/1.0',
      },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return null;
    }

    const data = await res.json();

    // Validate response structure
    if (!data?.sku || !data?.buy || !data?.sell) {
      return null;
    }

    // Convert the response to our internal format
    return {
      name: data.name,
      sku: data.sku,
      source: 'pricedb',
      time: data.time || Math.floor(Date.now() / 1000),
      buy: {
        keys: data.buy.keys || 0,
        metal: data.buy.metal || 0,
      },
      sell: {
        keys: data.sell.keys || 0,
        metal: data.sell.metal || 0,
      },
    };
  } catch (err) {
    console.warn(
      `PriceDB.io fetch failed for ${sku}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

/**
 * Fetches multiple items from pricedb.io (if batch endpoint exists)
 * Currently just iterates single requests, but can be optimized if API supports batch
 * @param {string[]} skus - Array of SKUs
 * @returns {Promise<Map<string, object>>} - Map of SKU to price data
 */
async function getPriceDbPrices(skus) {
  const config = getBaseConfigManager().getConfig();
  const concurrentLimit = config.apiSettings?.concurrentRequestLimit || 3;

  const results = new Map();
  const limit = require('p-limit').default;
  const limiter = limit(concurrentLimit);

  await Promise.all(
    skus.map((sku) =>
      limiter(async () => {
        const price = await getPriceDbPrice(sku);
        if (price) {
          results.set(sku, price);
        }
      })
    )
  );

  return results;
}

module.exports = { getPriceDbPrice, getPriceDbPrices };
