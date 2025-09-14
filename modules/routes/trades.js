const path = require('path');
const fs = require('fs');
const renderPage = require('../layout');

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = function (app, config, configManager) {
  app.get('/trades', (req, res) => {
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

      const pollDataPath = path.resolve(
        selectedBot.tf2autobotPath+"/files/" || selectedBot.tf2AutobotDir+"/files/",
        selectedBot.botDirectory || selectedBot.botTradingDir,
        'polldata.json'
      );
      const pricelistPath = path.resolve(__dirname, '../../files/pricelist.json');
      const pricelist = loadJson(pricelistPath);
      const keyPrice = pricelist.items.find((i) => i.sku === '5021;6')?.sell?.metal || 68.11;

      const currencyMap = {
        '5000;6': 'Scrap Metal',
        '5001;6': 'Reclaimed Metal',
        '5002;6': 'Refined Metal',
        '5021;6': 'Mann Co. Supply Crate Key',
      };
      const skuToName = {
        ...currencyMap,
        ...Object.fromEntries(pricelist.items.map((item) => [item.sku, item.name])),
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

      let html = '<div style="max-width: 1200px; margin: 0 auto; padding: 20px;">';

      // Header
      html +=
        '<div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px;">';
      html += '<h2>📊 Trade History Dashboard</h2>';
      html += '<p>Complete history of all trade offers processed by your trading bot.</p>';
      html += '</div>';

      // Summary Statistics
      html += '<div style="display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap;">';

      // Total Trades Card
      html +=
        '<div style="flex: 1; min-width: 200px; background: #e8f4fd; padding: 15px; border-radius: 8px;">';
      html += '<h3 style="margin-top: 0;">📈 Total Trades</h3>';
      html += `<p style="font-size: 24px; font-weight: bold; margin: 10px 0;">${trades.length}</p>`;
      html += '<p>All processed offers</p>';
      html += '</div>';

      // Accepted Trades Card
      const acceptedTrades = trades.filter((t) => t.accepted).length;
      html +=
        '<div style="flex: 1; min-width: 200px; background: #d4edda; padding: 15px; border-radius: 8px;">';
      html += '<h3 style="color: #28a745; margin-top: 0;">✅ Accepted</h3>';
      html += `<p style="font-size: 24px; font-weight: bold; color: #28a745; margin: 10px 0;">${acceptedTrades}</p>`;
      html += `<p>${trades.length > 0 ? ((acceptedTrades / trades.length) * 100).toFixed(1) : 0}% acceptance rate</p>`;
      html += '</div>';

      // Cumulative Profit Card
      const profitColor = cumulativeProfit >= 0 ? '#28a745' : '#dc3545';
      const profitIcon = cumulativeProfit >= 0 ? '📈' : '📉';
      html +=
        '<div style="flex: 1; min-width: 200px; background: #fff3cd; padding: 15px; border-radius: 8px;">';
      html += `<h3 style="color: ${profitColor}; margin-top: 0;">${profitIcon} Net Profit</h3>`;
      html += `<p style="font-size: 20px; font-weight: bold; color: ${profitColor}; margin: 10px 0;">${cumulativeProfit >= 0 ? '+' : ''}${cumulativeProfit.toFixed(2)} Ref</p>`;
      html += '<p>From accepted trades</p>';
      html += '</div>';

      html += '</div>';

      // Filter Controls
      html +=
        '<div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px;">';
      html += '<h3 style="margin-top: 0;">🔍 Filter Trades</h3>';
      html += '<div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">';
      html += '<label for="statusFilter" style="font-weight: bold;">Status:</label>';
      html +=
        '<select id="statusFilter" onchange="filterTrades()" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;">';
      html += '<option value="">All Statuses</option>';
      html += '<option value="accept">✅ Accepted</option>';
      html += '<option value="decline">❌ Declined</option>';
      html += '<option value="counter">↩️ Countered</option>';
      html += '<option value="skip">⏭️ Skipped</option>';
      html += '<option value="invalid">⚠️ Invalid</option>';
      html += '</select>';
      html += '</div>';
      html += '</div>';

      // Trades Table
      html +=
        '<div style="background: white; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">';
      html += '<div style="background: #f8f9fa; padding: 15px; border-bottom: 1px solid #ddd;">';
      html += '<h3 style="margin: 0;">📋 Trade History</h3>';
      html +=
        '<p style="margin: 5px 0 0 0; color: #666;">Click on trade IDs to view Steam profiles</p>';
      html += '</div>';

      if (trades.length === 0) {
        html += '<div style="padding: 40px; text-align: center;">';
        html += '<h4>📭 No Trades Found</h4>';
        html += '<p>No trade history available. This could mean:</p>';
        html += '<ul style="text-align: left; display: inline-block;">';
        html += "<li>The bot hasn't processed any trades yet</li>";
        html += '<li>The polldata.json file is empty or missing</li>';
        html += '<li>Trade history has been cleared</li>';
        html += '</ul>';
        html += '</div>';
      } else {
        html += '<div style="overflow-x: auto;">';
        html += '<table style="width: 100%; border-collapse: collapse; min-width: 800px;">';
        html += '<thead style="background: #f8f9fa;">';
        html += '<tr>';
        html +=
          '<th style="padding: 12px; text-align: left; border-bottom: 1px solid #ddd; min-width: 120px;">Trade Info</th>';
        html +=
          '<th style="padding: 12px; text-align: left; border-bottom: 1px solid #ddd; min-width: 140px;">Timestamp</th>';
        html +=
          '<th style="padding: 12px; text-align: left; border-bottom: 1px solid #ddd; min-width: 200px;">Items Sent</th>';
        html +=
          '<th style="padding: 12px; text-align: left; border-bottom: 1px solid #ddd; min-width: 200px;">Items Received</th>';
        html +=
          '<th style="padding: 12px; text-align: left; border-bottom: 1px solid #ddd; min-width: 100px;">Action</th>';
        html +=
          '<th style="padding: 12px; text-align: left; border-bottom: 1px solid #ddd; min-width: 100px;">Status</th>';
        html +=
          '<th style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd; min-width: 100px;">Profit</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        trades.forEach((t, index) => {
          const rowStyle = index % 2 === 0 ? 'background: #f9f9f9;' : '';
          const profitStyle =
            t.profit > 0 ? 'color: #28a745;' : t.profit < 0 ? 'color: #dc3545;' : 'color: #6c757d;';

          html += `<tr data-status="${t.action}" style="${rowStyle}">`;

          // Trade Info
          html += `<td style="padding: 12px; border-bottom: 1px solid #eee; vertical-align: top;">`;
          html += `<a href="${t.profileUrl}" target="_blank" style="color: #007cba; text-decoration: none; font-weight: bold;">${t.id}</a><br>`;
          html += `<small style="color: #666;">${t.name}</small>`;
          html += '</td>';

          // Timestamp
          html += `<td style="padding: 12px; border-bottom: 1px solid #eee; vertical-align: top;">`;
          html += `<small>${t.time}</small>`;
          html += '</td>';

          // Items Sent
          html += `<td style="padding: 12px; border-bottom: 1px solid #eee; vertical-align: top;">`;
          const sentItems =
            Object.entries(t.itemsOur)
              .map(([sku, qty]) => `${qty}× ${skuToName[sku] || 'Unknown'} <small>(${sku})</small>`)
              .join('<br>') || '<em>Nothing sent</em>';
          html += `<div style="margin-bottom: 5px;">${sentItems}</div>`;
          html += `<small style="color: #666;"><strong>Value:</strong> ${t.valueOur.keys} Keys, ${t.valueOur.metal} Ref</small>`;
          html += '</td>';

          // Items Received
          html += `<td style="padding: 12px; border-bottom: 1px solid #eee; vertical-align: top;">`;
          const receivedItems =
            Object.entries(t.itemsTheir)
              .map(([sku, qty]) => `${qty}× ${skuToName[sku] || 'Unknown'} <small>(${sku})</small>`)
              .join('<br>') || '<em>Nothing received</em>';
          html += `<div style="margin-bottom: 5px;">${receivedItems}</div>`;
          html += `<small style="color: #666;"><strong>Value:</strong> ${t.valueTheir.keys} Keys, ${t.valueTheir.metal} Ref</small>`;
          html += '</td>';

          // Action
          html += `<td style="padding: 12px; border-bottom: 1px solid #eee; vertical-align: top;">`;
          html += `<strong>${t.action}</strong>`;
          if (t.reason) {
            html += `<br><small style="color: #666;">${t.reason}</small>`;
          }
          html += '</td>';

          // Status
          html += `<td style="padding: 12px; border-bottom: 1px solid #eee; vertical-align: top;">`;
          html += t.status;
          html += '</td>';

          // Profit
          html += `<td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center; vertical-align: top; ${profitStyle}">`;
          html += t.accepted ? `${t.profit > 0 ? '+' : ''}${t.profit.toFixed(2)} Ref` : '—';
          html += '</td>';

          html += '</tr>';
        });

        html += '</tbody>';
        html += '</table>';
        html += '</div>';
      }

      html += '</div>';
      html += '</div>';

      // JavaScript for filtering
      html += `
        <script>
          function filterTrades() {
            const filter = document.getElementById('statusFilter').value.toLowerCase();
            const rows = document.querySelectorAll('tbody tr');
            
            rows.forEach(row => {
              const status = row.dataset.status.toLowerCase();
              const shouldShow = !filter || status.includes(filter);
              row.style.display = shouldShow ? '' : 'none';
            });
            
            // Update visible count
            const visibleRows = Array.from(rows).filter(row => row.style.display !== 'none').length;
            console.log(\`Showing \${visibleRows} of \${rows.length} trades\`);
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
