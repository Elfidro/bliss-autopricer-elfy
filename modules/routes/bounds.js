const path = require('path');
const express = require('express');
const { loadJson, saveJson } = require('../utils');
const renderPage = require('../layout');
const { getBaseConfigManager } = require('../baseConfigManager');

module.exports = function (app) {
  const router = express.Router();
  const itemListPath = path.resolve(__dirname, '../../files/item_list.json');
  const priceListPath = path.resolve(__dirname, '../../files/pricelist.json');
  
  const config = getBaseConfigManager().getConfig();
  const externalLinks = config.externalLinks || { autobotTfBaseUrl: 'http://autobot.tf' };

  function buildBoundsTable(items) {
    if (items.length === 0) {
      return `
        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
          <h3>📦 No Items Found</h3>
          <p>No items are currently configured for price bounds management.</p>
          <p>Items need to be added to your item list first before you can set price bounds.</p>
        </div>
      `;
    }

    let tbl = `
      <div style="background: white; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; margin: 20px 0;">
        <div style="background: #f8f9fa; padding: 15px; border-bottom: 1px solid #ddd;">
          <h3 style="margin: 0;">⚙️ Price Bounds Configuration</h3>
          <p style="margin: 5px 0 0 0; color: #666;">Set minimum and maximum price limits for buying and selling items</p>
        </div>
        <form method="POST" action="/bounds" style="padding: 20px;">
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <thead>
                <tr style="background: #f8f9fa;">
                  <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd; min-width: 200px;">Item Name</th>
                  <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd; color: #28a745;" colspan="4">🟢 Buy Limits</th>
                  <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd; color: #dc3545;" colspan="4">🔴 Sell Limits</th>
                </tr>
                <tr style="background: #f8f9fa; font-size: 0.9em;">
                  <th style="padding: 8px; border-bottom: 1px solid #ddd;"></th>
                  <th style="padding: 8px; text-align: center; border-bottom: 1px solid #ddd;">Min Keys</th>
                  <th style="padding: 8px; text-align: center; border-bottom: 1px solid #ddd;">Min Metal</th>
                  <th style="padding: 8px; text-align: center; border-bottom: 1px solid #ddd;">Max Keys</th>
                  <th style="padding: 8px; text-align: center; border-bottom: 1px solid #ddd;">Max Metal</th>
                  <th style="padding: 8px; text-align: center; border-bottom: 1px solid #ddd;">Min Keys</th>
                  <th style="padding: 8px; text-align: center; border-bottom: 1px solid #ddd;">Min Metal</th>
                  <th style="padding: 8px; text-align: center; border-bottom: 1px solid #ddd;">Max Keys</th>
                  <th style="padding: 8px; text-align: center; border-bottom: 1px solid #ddd;">Max Metal</th>
                </tr>
              </thead>
              <tbody>`;

    items.forEach((item, idx) => {
      const rowStyle = idx % 2 === 0 ? 'background: #f9f9f9;' : '';
      
      // Build the item name cell with optional autobot.tf link if SKU is available
      let itemNameHtml = item.name;
      if (item.sku) {
        itemNameHtml = `<a href="${externalLinks.autobotTfBaseUrl}/items/${item.sku}" style="color:#495057; text-decoration: none;" target="_blank" title="View ${item.name} on autobot.tf">${item.name} 🔗</a>`;
      }
      
      tbl += `
        <tr style="${rowStyle}">
          <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: bold;">${itemNameHtml}</td>
          <td style="padding: 8px; text-align: center; border-bottom: 1px solid #eee;">
            <input type="number" step="1" name="minBuyKeys_${idx}" value="${item.minBuyKeys ?? ''}" 
                   style="width: 60px; padding: 4px; border: 1px solid #ddd; border-radius: 3px; text-align: center;" 
                   placeholder="0">
          </td>
          <td style="padding: 8px; text-align: center; border-bottom: 1px solid #eee;">
            <input type="number" step="0.01" name="minBuyMetal_${idx}" value="${item.minBuyMetal ?? ''}" 
                   style="width: 70px; padding: 4px; border: 1px solid #ddd; border-radius: 3px; text-align: center;" 
                   placeholder="0.00">
          </td>
          <td style="padding: 8px; text-align: center; border-bottom: 1px solid #eee;">
            <input type="number" step="1" name="maxBuyKeys_${idx}" value="${item.maxBuyKeys ?? ''}" 
                   style="width: 60px; padding: 4px; border: 1px solid #ddd; border-radius: 3px; text-align: center;" 
                   placeholder="∞">
          </td>
          <td style="padding: 8px; text-align: center; border-bottom: 1px solid #eee;">
            <input type="number" step="0.01" name="maxBuyMetal_${idx}" value="${item.maxBuyMetal ?? ''}" 
                   style="width: 70px; padding: 4px; border: 1px solid #ddd; border-radius: 3px; text-align: center;" 
                   placeholder="∞">
          </td>
          <td style="padding: 8px; text-align: center; border-bottom: 1px solid #eee;">
            <input type="number" step="1" name="minSellKeys_${idx}" value="${item.minSellKeys ?? ''}" 
                   style="width: 60px; padding: 4px; border: 1px solid #ddd; border-radius: 3px; text-align: center;" 
                   placeholder="0">
          </td>
          <td style="padding: 8px; text-align: center; border-bottom: 1px solid #eee;">
            <input type="number" step="0.01" name="minSellMetal_${idx}" value="${item.minSellMetal ?? ''}" 
                   style="width: 70px; padding: 4px; border: 1px solid #ddd; border-radius: 3px; text-align: center;" 
                   placeholder="0.00">
          </td>
          <td style="padding: 8px; text-align: center; border-bottom: 1px solid #eee;">
            <input type="number" step="1" name="maxSellKeys_${idx}" value="${item.maxSellKeys ?? ''}" 
                   style="width: 60px; padding: 4px; border: 1px solid #ddd; border-radius: 3px; text-align: center;" 
                   placeholder="∞">
          </td>
          <td style="padding: 8px; text-align: center; border-bottom: 1px solid #eee;">
            <input type="number" step="0.01" name="maxSellMetal_${idx}" value="${item.maxSellMetal ?? ''}" 
                   style="width: 70px; padding: 4px; border: 1px solid #ddd; border-radius: 3px; text-align: center;" 
                   placeholder="∞">
          </td>
          <input type="hidden" name="name_${idx}" value="${item.name}">
        </tr>`;
    });

    tbl += `
              </tbody>
            </table>
          </div>
          <input type="hidden" name="count" value="${items.length}">
          <div style="text-align: center; padding-top: 15px; border-top: 1px solid #ddd;">
            <button type="submit" style="background: #28a745; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; font-weight: bold;">
              💾 Save All Price Bounds
            </button>
          </div>
        </form>
      </div>`;

    return tbl;
  }

  router.get('/bounds', (req, res) => {
    const itemList = loadJson(itemListPath).items || [];
    const priceList = loadJson(priceListPath).items || [];
    
    // Create a map of item names to SKUs for efficient lookup
    const nameToSkuMap = new Map();
    priceList.forEach(priceItem => {
      nameToSkuMap.set(priceItem.name, priceItem.sku);
    });
    
    // Enrich item list with SKU data
    const enrichedItemList = itemList.map(item => ({
      ...item,
      sku: nameToSkuMap.get(item.name) || null
    }));

    let html = '<div style="max-width: 1200px; margin: 0 auto; padding: 20px;">';

    // Header
    html +=
      '<div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px;">';
    html += '<h2>⚙️ Item Price Bounds Management</h2>';
    html +=
      '<p>Configure minimum and maximum price limits for buying and selling items. Leave fields blank to remove limits.</p>';
    html += '</div>';

    // Statistics Card
    html +=
      '<div style="background: #e8f4fd; padding: 15px; border-radius: 8px; margin-bottom: 20px;">';
    html += '<h3>📊 Configuration Summary</h3>';
    html += `<p><strong>Total Items:</strong> ${enrichedItemList.length}</p>`;
    html += `<p><strong>Items with Price Data:</strong> ${enrichedItemList.filter(i => i.sku).length}</p>`;

    const boundsConfigured = enrichedItemList.filter(
      (item) =>
        item.minBuyKeys !== undefined ||
        item.minBuyMetal !== undefined ||
        item.maxBuyKeys !== undefined ||
        item.maxBuyMetal !== undefined ||
        item.minSellKeys !== undefined ||
        item.minSellMetal !== undefined ||
        item.maxSellKeys !== undefined ||
        item.maxSellMetal !== undefined
    ).length;

    html += `<p><strong>Items with Bounds:</strong> ${boundsConfigured}</p>`;
    html += `<p><strong>Items without Bounds:</strong> ${enrichedItemList.length - boundsConfigured}</p>`;
    html += '</div>';

    // Instructions Card
    html +=
      '<div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 8px; margin-bottom: 20px;">';
    html += '<h4>💡 How to Configure Price Bounds</h4>';
    html += '<ul style="margin: 10px 0;">';
    html +=
      "<li><strong>Min Limits:</strong> Set the minimum price you're willing to buy/sell for</li>";
    html +=
      "<li><strong>Max Limits:</strong> Set the maximum price you're willing to buy/sell for</li>";
    html +=
      '<li><strong>Keys vs Metal:</strong> Use keys for high-value items, metal for low-value items</li>';
    html +=
      '<li><strong>Leave Blank:</strong> No limit will be applied for that price boundary</li>';
    html +=
      '<li><strong>🔗 Icon:</strong> Click the link icon next to item names to view current market prices on autobot.tf</li>';
    html += '</ul>';
    html += '</div>';

    html += buildBoundsTable(enrichedItemList);
    html += '</div>';

    res.send(renderPage('Price Bounds Configuration', html));
  });

  router.post('/bounds', (req, res) => {
    try {
      const itemList = loadJson(itemListPath);
      const count = parseInt(req.body.count) || 0;
      let updatedCount = 0;

      for (let i = 0; i < count; i++) {
        const name = req.body[`name_${i}`];
        const fields = [
          'minBuyKeys',
          'minBuyMetal',
          'maxBuyKeys',
          'maxBuyMetal',
          'minSellKeys',
          'minSellMetal',
          'maxSellKeys',
          'maxSellMetal',
        ];
        const item = itemList.items.find((it) => it.name === name);
        if (item) {
          let hasChanges = false;
          for (const field of fields) {
            const val = req.body[`${field}_${i}`];
            const newValue = val !== '' && val !== undefined ? parseFloat(val) : undefined;
            if (item[field] !== newValue) {
              hasChanges = true;
              item[field] = newValue;
            }
          }
          if (hasChanges) {
            updatedCount++;
          }
        }
      }

      saveJson(itemListPath, itemList);

      let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
      html +=
        '<div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 8px; text-align: center;">';
      html += '<h2>✅ Price Bounds Updated Successfully</h2>';
      html += `<p><strong>${updatedCount}</strong> items had their price bounds updated.</p>`;
      html += `<p>Total items processed: <strong>${count}</strong></p>`;
      html +=
        '<p><a href="/bounds" style="background: #007cba; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">← Back to Price Bounds</a></p>';
      html += '</div>';
      html += '</div>';

      res.send(renderPage('Bounds Updated', html));
    } catch (error) {
      console.error('Error updating bounds:', error);
      let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
      html +=
        '<div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 8px; text-align: center;">';
      html += '<h2>❌ Error Updating Price Bounds</h2>';
      html += `<p>There was an error updating the price bounds: ${error.message}</p>`;
      html +=
        '<p><a href="/bounds" style="background: #007cba; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">← Back to Price Bounds</a></p>';
      html += '</div>';
      html += '</div>';

      res.status(500).send(renderPage('Error', html));
    }
  });

  app.use('/', router);
};
