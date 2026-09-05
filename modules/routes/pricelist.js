const path = require('path');
const express = require('express');
const { loadJson } = require('../utils');
const renderPage = require('../layout');
const { getBaseConfigManager } = require('../baseConfigManager');
const { getSchemaManager } = require('../schemaInstance');
const { db } = require('../dbInstance');

module.exports = function (app, config, configManager) {
  const router = express.Router();
  const thresholdSec = config.ageThresholdSec;
  
  const baseConfig = getBaseConfigManager().getConfig();
  const externalLinks = baseConfig.externalLinks || { autobotTfBaseUrl: 'http://autobot.tf' };

  // Helper function to get current bot paths
  function getBotPaths() {
    const selectedBot = configManager.getSelectedBot();
    if (!selectedBot) {
      throw new Error('No bot selected. Please configure a bot first.');
    }

    // Use the pre-calculated pricelistPath if available, otherwise construct it
    let sellingPricelistPath;
    if (selectedBot.pricelistPath) {
      sellingPricelistPath = selectedBot.pricelistPath;
    } else {
      const tf2autobotPath = selectedBot.tf2autobotPath || selectedBot.tf2AutobotDir;
      const botDirectory = selectedBot.botDirectory || selectedBot.botTradingDir;

      if (!tf2autobotPath || !botDirectory) {
        throw new Error(
          `Missing bot path configuration. tf2autobotPath: ${tf2autobotPath}, botDirectory: ${botDirectory}`
        );
      }

      sellingPricelistPath = path.resolve(tf2autobotPath, botDirectory, 'pricelist.json');
    }

    return {
      pricelistPath: path.resolve(__dirname, '../../files/pricelist.json'),
      sellingPricelistPath,
      itemListPath: path.resolve(__dirname, '../../files/item_list.json'),
    };
  }

  function buildTable(items, showAge, sell) {
    items.sort((a, b) => a.name.localeCompare(b.name));

    let tbl = '<table class="data-table">';
    tbl += '<thead>';
    tbl += '<tr>';
    tbl += '<th style="width: 24%;">Item Name</th>';
    tbl += '<th style="width: 12%;">SKU</th>';
    tbl += '<th style="width: 14%; text-align: center;">Last Updated</th>';

    if (showAge) {
      tbl += '<th style="width: 10%; text-align: center;">Age</th>';
    }

    tbl += '<th style="width: 13%; text-align: center;">Buy Price</th>';
    tbl += '<th style="width: 13%; text-align: center;">Sell Price</th>';
    tbl += '<th style="width: 8%; text-align: center;">In Bot</th>';
    tbl += '<th style="width: 16%; text-align: center;">Bot Actions</th>';
    tbl += '</tr>';
    tbl += '</thead>';
    tbl += '<tbody>';

    items.forEach((item) => {
      const last = new Date(item.time * 1000).toLocaleString();
      const ageH = (item.age / 3600).toFixed(1);
      const buyUnit = item.buy.keys === 1 ? 'Key' : 'Keys';
      const sellUnit = item.sell.keys === 1 ? 'Key' : 'Keys';
      const inBot = item.inSelling;
      const sku = item.sku;
      const currentSell = sell[sku];
      const defaultMin = currentSell?.min || 1;
      const defaultMax = currentSell?.max || 1;

      // Clean CSS row status class without hardcoding solid pastel backgrounds
      let rowClass = 'row-current';
      let ageBadgeClass = 'badge-ok';

      if (showAge) {
        if (item.age > 2 * 24 * 3600) {
          rowClass = 'row-outdated-critical';
          ageBadgeClass = 'badge-danger';
        } else if (item.age > 24 * 3600) {
          rowClass = 'row-outdated-warn';
          ageBadgeClass = 'badge-warn';
        } else {
          rowClass = 'row-outdated-recent';
          ageBadgeClass = 'badge-warn';
        }
      }

      const actionControls = `
        <div style="display: flex; align-items: center; gap: 6px; justify-content: center; flex-wrap: nowrap;">
          <div style="display: flex; align-items: center; gap: 3px;" title="Minimum quantity in bot">
            <span style="font-size: 10px; color: var(--text-dim); font-weight: 700;">MIN</span>
            <input type="number" id="min-${sku}" value="${defaultMin}" 
                   style="width: 48px; padding: 4px 6px; font-size: 12px; text-align: center;" 
                   min="1">
          </div>
          <div style="display: flex; align-items: center; gap: 3px;" title="Maximum quantity in bot">
            <span style="font-size: 10px; color: var(--text-dim); font-weight: 700;">MAX</span>
            <input type="number" id="max-${sku}" value="${defaultMax}" 
                   style="width: 48px; padding: 4px 6px; font-size: 12px; text-align: center;" 
                   min="1">
          </div>
          <div style="display: flex; gap: 4px; margin-left: 2px;">
            ${
              inBot
                ? `<button onclick="queueAction('remove','${sku}')" class="btn-icon-action act-remove" title="Queue removal from bot">✕</button>
                   <button onclick="queueEdit('${sku}')" class="btn-icon-action act-edit" title="Queue quantity updates">✎</button>`
                : `<button onclick="queueAction('add','${sku}')" class="btn-icon-action act-add" title="Queue addition to bot">+ Add</button>`
            }
          </div>
        </div>
      `;

      tbl += `<tr class="${rowClass}" data-age="${item.age}" data-inbot="${inBot}">`;
      tbl += `<td class="name" style="font-weight: 600;">
                <a href="${externalLinks.autobotTfBaseUrl}/items/${sku}" target="_blank" rel="noopener noreferrer" title="View ${item.name} on autobot.tf">
                  ${item.name}
                  <span style="font-size: 11px; opacity: 0.6; margin-left: 3px;">↗</span>
                </a>
              </td>`;
      tbl += `<td class="sku"><code class="sku-badge">${sku}</code></td>`;
      tbl += `<td style="text-align: center; font-size: 0.84rem; color: var(--text-muted);">${last}</td>`;

      if (showAge) {
        tbl += `<td style="text-align: center;"><span class="badge ${ageBadgeClass}">${ageH}h</span></td>`;
      }

      tbl += `<td style="text-align: center;">
                <span class="price-tag price-buy">${item.buy.keys} ${buyUnit} + ${item.buy.metal} Ref</span>
              </td>`;
      tbl += `<td style="text-align: center;">
                <span class="price-tag price-sell">${item.sell.keys} ${sellUnit} + ${item.sell.metal} Ref</span>
              </td>`;
      tbl += `<td style="text-align: center;">
                <span class="bot-status ${inBot ? 'in-bot' : 'not-in-bot'}">${inBot ? '● In Bot' : '○ Not In Bot'}</span>
              </td>`;
      tbl += `<td style="text-align: center;">${actionControls}</td>`;
      tbl += '</tr>';
    });

    tbl += '</tbody></table>';
    return tbl;
  }

  // listing_stats is keyed by sku; watchlist entries are names. Priced items
  // already carry a sku, so only unpriced ones need a schema lookup.
  function resolveSku(row) {
    if (row.sku) {
      return row.sku;
    }
    const schema = getSchemaManager()?.schema;
    if (!schema) {
      return null;
    }
    try {
      const sku = schema.getSkuFromName(row.name);
      return !sku || /^(null|undefined|-1)\b/.test(String(sku)) ? null : sku;
    } catch {
      return null;
    }
  }

  async function loadListingStats() {
    try {
      const rows = await db.any(
        'SELECT sku, current_buy_count, current_sell_count FROM listing_stats'
      );
      return new Map(rows.map((r) => [r.sku, r]));
    } catch (err) {
      console.error('Could not load listing stats:', err.message);
      return null;
    }
  }

  // Mirrors the gate in getPricableItems: current_buy_count >= minListingCount.
  function listingCell(row, stats) {
    const sku = resolveSku(row);
    if (!sku) {
      return '<span class="badge badge-danger" title="This name does not resolve to a TF2 item, so the websocket will never match a listing for it">⚠ Name unmatched</span>';
    }
    if (!stats) {
      return '<span style="color: var(--text-dim);">unavailable</span>';
    }

    const need = Number(baseConfig.minListingCount) || 3;
    const s = stats.get(sku);
    const buy = s ? Number(s.current_buy_count) || 0 : 0;
    const sell = s ? Number(s.current_sell_count) || 0 : 0;

    if (buy === 0 && sell === 0) {
      return '<span class="badge badge-muted" title="Tracked, but no listings have come through the feed yet">○ Waiting</span>';
    }
    if (buy >= need) {
      return `<span class="badge badge-ok" title="Enough buy listings to price">● ${buy} buy / ${sell} sell</span>`;
    }
    return `<span class="badge badge-warn" title="Collecting — needs ${need} buy listings to price">◐ ${buy} buy / ${sell} sell (need ${need})</span>`;
  }

  function buildWatchlistTable(rows, stats) {
    if (rows.length === 0) {
      return `
        <div style="text-align: center; padding: 48px 24px;">
          <h4 style="font-size: 1.1rem; margin-bottom: 6px;">Watchlist is empty</h4>
          <p style="margin: 0; color: var(--text-muted);">Add items with the form above to start tracking prices for them.</p>
        </div>
      `;
    }

    const STATUS = {
      current: { label: 'Current', cls: 'badge-ok' },
      outdated: { label: 'Outdated', cls: 'badge-warn' },
      unpriced: { label: 'Unpriced', cls: 'badge-muted' },
    };

    let tbl = '<table class="data-table">';
    tbl += '<thead><tr>';
    tbl += '<th style="width: 30%;">Item Name</th>';
    tbl += '<th style="width: 12%; text-align: center;">Status</th>';
    tbl += '<th style="width: 20%; text-align: center;">Listings</th>';
    tbl += '<th style="width: 14%; text-align: center;">Buy Price</th>';
    tbl += '<th style="width: 14%; text-align: center;">Sell Price</th>';
    tbl += '<th style="width: 10%; text-align: center;">Age</th>';
    tbl += '</tr></thead><tbody>';

    rows.forEach((row) => {
      const st = STATUS[row.status];
      const priced = row.status !== 'unpriced';
      const buyUnit = priced && row.buy.keys === 1 ? 'Key' : 'Keys';
      const sellUnit = priced && row.sell.keys === 1 ? 'Key' : 'Keys';
      const nameHtml = row.sku
        ? `<a href="${externalLinks.autobotTfBaseUrl}/items/${row.sku}" target="_blank" rel="noopener noreferrer" style="font-weight: 600;" title="View ${row.name} on autobot.tf">${row.name} <span style="font-size: 11px; opacity: 0.6;">↗</span></a>`
        : `<span style="font-weight: 600;">${row.name}</span>`;

      const rowStatusClass = row.status === 'outdated' ? 'row-outdated-warn' : row.status === 'current' ? 'row-current' : '';

      tbl += `<tr class="${rowStatusClass}" data-name="${row.name.toLowerCase()}">`;
      tbl += `<td class="name">${nameHtml}</td>`;
      tbl += `<td style="text-align: center;"><span class="badge ${st.cls}">${st.label}</span></td>`;
      tbl += `<td style="text-align: center;">${listingCell(row, stats)}</td>`;
      tbl += priced
        ? `<td style="text-align: center;"><span class="price-tag price-buy">${row.buy.keys} ${buyUnit} + ${row.buy.metal} Ref</span></td>`
        : '<td style="text-align: center; color: var(--text-dim); font-family: var(--font-mono);">—</td>';
      tbl += priced
        ? `<td style="text-align: center;"><span class="price-tag price-sell">${row.sell.keys} ${sellUnit} + ${row.sell.metal} Ref</span></td>`
        : '<td style="text-align: center; color: var(--text-dim); font-family: var(--font-mono);">—</td>';
      tbl += priced
        ? `<td style="text-align: center;"><span class="badge badge-muted">${(row.age / 3600).toFixed(1)}h</span></td>`
        : '<td style="text-align: center; color: var(--text-dim); font-family: var(--font-mono);">—</td>';
      tbl += '</tr>';
    });

    tbl += '</tbody></table>';
    return tbl;
  }

  function buildMissingTable(names, stats) {
    if (names.length === 0) {
      return `
        <div style="text-align: center; padding: 48px 24px;">
          <h4 style="font-size: 1.1rem; margin-bottom: 6px;">🎉 All Items Have Prices</h4>
          <p style="margin: 0; color: var(--text-muted);">All items in your watchlist have current price data!</p>
        </div>
      `;
    }

    names.sort();
    let tbl = '<table class="data-table">';
    tbl += '<thead><tr>';
    tbl += '<th style="width: 60%;">Item Name</th>';
    tbl += '<th style="width: 40%; text-align: center;">Listing Feed Status</th>';
    tbl += '</tr></thead>';
    tbl += '<tbody>';

    names.forEach((name) => {
      tbl += `<tr data-age="0" data-inbot="false">`;
      tbl += `<td class="name" style="font-weight: 600;">${name}</td>`;
      tbl += `<td style="text-align: center;">${listingCell({ name }, stats)}</td>`;
      tbl += '</tr>';
    });

    tbl += '</tbody></table>';
    return tbl;
  }

  function loadData() {
    const paths = getBotPaths();
    const main = loadJson(paths.pricelistPath);
    const sell = loadJson(paths.sellingPricelistPath);
    const itemList = loadJson(paths.itemListPath).items.map((i) => i.name);
    const now = Math.floor(Date.now() / 1000);
    const outdated = [],
      current = [],
      priced = new Set();

    const byName = new Map();

    main.items.forEach((item) => {
      const age = now - item.time;
      const inSelling = Boolean(sell[item.sku]);
      priced.add(item.name);
      const annotated = { ...item, age, inSelling };
      byName.set(item.name, annotated);
      (age > thresholdSec ? outdated : current).push(annotated);
    });

    const missing = itemList.filter((n) => !priced.has(n));

    const statusRank = { unpriced: 0, outdated: 1, current: 2 };
    const watchlist = itemList
      .map((name) => {
        const p = byName.get(name);
        if (!p) {
          return { name, status: 'unpriced', inSelling: false };
        }
        return { ...p, status: p.age > thresholdSec ? 'outdated' : 'current' };
      })
      .sort(
        (a, b) => statusRank[a.status] - statusRank[b.status] || a.name.localeCompare(b.name)
      );

    return { outdated, current, missing, sell, watchlist };
  }

  // HTML-escape user-controlled text. Defined outside the route handler so the
  // catch block can use it for error messages too.
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  router.get('/', async (req, res) => {
    try {
      // Check if bot is configured
      const selectedBot = configManager.getSelectedBot();
      if (!selectedBot) {
        let html = '<div style="max-width: 800px; margin: 40px auto; padding: 20px;">';
        html +=
          '<div class="ui-card" style="text-align: center; border-color: var(--warn);">';
        html += '<div style="font-size: 42px; margin-bottom: 12px;">🤖</div>';
        html += '<h2 style="margin-bottom: 8px;">No Bot Configuration Found</h2>';
        html += '<p>You need to configure a bot before viewing pricelist data.</p>';
        html += "<p style='margin-bottom: 24px;'>The pricelist manager requires access to your bot's pricelist and files.</p>";
        html +=
          '<a href="/bot-config" class="btn btn-primary">🤖 Configure Bot</a>';
        html += '</div>';
        html += '</div>';
        return res.send(renderPage('Pricelist Manager - No Bot Configured', html));
      }

      const { outdated, current, missing, sell, watchlist } = loadData();
      const listingStats = await loadListingStats();
      const botItemCount = Object.keys(sell).length;

      let html = '<div style="max-width: 1560px; margin: 0 auto;">';

      // Result of the last /add-item
      if (req.query.addError) {
        html += `<div class="flash flash-error"><span>⚠️</span> ${esc(req.query.addError)}</div>`;
      } else if (req.query.added) {
        html += `<div class="flash flash-ok"><span>✅</span> Added "<strong>${esc(req.query.added)}</strong>" to the watchlist.</div>`;
      }

      // Page Header
      html += `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
          <div>
            <h1 style="font-size: 1.9rem; font-weight: 800; margin-bottom: 6px; display: flex; align-items: center; gap: 12px;">
              <span>📊</span> Pricelist Status Dashboard
            </h1>
            <p style="margin: 0; font-size: 0.95rem; color: var(--text-muted);">
              Monitor price freshness, manage active bot quantities, and execute batch pricelist adjustments.
            </p>
          </div>
          <div style="display: flex; gap: 10px;">
            <a href="/bot-config" class="btn btn-secondary"><span>🤖</span> Bot Config</a>
            <a href="/bounds" class="btn btn-secondary"><span>⚖️</span> Price Bounds</a>
          </div>
        </div>
      `;

      // Summary Statistics Grid
      html += `
        <div class="stats-grid">
          <div class="stat-card stat-danger">
            <div class="stat-top">
              <span class="stat-title">Outdated Items</span>
              <div class="stat-icon-wrapper">⏰</div>
            </div>
            <div class="stat-value">${outdated.length}</div>
            <p class="stat-desc">Prices older than ${(thresholdSec / 3600).toFixed(0)} hours</p>
          </div>

          <div class="stat-card stat-ok">
            <div class="stat-top">
              <span class="stat-title">Current Items</span>
              <div class="stat-icon-wrapper">✅</div>
            </div>
            <div class="stat-value">${current.length}</div>
            <p class="stat-desc">Recent prices active & ready</p>
          </div>

          <div class="stat-card stat-warn">
            <div class="stat-top">
              <span class="stat-title">Unpriced Items</span>
              <div class="stat-icon-wrapper">❓</div>
            </div>
            <div class="stat-value">${missing.length}</div>
            <p class="stat-desc">Watchlist items awaiting feed</p>
          </div>

          <div class="stat-card stat-info">
            <div class="stat-top">
              <span class="stat-title">Bot Inventory</span>
              <div class="stat-icon-wrapper">🤖</div>
            </div>
            <div class="stat-value">${botItemCount}</div>
            <p class="stat-desc">Items in bot pricelist</p>
          </div>
        </div>
      `;

      // Search & Filter Bar
      html += `
        <div class="ui-card" style="padding: 16px 20px; margin-bottom: 20px;">
          <div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
            <div class="search-input-wrap">
              <span class="search-input-icon">🔍</span>
              <input type="text" id="search" placeholder="Search by item name or SKU...">
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
              <label class="filter-chip"><input type="checkbox" class="filter" id="filter-notinbot"> Not In Bot</label>
              <label class="filter-chip"><input type="checkbox" class="filter" id="filter-2h"> Age ≥ 2h</label>
              <label class="filter-chip"><input type="checkbox" class="filter" id="filter-1d"> Age ≥ 24h</label>
              <label class="filter-chip"><input type="checkbox" class="filter" id="filter-3d"> Age ≥ 72h</label>
            </div>
          </div>
        </div>
      `;

      // Add New Item Card
      html += `
        <div class="ui-card" style="padding: 20px 24px; margin-bottom: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
            <h3 style="margin: 0; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
              <span>➕</span> Add Item to Tracker
            </h3>
            <span style="font-size: 0.84rem; color: var(--text-dim);">
              Adds item to item_list.json so the background websocket collects listings
            </span>
          </div>
          <form method="POST" action="/add-item" style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <input type="text" name="name" placeholder="Enter item name (e.g. 'Scattergun', 'Tour of Duty Ticket', 'Strange Rocket Launcher')" required style="flex: 1; min-width: 280px;">
            <button type="submit" class="btn btn-success">+ Add to Watchlist</button>
          </form>
        </div>
      `;

      // Watchlist Table Section
      html += `
        <div class="table-container">
          <div class="table-header-bar">
            <div>
              <h3><span>📋</span> Watchlist (${watchlist.length})</h3>
              <p>Every item tracked in item_list.json, with status and real-time listing feed counts.</p>
            </div>
          </div>
          <div style="overflow-x: auto;">
            ${buildWatchlistTable(watchlist, listingStats)}
          </div>
        </div>
      `;

      // Outdated Items Section
      if (outdated.length > 0) {
        html += `
          <div class="table-container">
            <div class="table-header-bar" style="border-left: 4px solid var(--danger);">
              <div>
                <h3 style="color: var(--danger-text);"><span>⏰</span> Outdated Items (${outdated.length})</h3>
                <p>Items with prices older than ${(thresholdSec / 3600).toFixed(0)} hours — recommend recalculating or verifying listings.</p>
              </div>
            </div>
            <div style="overflow-x: auto;">
              ${buildTable(outdated, true, sell)}
            </div>
          </div>
        `;
      }

      // Current Items Section
      if (current.length > 0) {
        html += `
          <div class="table-container">
            <div class="table-header-bar" style="border-left: 4px solid var(--ok);">
              <div>
                <h3 style="color: var(--ok-text);"><span>✅</span> Current Items (${current.length})</h3>
                <p>Items with recent price updates — currently active and safe for bot trading.</p>
              </div>
            </div>
            <div style="overflow-x: auto;">
              ${buildTable(current, false, sell)}
            </div>
          </div>
        `;
      }

      // Unpriced Items Section
      if (missing.length > 0) {
        html += `
          <div class="table-container">
            <div class="table-header-bar" style="border-left: 4px solid var(--warn);">
              <div>
                <h3 style="color: var(--warn-text);"><span>❓</span> Unpriced Items (${missing.length})</h3>
                <p>Tracked items waiting for sufficient buy/sell listings from the live market websocket.</p>
              </div>
            </div>
            <div style="overflow-x: auto;">
              ${buildMissingTable(missing, listingStats)}
            </div>
          </div>
        `;
      }

      // Tips & Guide Card
      html += `
        <div class="ui-card" style="border-left: 4px solid var(--accent); background: var(--surface);">
          <h4 style="margin-bottom: 12px; font-size: 1.05rem; display: flex; align-items: center; gap: 8px;">
            <span>💡</span> Pricelist Pro Tips
          </h4>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; font-size: 0.88rem; color: var(--text-muted);">
            <div><strong>Instant Queue:</strong> Clicking <strong>+ Add</strong> or <strong>✕ Remove</strong> stages the operation in the floating queue dock at bottom-right.</div>
            <div><strong>Safe Restarts:</strong> The bot is only restarted when bot pricelist items change. Tracker additions never interrupt active trading.</div>
            <div><strong>Age Color Codes:</strong> Amber indicates items older than 24h; Red indicates items older than 48h that need immediate attention.</div>
            <div><strong>External Links:</strong> Click any item name with the ↗ icon to inspect its live market order book directly on autobot.tf.</div>
          </div>
        </div>
      `;

      // Floating Dock Pending Actions Queue Panel
      html += `
        <div id="queue-panel">
          <div class="queue-header" onclick="toggleQueuePanel()" title="Click to minimize or expand">
            <div class="queue-title-wrap">
              <span style="font-size: 1.1rem;">⚡</span>
              <span style="font-weight: 700; font-size: 0.92rem; color: var(--text);">Pending Actions</span>
              <span class="queue-badge-count" id="queue-counter">0</span>
            </div>
            <button id="queue-toggle-btn" type="button" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 13px;">▼</button>
          </div>
          <div class="queue-body">
            <ul id="queue-list"></ul>
            <div style="display: flex; gap: 8px; margin-top: 14px;">
              <button id="apply-queue-btn" onclick="applyQueue()" class="btn btn-primary" style="flex: 1;">Apply All</button>
              <button onclick="clearQueue()" class="btn btn-secondary" style="padding: 8px 12px;" title="Discard all pending changes">Clear</button>
            </div>
          </div>
        </div>
      `;

      html += '</div>';

      // Client JavaScript
      html += `
        <script>
          let queue = [];
          let isQueueMinimized = false;

          function toggleQueuePanel() {
            const panel = document.getElementById('queue-panel');
            const toggleBtn = document.getElementById('queue-toggle-btn');
            isQueueMinimized = !isQueueMinimized;
            if (isQueueMinimized) {
              panel.classList.add('minimized');
              toggleBtn.textContent = '▲';
            } else {
              panel.classList.remove('minimized');
              toggleBtn.textContent = '▼';
            }
          }

          function clearQueue() {
            if (!queue.length) return;
            if (confirm('Discard all ' + queue.length + ' pending action(s)?')) {
              queue = [];
              refreshQueue();
            }
          }

          function refreshQueue() {
            const ul = document.getElementById('queue-list');
            const counter = document.getElementById('queue-counter');
            const panel = document.getElementById('queue-panel');
            ul.innerHTML = '';
            counter.textContent = queue.length;

            updateApplyButton();

            if (queue.length === 0) {
              const li = document.createElement('li');
              li.style.cssText = 'color: var(--text-dim); font-style: italic; padding: 12px; text-align: center; font-size: 0.85rem;';
              li.textContent = 'No pending actions';
              ul.appendChild(li);
              return;
            }

            // Auto-expand panel when items are added
            if (isQueueMinimized && queue.length > 0) {
              panel.classList.remove('minimized');
              isQueueMinimized = false;
              document.getElementById('queue-toggle-btn').textContent = '▼';
            }

            queue.forEach(function(q, i) {
              const li = document.createElement('li');
              
              let actionBadge = '';
              let descText = '';

              if (q.action === 'add') {
                actionBadge = '<span class="badge badge-ok">+ ADD</span>';
                descText = \`<strong>\${q.sku}</strong> (Min: \${q.min || 1}, Max: \${q.max || 1})\`;
              } else if (q.action === 'edit') {
                actionBadge = '<span class="badge badge-warn">✎ EDIT</span>';
                descText = \`<strong>\${q.sku}</strong> (Min: \${q.min}, Max: \${q.max})\`;
              } else if (q.action === 'remove') {
                actionBadge = '<span class="badge badge-danger">✕ REMOVE</span>';
                descText = \`<strong>\${q.sku}</strong>\`;
              } else if (q.action === 'addName') {
                actionBadge = '<span class="badge badge-info">+ WATCH</span>';
                descText = \`<strong>\${q.name}</strong>\`;
              }

              li.innerHTML = \`
                <div style="display: flex; align-items: center; gap: 8px; font-size: 0.86rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  \${actionBadge}
                  <span style="color: var(--text);">\${descText}</span>
                </div>
                <span style="color: var(--text-dim); font-size: 14px; font-weight: bold; margin-left: 8px;" title="Click to remove from queue">✕</span>
              \`;
              
              li.dataset.index = i;
              li.addEventListener('click', function() {
                queue.splice(this.dataset.index, 1);
                refreshQueue();
              });
              ul.appendChild(li);
            });
          }

          function queueNeedsRestart() {
            return queue.some(function (q) { return q.action !== 'addName'; });
          }

          function updateApplyButton() {
            const button = document.getElementById('apply-queue-btn');
            if (!button) { return; }
            button.textContent = queueNeedsRestart() ? 'Apply All & Restart Bot' : 'Apply All';
          }

          function queueAction(action, value) {
            let sku, name, min, max;
            
            if (action === 'addName') {
              try {
                name = decodeURIComponent(value);
              } catch {
                name = value;
              }
            } else {
              sku = value;
              if (action === 'add') {
                min = parseInt(document.getElementById('min-' + sku).value) || 1;
                max = parseInt(document.getElementById('max-' + sku).value) || 1;
              }
            }
            
            queue.push({ action, sku, name, min, max });
            refreshQueue();
          }

          function queueEdit(sku) {
            const min = parseInt(document.getElementById('min-' + sku).value) || 1;
            const max = parseInt(document.getElementById('max-' + sku).value) || 1;
            queue.push({ action: 'edit', sku, min, max });
            refreshQueue();
          }
          
          async function applyQueue() {
            if (!queue.length) {
              alert('No actions to apply');
              return;
            }
            
            const summary = queueNeedsRestart()
              ? \`Apply \${queue.length} change(s) and restart bot?\\n\\nThis will:\\n- Execute all queued actions\\n- Restart your trading bot\\n- Update the pricelist\`
              : \`Apply \${queue.length} change(s)?\\n\\nThis will:\\n- Add item(s) to tracker watchlist\\n- NOT restart your trading bot\`;

            if (!confirm(summary)) {
              return;
            }

            const button = document.getElementById('apply-queue-btn');
            button.disabled = true;
            button.textContent = 'Processing...';
            const failures = [];
            
            try {
              for (let i = 0; i < queue.length; i++) {
                const q = queue[i];
                let url, body;

                if (q.action === 'add') {
                  url = '/bot/add';
                  body = \`sku=\${q.sku}&min=\${q.min}&max=\${q.max}\`;
                } else if (q.action === 'remove') {
                  url = '/bot/remove';
                  body = \`sku=\${q.sku}\`;
                } else if (q.action === 'edit') {
                  url = '/bot/edit';
                  body = \`sku=\${q.sku}&min=\${q.min}&max=\${q.max}\`;
                } else if (q.action === 'addName') {
                  url = '/add-item';
                  body = \`name=\${encodeURIComponent(q.name)}\`;
                }

                const resp = await fetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body
                });

                if (!resp.ok) {
                  let msg = '';
                  try { msg = (await resp.json()).error; } catch (e) { msg = ''; }
                  failures.push(msg || ('Failed: ' + (q.name || q.sku)));
                }
              }

              queue = [];
              refreshQueue();

              if (failures.length) {
                alert(failures.length + ' action(s) could not be applied:\\n\\n' + failures.join('\\n'));
              } else {
                alert('All actions applied successfully! Reloading...');
              }
              location.reload();
            } catch (error) {
              alert('Error applying actions: ' + error.message);
              button.disabled = false;
              updateApplyButton();
            }
          }
          
          function filterRows() {
            const s = document.getElementById('search').value.toLowerCase();
            const fNot = document.getElementById('filter-notinbot').checked;
            const f2h = document.getElementById('filter-2h').checked;
            const f1d = document.getElementById('filter-1d').checked;
            const f3d = document.getElementById('filter-3d').checked;
            
            let visibleCount = 0;
            document.querySelectorAll('tbody tr').forEach(function(row) {
              const name = (row.querySelector('.name')?.innerText || '').toLowerCase();
              const sku = (row.querySelector('.sku')?.innerText || '').toLowerCase();
              const inb = row.dataset.inbot === 'true';
              const age = parseInt(row.dataset.age) || 0;
              
              let ok = name.includes(s) || sku.includes(s);
              if (ok && fNot && inb) ok = false;
              if (ok && f2h && age < 3600 * 2) ok = false;
              if (ok && f1d && age < 3600 * 24) ok = false;
              if (ok && f3d && age < 3600 * 72) ok = false;
              
              row.style.display = ok ? '' : 'none';
              if (ok) visibleCount++;
            });
          }
          
          document.getElementById('search').addEventListener('input', filterRows);
          document.querySelectorAll('.filter').forEach(cb => cb.addEventListener('change', filterRows));
          refreshQueue();
          filterRows();
        </script>
      `;

      res.send(renderPage('Pricelist Status Dashboard', html));
    } catch (error) {
      console.error('Error in pricelist route:', error);
      let html = '<div style="max-width: 800px; margin: 40px auto; padding: 20px;">';
      html +=
        '<div class="ui-card" style="border-color: var(--danger); text-align: center;">';
      html += '<div style="font-size: 42px; margin-bottom: 12px;">⚠️</div>';
      html += '<h2 style="color: var(--danger-text); margin-bottom: 8px;">Error Loading Pricelist Data</h2>';
      html += `<p><strong>Error details:</strong> ${esc(error.message)}</p>`;
      html += '<p style="margin-bottom: 24px;">Please verify your bot configuration and try again.</p>';
      html +=
        '<a href="/bot-config" class="btn btn-primary">🤖 Check Bot Config</a>';
      html += '</div>';
      html += '</div>';
      res.status(500).send(renderPage('Pricelist Status - Error', html));
    }
  });
  app.use('/', router);
};
