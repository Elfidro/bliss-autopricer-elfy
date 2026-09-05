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
        <div class="ui-card" style="text-align: center; padding: 36px 20px;">
          <div style="font-size: 36px; margin-bottom: 10px;">📦</div>
          <h3>No Items Found</h3>
          <p style="margin: 0; color: var(--text-muted);">No items are currently configured for price bounds management.</p>
        </div>
      `;
    }

    let tbl = `
      <div class="table-container">
        <div class="table-header-bar">
          <div>
            <h3 style="margin: 0;"><span>⚙️</span> Price Bounds Configuration</h3>
            <p style="margin: 4px 0 0 0; color: var(--text-muted);">Set minimum and maximum price limits for buying and selling items</p>
          </div>
          <span class="badge badge-info" id="visibleCountBadge"><span id="visibleCount">${items.length}</span> items</span>
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
      let itemNameHtml = item.name;
      if (item.sku) {
        itemNameHtml = `<a href="${externalLinks.autobotTfBaseUrl}/items/${item.sku}" class="bnd-link" target="_blank" rel="noopener noreferrer" title="View ${item.name} on autobot.tf">${item.name} <span style="font-size: 11px; opacity: 0.6;">↗</span></a>`;
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
          <div style="text-align: center; padding-top: 18px; border-top: 1px solid var(--border); margin-top: 14px;">
            <button type="submit" class="btn btn-success" style="font-size: 1rem; padding: 12px 28px;">
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
    
    const nameToSkuMap = new Map();
    priceList.forEach(priceItem => {
      nameToSkuMap.set(priceItem.name, priceItem.sku);
    });
    
    const enrichedItemList = itemList.map(item => ({
      ...item,
      sku: nameToSkuMap.get(item.name) || null
    }));

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

    let html = '<div style="max-width: 1560px; margin: 0 auto;">';

    // Header
    html += `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
        <div>
          <h1 style="font-size: 1.9rem; font-weight: 800; margin-bottom: 6px; display: flex; align-items: center; gap: 12px;">
            <span>⚙️</span> Item Price Bounds Management
          </h1>
          <p style="margin: 0; font-size: 0.95rem; color: var(--text-muted);">
            Configure minimum and maximum price boundaries for buying and selling items. Blank fields represent unconstrained pricing.
          </p>
        </div>
        <div style="display: flex; gap: 10px;">
          <a href="/" class="btn btn-secondary"><span>📋</span> Price List</a>
          <a href="/bot-config" class="btn btn-secondary"><span>🤖</span> Bot Config</a>
        </div>
      </div>
    `;

    // Stats Grid
    html += `
      <div class="stats-grid">
        <div class="stat-card stat-info">
          <div class="stat-top">
            <span class="stat-title">Tracked Items</span>
            <div class="stat-icon-wrapper">📦</div>
          </div>
          <div class="stat-value">${enrichedItemList.length}</div>
          <p class="stat-desc">Total items in item_list.json</p>
        </div>

        <div class="stat-card stat-ok">
          <div class="stat-top">
            <span class="stat-title">Configured Bounds</span>
            <div class="stat-icon-wrapper">⚖️</div>
          </div>
          <div class="stat-value">${boundsConfigured}</div>
          <p class="stat-desc">Items with custom safety limits</p>
        </div>

        <div class="stat-card stat-warn">
          <div class="stat-top">
            <span class="stat-title">Unbounded Items</span>
            <div class="stat-icon-wrapper">🔓</div>
          </div>
          <div class="stat-value">${enrichedItemList.length - boundsConfigured}</div>
          <p class="stat-desc">Follow raw calculated market prices</p>
        </div>

        <div class="stat-card stat-ok">
          <div class="stat-top">
            <span class="stat-title">PriceDB Matched</span>
            <div class="stat-icon-wrapper">🔑</div>
          </div>
          <div class="stat-value">${enrichedItemList.filter(i => i.sku).length}</div>
          <p class="stat-desc">Items with verified schema SKUs</p>
        </div>
      </div>
    `;

    // Search Bar
    html += `
      <div class="ui-card" style="padding: 16px 20px; margin-bottom: 20px;">
        <div class="search-input-wrap">
          <span class="search-input-icon">🔍</span>
          <input type="text" id="itemSearch" placeholder="Type to filter items by name..." oninput="filterItems(this.value)">
        </div>
      </div>
    `;

    // Instructions Card
    html += `
      <div class="ui-card" style="padding: 18px 24px; margin-bottom: 24px; border-left: 4px solid var(--accent);">
        <h4 style="margin-bottom: 8px; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
          <span>💡</span> Price Bounds Guide
        </h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; font-size: 0.88rem; color: var(--text-muted);">
          <div><strong>Min Limits:</strong> Absolute floor for buying or selling. Price will never drop below this.</div>
          <div><strong>Max Limits:</strong> Absolute ceiling for buying or selling. Price will never exceed this.</div>
          <div><strong>Blank Fields:</strong> Leave empty for unconstrained calculation based on market listings.</div>
          <div><strong>Direct Links:</strong> Click ↗ next to any item to verify its live market order book on autobot.tf.</div>
        </div>
      </div>
    `;

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
