const path = require('path');
const express = require('express');
const { loadJson, saveJson } = require('../utils');
const renderPage = require('../layout');
const { getBaseConfigManager } = require('../baseConfigManager');

/**
 * Parse float from string, handling both comma and period as decimal separator
 * This fixes issues with European locales where browsers submit "1,5" instead of "1.5"
 * @param {string} value - The value to parse
 * @returns {number} - Parsed float or NaN if invalid
 */
function parseFloatLocale(value) {
  if (typeof value === 'number') return value;
  if (!value || typeof value !== 'string') return NaN;
  
  // Replace comma with period for European locale support
  const normalized = value.trim().replace(',', '.');
  return parseFloat(normalized);
}

/**
 * Convert keys + metal to total metal value
 * @param {number} keys - Number of keys
 * @param {number} metal - Amount of refined metal
 * @param {number} keyPrice - Current key price in refined
 * @returns {number} - Total value in refined metal
 */
function toTotalMetal(keys, metal, keyPrice) {
  return (keys || 0) * keyPrice + (metal || 0);
}

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
            <table class="bounds-table">
              <thead>
                <tr>
                  <th class="bnd-name">Item Name</th>
                  <th class="bnd buy" colspan="2">🟢 Buy Min</th>
                  <th class="bnd buy grp-end" colspan="2">🟢 Buy Max</th>
                  <th class="bnd sell" colspan="2">🔴 Sell Min</th>
                  <th class="bnd sell" colspan="2">🔴 Sell Max</th>
                </tr>
                <tr class="bnd-subhead">
                  <th class="bnd-name"></th>
                  <th class="bnd buy">Keys</th>
                  <th class="bnd buy">Metal</th>
                  <th class="bnd buy">Keys</th>
                  <th class="bnd buy grp-end">Metal</th>
                  <th class="bnd sell">Keys</th>
                  <th class="bnd sell">Metal</th>
                  <th class="bnd sell">Keys</th>
                  <th class="bnd sell">Metal</th>
                </tr>
              </thead>
              <tbody>`;

    // Buy and sell columns are tinted rather than zebra-striped, so the side
    // you are editing stays obvious once the header has scrolled away.
    const BOUND_COLS = [
      { side: 'buy', field: 'minBuyKeys', step: '1', mode: 'numeric', ph: '0', w: 60 },
      { side: 'buy', field: 'minBuyMetal', step: '0.01', mode: 'decimal', ph: '0.00', w: 70 },
      { side: 'buy', field: 'maxBuyKeys', step: '1', mode: 'numeric', ph: '∞', w: 60 },
      { side: 'buy', field: 'maxBuyMetal', step: '0.01', mode: 'decimal', ph: '∞', w: 70, last: true },
      { side: 'sell', field: 'minSellKeys', step: '1', mode: 'numeric', ph: '0', w: 60 },
      { side: 'sell', field: 'minSellMetal', step: '0.01', mode: 'decimal', ph: '0.00', w: 70 },
      { side: 'sell', field: 'maxSellKeys', step: '1', mode: 'numeric', ph: '∞', w: 60 },
      { side: 'sell', field: 'maxSellMetal', step: '0.01', mode: 'decimal', ph: '∞', w: 70 },
    ];

    items.forEach((item, idx) => {
      // Build the item name cell with optional autobot.tf link if SKU is available
      let itemNameHtml = item.name;
      if (item.sku) {
        itemNameHtml = `<a href="${externalLinks.autobotTfBaseUrl}/items/${item.sku}" class="bnd-link" target="_blank" title="View ${item.name} on autobot.tf">${item.name} 🔗</a>`;
      }
      
      tbl += `
        <tr class="item-row" data-name="${item.name.toLowerCase()}">
          <td class="bnd-name">${itemNameHtml}</td>
          ${BOUND_COLS.map(
            (c) => `<td class="bnd ${c.side}${c.last ? ' grp-end' : ''}">
            <input type="number" step="${c.step}" name="${c.field}_${idx}" value="${item[c.field] ?? ''}"
                   lang="en" inputmode="${c.mode}" style="width: ${c.w}px;"
                   placeholder="${c.ph}">
          </td>`
          ).join('')}
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
      </div>
      <script>
        function filterItems(searchText) {
          const search = searchText.toLowerCase().trim();
          const rows = document.querySelectorAll('.item-row');
          let visibleCount = 0;
          
          rows.forEach(row => {
            const itemName = row.getAttribute('data-name');
            if (!search || itemName.includes(search)) {
              row.style.display = '';
              visibleCount++;
            } else {
              row.style.display = 'none';
            }
          });
          
          // Update visible count if you want to show it
          const countElement = document.getElementById('visibleCount');
          if (countElement) {
            countElement.textContent = visibleCount;
          }
        }
      </script>`;

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

    // Search/Filter Box
    html +=
      '<div style="background: white; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #ddd;">';
    html += '<label for="itemSearch" style="display: block; margin-bottom: 8px; font-weight: bold;">🔍 Search Items:</label>';
    html +=
      '<input type="text" id="itemSearch" placeholder="Type to filter items..." '
    html +=
      'style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;" '
    html +=
      'oninput="filterItems(this.value)">';
    html += '<small style="color: #666; display: block; margin-top: 5px;">Filter items by name in the table below</small>';
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
      const validationErrors = [];
      
      // Rough key price estimate for validation (using typical value)
      const keyPrice = 60; // Approximate key price in refined metal

      for (let i = 0; i < count; i++) {
        const name = req.body[`name_${i}`];
        const item = itemList.items.find((it) => it.name === name);
        if (!item) continue;
        
        // Parse all values with locale support
        const minBuyKeys = parseFloatLocale(req.body[`minBuyKeys_${i}`]);
        const minBuyMetal = parseFloatLocale(req.body[`minBuyMetal_${i}`]);
        const maxBuyKeys = parseFloatLocale(req.body[`maxBuyKeys_${i}`]);
        const maxBuyMetal = parseFloatLocale(req.body[`maxBuyMetal_${i}`]);
        const minSellKeys = parseFloatLocale(req.body[`minSellKeys_${i}`]);
        const minSellMetal = parseFloatLocale(req.body[`minSellMetal_${i}`]);
        const maxSellKeys = parseFloatLocale(req.body[`maxSellKeys_${i}`]);
        const maxSellMetal = parseFloatLocale(req.body[`maxSellMetal_${i}`]);
        
        // Convert empty strings to undefined
        const bounds = {
          minBuyKeys: !isNaN(minBuyKeys) && minBuyKeys >= 0 ? minBuyKeys : undefined,
          minBuyMetal: !isNaN(minBuyMetal) && minBuyMetal >= 0 ? minBuyMetal : undefined,
          maxBuyKeys: !isNaN(maxBuyKeys) && maxBuyKeys >= 0 ? maxBuyKeys : undefined,
          maxBuyMetal: !isNaN(maxBuyMetal) && maxBuyMetal >= 0 ? maxBuyMetal : undefined,
          minSellKeys: !isNaN(minSellKeys) && minSellKeys >= 0 ? minSellKeys : undefined,
          minSellMetal: !isNaN(minSellMetal) && minSellMetal >= 0 ? minSellMetal : undefined,
          maxSellKeys: !isNaN(maxSellKeys) && maxSellKeys >= 0 ? maxSellKeys : undefined,
          maxSellMetal: !isNaN(maxSellMetal) && maxSellMetal >= 0 ? maxSellMetal : undefined,
        };
        
        // Validation: Check for conflicting bounds using total metal value
        if (bounds.minBuyKeys !== undefined || bounds.minBuyMetal !== undefined) {
          const minBuyTotal = toTotalMetal(bounds.minBuyKeys || 0, bounds.minBuyMetal || 0, keyPrice);
          
          if (bounds.maxBuyKeys !== undefined || bounds.maxBuyMetal !== undefined) {
            const maxBuyTotal = toTotalMetal(bounds.maxBuyKeys || 0, bounds.maxBuyMetal || 0, keyPrice);
            if (minBuyTotal > maxBuyTotal) {
              validationErrors.push(`${name}: Min buy (${minBuyTotal.toFixed(2)} ref) > Max buy (${maxBuyTotal.toFixed(2)} ref)`);
              continue;
            }
          }
        }
        
        if (bounds.minSellKeys !== undefined || bounds.minSellMetal !== undefined) {
          const minSellTotal = toTotalMetal(bounds.minSellKeys || 0, bounds.minSellMetal || 0, keyPrice);
          
          if (bounds.maxSellKeys !== undefined || bounds.maxSellMetal !== undefined) {
            const maxSellTotal = toTotalMetal(bounds.maxSellKeys || 0, bounds.maxSellMetal || 0, keyPrice);
            if (minSellTotal > maxSellTotal) {
              validationErrors.push(`${name}: Min sell (${minSellTotal.toFixed(2)} ref) > Max sell (${maxSellTotal.toFixed(2)} ref)`);
              continue;
            }
          }
        }
        
        // Check if min sell < min buy (can't profit)
        if ((bounds.minBuyKeys !== undefined || bounds.minBuyMetal !== undefined) &&
            (bounds.minSellKeys !== undefined || bounds.minSellMetal !== undefined)) {
          const minBuyTotal = toTotalMetal(bounds.minBuyKeys || 0, bounds.minBuyMetal || 0, keyPrice);
          const minSellTotal = toTotalMetal(bounds.minSellKeys || 0, bounds.minSellMetal || 0, keyPrice);
          if (minSellTotal < minBuyTotal) {
            validationErrors.push(`${name}: Warning - Min sell (${minSellTotal.toFixed(2)} ref) < Min buy (${minBuyTotal.toFixed(2)} ref) - no profit margin`);
            // Don't skip, just warn
          }
        }
        
        // Apply validated bounds
        let hasChanges = false;
        for (const field in bounds) {
          if (item[field] !== bounds[field]) {
            hasChanges = true;
            item[field] = bounds[field];
          }
        }
        
        if (hasChanges) {
          updatedCount++;
        }
      }

      saveJson(itemListPath, itemList);

      let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
      
      if (validationErrors.length > 0) {
        html +=
          '<div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin-bottom: 20px;">';
        html += '<h3 style="color: #856404;">⚠️ Validation Warnings</h3>';
        html += '<ul style="text-align: left; color: #856404;">';
        validationErrors.forEach(error => {
          html += `<li>${error}</li>`;
        });
        html += '</ul>';
        html += '</div>';
      }
      
      html +=
        '<div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 8px; text-align: center;">';
      html += '<h2>✅ Price Bounds Updated Successfully</h2>';
      html += `<p><strong>${updatedCount}</strong> items had their price bounds updated.</p>`;
      html += `<p>Total items processed: <strong>${count}</strong></p>`;
      if (validationErrors.length > 0) {
        html += `<p><strong>${validationErrors.length}</strong> items had validation issues (see warnings above).</p>`;
      }
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
