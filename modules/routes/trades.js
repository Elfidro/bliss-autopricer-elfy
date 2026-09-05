const path = require('path');
const fs = require('fs');
const renderPage = require('../layout');
const Methods = require('../../methods');
const methods = new Methods();

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = function (app, config, configManager) {
  app.get('/trades', async (req, res) => {
    try {
      const selectedBot = configManager.getSelectedBot();
      if (!selectedBot) {
        let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
        html +=
          '<div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; text-align: center;">';
        html += '<h2>⚠️ No Bot Configuration Found</h2>';
        html += '<p>You need to configure a bot before viewing trade history.</p>';
        html += "<p>Trade history data comes from your bot's polldata.json file.</p>";
        html +=
          '<p><a href="/bot-config" style="background: #007cba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">🤖 Configure Bot</a></p>';
        html += '</div>';
        html += '</div>';
        return res.send(renderPage('Trade History - No Bot Configured', html));
      }

      const pollDataPath = selectedBot.polldataPath || '';
      const pricelistPath = selectedBot.pricelistPath || path.resolve(__dirname, '../../files/pricelist.json');
      
      // Get key price with PriceDB.io fallback
      const keyPrice = await methods.getKeyPrice(pricelistPath);
      
      let pricelist = { items: [] };
      try {
        pricelist = loadJson(pricelistPath);
      } catch (error) {
        console.warn('Could not load pricelist, using empty pricelist:', error.message || error);
      }

      const currencyMap = {
        '5000;6': 'Scrap Metal',
        '5001;6': 'Reclaimed Metal',
        '5002;6': 'Refined Metal',
        '5021;6': 'Mann Co. Supply Crate Key',
      };
      const skuToName = {
        ...currencyMap,
        ...(pricelist && pricelist.items ? Object.fromEntries(pricelist.items.map((item) => [item.sku, item.name])) : {}),
      };

      let trades = [];
      let cumulativeProfit = 0;
      try {
        const raw = fs.readFileSync(pollDataPath, 'utf8');
        const parsed = JSON.parse(raw);
        const data = parsed.offerData;

        trades = Object.entries(data)
          .map(([id, trade]) => {
            const accepted = trade.action?.action === 'accept' || trade.isAccepted;
            const profileUrl = trade.partner
              ? `https://steamcommunity.com/profiles/${trade.partner}`
              : '#';
            const name = trade.partner || 'Unknown';
            const timeRaw = trade.time || trade.actionTimestamp || Date.now();
            const timestamp = timeRaw > 2000000000 ? new Date(timeRaw) : new Date(timeRaw * 1000);
            const time = timestamp.toLocaleString();

            const itemsOur = trade.dict?.our || {};
            const itemsTheir = trade.dict?.their || {};
            const valueOur = trade.value?.our || { keys: 0, metal: 0 };
            const valueTheir = trade.value?.their || { keys: 0, metal: 0 };

            const metalOut = valueOur.keys * keyPrice + valueOur.metal;
            const metalIn = valueTheir.keys * keyPrice + valueTheir.metal;
            const profit = metalIn - metalOut;

            if (accepted) {
              cumulativeProfit += profit;
            }

            const statusFlags = [];
            if (trade.isAccepted) {
              statusFlags.push('✅ Accepted');
            }
            if (trade.isDeclined) {
              statusFlags.push('❌ Declined');
            }
            if (trade.isInvalid) {
              statusFlags.push('⚠️ Invalid');
            }
            if (trade.action?.action?.toLowerCase().includes('counter')) {
              statusFlags.push('↩️ Countered');
            }
            if (trade.action?.action === 'skip') {
              statusFlags.push('⏭️ Skipped');
            }

            return {
              id,
              profileUrl,
              name,
              time,
              timestamp: timestamp.getTime(),
              accepted,
              itemsOur,
              itemsTheir,
              valueOur,
              valueTheir,
              profit,
              action: trade.action?.action || 'unknown',
              reason: trade.action?.reason || '',
              status: statusFlags.join('<br>') || '⚠️ Unmarked',
            };
          })
          .sort((a, b) => b.timestamp - a.timestamp);
      } catch (e) {
        console.error('Error loading polldata:', e);
        let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
        html +=
          '<div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 8px; text-align: center;">';
        html += '<h2>❌ Error Loading Trade History</h2>';
        html += '<p>Failed to load trade history from polldata.json</p>';
        html += `<p><strong>File path:</strong><br><code>${pollDataPath}</code></p>`;
        html += `<p><strong>Error:</strong> ${e.message}</p>`;
        html +=
          '<p><a href="/bot-config" style="background: #007cba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">🤖 Check Bot Config</a></p>';
        html += '</div>';
        html += '</div>';
        return res.status(500).send(renderPage('Trade History - Error', html));
      }

      let html = '<div style="max-width: 1560px; margin: 0 auto;">';

      // Header
      html += `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
          <div>
            <h1 style="font-size: 1.9rem; font-weight: 800; margin-bottom: 6px; display: flex; align-items: center; gap: 12px;">
              <span>📊</span> Trade History Dashboard
            </h1>
            <p style="margin: 0; font-size: 0.95rem; color: var(--text-muted);">
              Comprehensive audit log of all trade proposals, counterparties, and profit calculations processed by your bot.
            </p>
          </div>
          <div style="display: flex; gap: 10px;">
            <a href="/pnl" class="btn btn-secondary"><span>📈</span> P&L Analysis</a>
            <a href="/bot-config" class="btn btn-secondary"><span>🤖</span> Bot Config</a>
          </div>
        </div>
      `;

      // Summary Statistics Grid
      const acceptedTrades = trades.filter((t) => t.accepted).length;
      const profitCardClass = cumulativeProfit >= 0 ? 'stat-ok' : 'stat-danger';
      const profitIcon = cumulativeProfit >= 0 ? '📈' : '📉';

      html += `
        <div class="stats-grid">
          <div class="stat-card stat-info">
            <div class="stat-top">
              <span class="stat-title">Total Processed</span>
              <div class="stat-icon-wrapper">🔄</div>
            </div>
            <div class="stat-value">${trades.length}</div>
            <p class="stat-desc">Lifetime trade offers recorded</p>
          </div>

          <div class="stat-card stat-ok">
            <div class="stat-top">
              <span class="stat-title">Accepted Trades</span>
              <div class="stat-icon-wrapper">✅</div>
            </div>
            <div class="stat-value">${acceptedTrades}</div>
            <p class="stat-desc">${trades.length > 0 ? ((acceptedTrades / trades.length) * 100).toFixed(1) : 0}% successful acceptance rate</p>
          </div>

          <div class="stat-card ${profitCardClass}">
            <div class="stat-top">
              <span class="stat-title">Cumulative Net Profit</span>
              <div class="stat-icon-wrapper">${profitIcon}</div>
            </div>
            <div class="stat-value">${cumulativeProfit >= 0 ? '+' : ''}${cumulativeProfit.toFixed(2)} ref</div>
            <p class="stat-desc">From completed trades</p>
          </div>

          <div class="stat-card stat-warn">
            <div class="stat-top">
              <span class="stat-title">Current Key Valuation</span>
              <div class="stat-icon-wrapper">🔑</div>
            </div>
            <div class="stat-value">${keyPrice.toFixed(2)} ref</div>
            <p class="stat-desc">Applied to key trade values</p>
          </div>
        </div>
      `;

      // Filter Controls
      html += `
        <div class="ui-card" style="padding: 16px 20px; margin-bottom: 24px;">
          <div style="display: flex; gap: 14px; align-items: center; flex-wrap: wrap;">
            <span style="font-weight: 700; font-size: 0.9rem; color: var(--text);">Filter by Status:</span>
            <select id="statusFilter" onchange="filterTrades()" style="min-width: 200px;">
              <option value="">All Statuses</option>
              <option value="accept">✅ Accepted</option>
              <option value="decline">❌ Declined</option>
              <option value="counter">↩️ Countered</option>
              <option value="skip">⏭️ Skipped</option>
              <option value="invalid">⚠️ Invalid</option>
            </select>
          </div>
        </div>
      `;

      // Trades Table Container
      html += `
        <div class="table-container">
          <div class="table-header-bar">
            <div>
              <h3 style="margin: 0;"><span>📋</span> Trade Audit Log</h3>
              <p style="margin: 4px 0 0 0; color: var(--text-muted);">Trade ID links navigate directly to counterparty Steam profiles</p>
            </div>
          </div>
      `;

      if (trades.length === 0) {
        html += `
          <div style="padding: 48px 24px; text-align: center;">
            <div style="font-size: 36px; margin-bottom: 12px;">📭</div>
            <h4 style="margin: 0 0 8px 0; font-size: 1.1rem;">No Trades Found</h4>
            <p style="color: var(--text-muted); margin: 0;">No trade history has been logged in polldata.json yet.</p>
          </div>
        `;
      } else {
        html += `
          <div style="overflow-x: auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 14%;">Trade / Partner</th>
                  <th style="width: 12%; text-align: center;">Timestamp</th>
                  <th style="width: 26%;">Items Sent (Out)</th>
                  <th style="width: 26%;">Items Received (In)</th>
                  <th style="width: 10%; text-align: center;">Action</th>
                  <th style="width: 12%; text-align: center;">Profit / Loss</th>
                </tr>
              </thead>
              <tbody>
        `;

        trades.forEach((t) => {
          html += `<tr data-status="${t.action}">`;

          // Trade Info
          html += `<td style="vertical-align: top;">`;
          html += `<a href="${t.profileUrl}" target="_blank" rel="noopener noreferrer" style="font-weight: 700; font-family: var(--font-mono); font-size: 0.88rem;">${t.id} <span style="font-size: 10px; opacity: 0.6;">↗</span></a><br>`;
          html += `<small style="color: var(--text-dim); font-size: 0.8rem;">${t.name}</small>`;
          html += '</td>';

          // Timestamp
          html += `<td style="text-align: center; vertical-align: top; font-size: 0.84rem; color: var(--text-muted);">`;
          html += `${t.time}`;
          html += '</td>';

          // Items Sent
          html += `<td style="vertical-align: top;">`;
          const sentItems =
            Object.entries(t.itemsOur)
              .map(([sku, qty]) => `<span style="display: inline-block; margin-bottom: 3px;"><strong>${qty}×</strong> ${skuToName[sku] || 'Unknown'} <code class="sku-badge">${sku}</code></span>`)
              .join('<br>') || '<span style="color: var(--text-dim); font-style: italic;">Nothing sent</span>';
          html += `<div style="font-size: 0.88rem;">${sentItems}</div>`;
          html += `<div style="margin-top: 6px; font-size: 0.8rem; color: var(--text-muted);">Value: <strong>${t.valueOur.keys}</strong> Keys, <strong>${Number(t.valueOur.metal || 0).toFixed(2)}</strong> Ref</div>`;
          html += '</td>';

          // Items Received
          html += `<td style="vertical-align: top;">`;
          const receivedItems =
            Object.entries(t.itemsTheir)
              .map(([sku, qty]) => `<span style="display: inline-block; margin-bottom: 3px;"><strong>${qty}×</strong> ${skuToName[sku] || 'Unknown'} <code class="sku-badge">${sku}</code></span>`)
              .join('<br>') || '<span style="color: var(--text-dim); font-style: italic;">Nothing received</span>';
          html += `<div style="font-size: 0.88rem;">${receivedItems}</div>`;
          html += `<div style="margin-top: 6px; font-size: 0.8rem; color: var(--text-muted);">Value: <strong>${t.valueTheir.keys}</strong> Keys, <strong>${Number(t.valueTheir.metal || 0).toFixed(2)}</strong> Ref</div>`;
          html += '</td>';

          // Action & Status
          html += `<td style="text-align: center; vertical-align: top;">`;
          if (t.accepted) {
            html += `<span class="badge badge-ok">✅ Accepted</span>`;
          } else if (t.action.includes('decline')) {
            html += `<span class="badge badge-danger">❌ Declined</span>`;
          } else if (t.action.includes('counter')) {
            html += `<span class="badge badge-warn">↩️ Countered</span>`;
          } else {
            html += `<span class="badge badge-muted">${t.action}</span>`;
          }
          if (t.reason) {
            html += `<div style="margin-top: 4px; font-size: 0.78rem; color: var(--text-dim);">${t.reason}</div>`;
          }
          html += '</td>';

          // Profit
          html += `<td style="text-align: center; vertical-align: top;">`;
          if (t.accepted) {
            if (t.profit > 0) {
              html += `<span class="price-tag price-buy">+${t.profit.toFixed(2)} Ref</span>`;
            } else if (t.profit < 0) {
              html += `<span class="price-tag price-sell">${t.profit.toFixed(2)} Ref</span>`;
            } else {
              html += `<span class="badge badge-muted">0.00 Ref</span>`;
            }
          } else {
            html += '<span style="color: var(--text-dim); font-family: var(--font-mono);">—</span>';
          }
          html += '</td>';

          html += '</tr>';
        });

        html += `
              </tbody>
            </table>
          </div>
        `;
      }

      html += '</div></div>';

      // JavaScript for filtering
      html += `
        <script>
          function filterTrades() {
            const filter = document.getElementById('statusFilter').value.toLowerCase();
            const rows = document.querySelectorAll('tbody tr');
            
            rows.forEach(row => {
              const status = (row.dataset.status || '').toLowerCase();
              const shouldShow = !filter || status.includes(filter);
              row.style.display = shouldShow ? '' : 'none';
            });
          }
        </script>
      `;

      res.send(renderPage('Trade History Dashboard', html));
    } catch (error) {
      console.error('Error loading trade history:', error);
      let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
      html +=
        '<div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 8px; text-align: center;">';
      html += '<h2>❌ Unexpected Error</h2>';
      html += '<p>An unexpected error occurred while loading the trade history.</p>';
      html += `<p><strong>Error:</strong> ${error.message}</p>`;
      html +=
        '<p><a href="/bot-config" style="background: #007cba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">🤖 Check Bot Configuration</a></p>';
      html += '</div>';
      html += '</div>';
      res.send(renderPage('Trade History - Error', html));
    }
  });
};
