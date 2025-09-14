// routes/pnl.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const { loadJson } = require('../utils');
const renderPage = require('../layout');
const { getBaseConfigManager } = require('../baseConfigManager');

module.exports = function (app, config, configManager) {
  const router = express.Router();
  const baseConfig = getBaseConfigManager();

  // Helper function to get current bot paths
  function getBotPaths() {
    const selectedBot = configManager.getSelectedBot();
    if (!selectedBot) {
      throw new Error('No bot selected. Please configure a bot first.');
    }

    return {
      pollDataPath: path.resolve(
        selectedBot.tf2autobotPath+"/files/" || selectedBot.tf2AutobotDir+"/files/",
        selectedBot.botDirectory || selectedBot.botTradingDir,
        'polldata.json'
      ),
      pricelistPath: path.resolve(__dirname, '../../files/pricelist.json'),
    };
  }

  router.get('/pnl', (req, res) => {
    try {
      // Check if bot is configured
      const selectedBot = configManager.getSelectedBot();
      if (!selectedBot) {
        let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
        html +=
          '<div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; text-align: center;">';
        html += '<h2>⚠️ No Bot Configuration Found</h2>';
        html += '<p>You need to configure a bot before viewing profit and loss data.</p>';
        html += "<p>The P&L dashboard requires access to your bot's trade history files.</p>";
        html +=
          '<p><a href="/bot-config" style="background: #007cba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">🤖 Configure Bot</a></p>';
        html += '</div>';
        html += '</div>';
        return res.send(renderPage('P&L Dashboard - No Bot Configured', html));
      }

      const paths = getBotPaths();
      let keyPrice = loadJson(paths.pricelistPath).items.find((i) => i.sku === '5021;6')?.sell
        ?.metal;

      // Add safety check for key price
      if (!keyPrice || keyPrice <= 0 || keyPrice > 1000) {
        console.warn('Warning: Invalid key price detected:', keyPrice, 'defaulting to 52.22');
        // Use a reasonable default if key price is missing or seems wrong
        keyPrice = 52.22;
      }

      let parsed;
      try {
        const raw = fs.readFileSync(paths.pollDataPath, 'utf8');
        parsed = JSON.parse(raw);
      } catch {
        let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
        html +=
          '<div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 8px; text-align: center;">';
        html += '<h2>❌ Error Loading Trade Data</h2>';
        html += "<p>Unable to load trade history from the bot's polldata.json file.</p>";
        html += `<p><strong>Expected file location:</strong><br><code>${paths.pollDataPath}</code></p>`;
        html += '<p>This could indicate:</p>';
        html += '<ul style="text-align: left; display: inline-block;">';
        html += '<li>The bot has not processed any trades yet</li>';
        html += '<li>The polldata.json file is missing or corrupted</li>';
        html += '<li>Incorrect bot configuration paths</li>';
        html += '</ul>';
        html +=
          '<p><a href="/bot-config" style="background: #007cba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">🤖 Check Bot Config</a></p>';
        html += '</div>';
        html += '</div>';
        return res.status(500).send(renderPage('P&L Dashboard - Error', html));
      }

      const history = Object.values(parsed.offerData || {}).filter((t) => t.isAccepted);

      // Get bot owner Steam IDs from main config for exclusion from P&L calculations
      let mainConfig = {};
      try {
        mainConfig = baseConfig.getConfig();
      } catch (error) {
        console.warn('Could not load main config.json for bot owner exclusion:', error.message);
      }

      const botOwnerSteamIDs = new Set(mainConfig.botOwnerSteamIDs || []);
      console.log('Bot owner Steam IDs for P&L exclusion:', Array.from(botOwnerSteamIDs));

      // Filter out trades with bot owners (they can deposit/withdraw freely)
      const filteredHistory = history.filter((t) => {
        const partner = t.partner;
        if (partner && botOwnerSteamIDs.has(partner)) {
          console.log(`Excluding owner trade with ${partner} from P&L calculations`);
          return false;
        }
        return true;
      });

      console.log(
        `Total trades: ${history.length}, After owner exclusion: ${filteredHistory.length}`
      );

      const itemTransactions = {}; // Track individual item buy/sell transactions
      const summary = {}; // Final summary of profit/loss per item
      const profitPoints = [];
      let totalProfit = 0;

      // Sort history by timestamp ascending
      filteredHistory.sort((a, b) => {
        let ta = a.time || a.actionTimestamp || a.handleTimestamp;
        let tb = b.time || b.actionTimestamp || b.handleTimestamp;
        if (typeof ta === 'number' && ta < 1e12) {
          ta *= 1000;
        }
        if (typeof tb === 'number' && tb < 1e12) {
          tb *= 1000;
        }
        return (ta || 0) - (tb || 0);
      });

      let lastTimestamp = 0;
      for (const t of filteredHistory) {
        // Handle different timestamp fields
        let timestamp = t.time || t.actionTimestamp || t.handleTimestamp || Date.now();

        // timestamps appear to be in seconds
        if (typeof timestamp === 'number' && timestamp < 1e12) {
          timestamp *= 1000;
        }
        if (!timestamp || isNaN(timestamp)) {
          continue;
        } // skip if missing

        // Ensure strictly increasing timestamps
        if (timestamp <= lastTimestamp) {
          timestamp = lastTimestamp + 1;
        }
        lastTimestamp = timestamp;

        const date = new Date(timestamp);
        if (isNaN(date.getTime())) {
          continue;
        }

        const timeISO = date.toISOString();

        // Calculate total trade profit (for cumulative chart)
        const valueOur = t.value?.our || { keys: 0, metal: 0 };
        const valueTheir = t.value?.their || { keys: 0, metal: 0 };

        // Handle different value formats
        let ourTotalMetal, theirTotalMetal;
        if (valueOur.total !== undefined && valueTheir.total !== undefined) {
          // Convert from scrap to refined (9 scrap = 1 refined)
          ourTotalMetal = valueOur.total / 9;
          theirTotalMetal = valueTheir.total / 9;
        } else {
          // Fallback to keys + metal format
          ourTotalMetal = (valueOur.keys || 0) * keyPrice + (valueOur.metal || 0);
          theirTotalMetal = (valueTheir.keys || 0) * keyPrice + (valueTheir.metal || 0);
        }

        const tradeProfit = theirTotalMetal - ourTotalMetal;
        totalProfit += tradeProfit;

        profitPoints.push({ x: timeISO, y: parseFloat(totalProfit.toFixed(2)) });

        // Track individual item transactions with ACTUAL prices from trade data
        const itemsWeGave = t.dict?.our || {};
        const itemsWeReceived = t.dict?.their || {};
        const itemPrices = t.prices || {};

        // Currency SKUs to exclude from item analysis (these are currency, not tradeable items)
        const currencySkus = ['5021;6', '5002;6', '5001;6', '5000;6']; // Keys, Refined, Reclaimed, Scrap

        // Record SELL transactions (items we gave away)
        for (const [sku, qty] of Object.entries(itemsWeGave)) {
          // Skip currency items from item analysis
          if (currencySkus.includes(sku)) {
            continue;
          }

          if (!itemTransactions[sku]) {
            itemTransactions[sku] = { buys: [], sells: [], totalBought: 0, totalSold: 0 };
          }

          // Use ACTUAL sell price from trade data when available
          let sellPricePerItem = 0;
          if (itemPrices[sku]?.sell) {
            const sellPrice = itemPrices[sku].sell;
            sellPricePerItem = (sellPrice.keys || 0) * keyPrice + (sellPrice.metal || 0);
          } else {
            // If no individual price available, distribute trade value proportionally
            const ourItemCount = Object.values(itemsWeGave).reduce((sum, qty) => sum + qty, 0);
            sellPricePerItem = ourItemCount > 0 ? ourTotalMetal / ourItemCount : 0;
          }

          for (let i = 0; i < qty; i++) {
            itemTransactions[sku].sells.push({
              price: sellPricePerItem,
              timestamp: timestamp,
            });
            itemTransactions[sku].totalSold++;
          }
        }

        // Record BUY transactions (items we received)
        for (const [sku, qty] of Object.entries(itemsWeReceived)) {
          // Skip currency items from item analysis
          if (currencySkus.includes(sku)) {
            continue;
          }

          if (!itemTransactions[sku]) {
            itemTransactions[sku] = { buys: [], sells: [], totalBought: 0, totalSold: 0 };
          }

          // Use ACTUAL buy price from trade data when available
          let buyPricePerItem = 0;
          if (itemPrices[sku]?.buy) {
            const buyPrice = itemPrices[sku].buy;
            buyPricePerItem = (buyPrice.keys || 0) * keyPrice + (buyPrice.metal || 0);
          } else {
            // If no individual price available, distribute trade value proportionally
            const theirItemCount = Object.values(itemsWeReceived).reduce(
              (sum, qty) => sum + qty,
              0
            );
            buyPricePerItem = theirItemCount > 0 ? theirTotalMetal / theirItemCount : 0;
          }

          for (let i = 0; i < qty; i++) {
            itemTransactions[sku].buys.push({
              price: buyPricePerItem,
              timestamp: timestamp,
            });
            itemTransactions[sku].totalBought++;
          }
        }
      }

      // Calculate individual item profit/loss using FIFO (First In, First Out)
      for (const [sku, transactions] of Object.entries(itemTransactions)) {
        let totalItemProfit = 0;
        let soldCount = 0;
        let boughtCount = 0;

        // Sort transactions by timestamp
        const buyQueue = [...transactions.buys].sort((a, b) => a.timestamp - b.timestamp);
        const sellQueue = [...transactions.sells].sort((a, b) => a.timestamp - b.timestamp);

        // Process sells using FIFO - match each sell with the oldest available buy
        let buyIndex = 0;
        for (const sell of sellQueue) {
          if (buyIndex < buyQueue.length) {
            const buy = buyQueue[buyIndex];
            const itemProfit = sell.price - buy.price;
            totalItemProfit += itemProfit;
            soldCount++;
            buyIndex++;
          } else {
            // No matching buy found - this is a loss scenario where we sold something we didn't buy
            // In this case, we can't calculate profit properly for this item
            break;
          }
        }

        boughtCount = transactions.totalBought;
        const netQty = boughtCount - transactions.totalSold; // Use total sold, not just FIFO matched

        // Only include items that have meaningful transactions
        if (boughtCount > 0 || transactions.totalSold > 0) {
          summary[sku] = {
            qty: netQty,
            totalBought: boughtCount,
            totalSold: transactions.totalSold, // Use actual total sold
            profit: parseFloat(totalItemProfit.toFixed(2)), // This is only profit from FIFO matched items
            avgBuyPrice:
              buyQueue.length > 0
                ? buyQueue.reduce((sum, buy) => sum + buy.price, 0) / buyQueue.length
                : 0,
            avgSellPrice:
              sellQueue.length > 0
                ? sellQueue.reduce((sum, sell) => sum + sell.price, 0) / sellQueue.length
                : 0,
          };
        }
      }

      // Get all items sorted by absolute profit/loss impact
      const allItems = Object.entries(summary).sort(
        (a, b) => Math.abs(b[1].profit) - Math.abs(a[1].profit)
      );

      // Load pricelist for item names
      let pricelist = {};
      try {
        pricelist = loadJson(paths.pricelistPath);
        // Convert array format to object for easy lookup
        if (pricelist.items) {
          const pricelistObj = {};
          pricelist.items.forEach((item) => {
            pricelistObj[item.sku] = item;
          });
          pricelist = pricelistObj;
        }
      } catch (error) {
        console.warn('Could not load pricelist for item names:', error.message);
      }

      let html = '<div style="max-width: 1200px; margin: 0 auto; padding: 20px;">';

      // Header
      html +=
        '<div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px;">';
      html += '<h2>💰 Profit & Loss Dashboard</h2>';
      html +=
        '<p>Track your trading performance with detailed profit analysis and trend visualization.</p>';
      html += '</div>';

      // Summary Statistics
      html += '<div style="display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap;">';

      // Total Profit Card
      const profitColor = totalProfit >= 0 ? '#28a745' : '#dc3545';
      const profitIcon = totalProfit >= 0 ? '📈' : '📉';
      html +=
        '<div style="flex: 1; min-width: 250px; background: #e8f4fd; padding: 15px; border-radius: 8px;">';
      html += `<h3 style="color: ${profitColor}; margin-top: 0;">${profitIcon} Total Net Profit</h3>`;
      html += `<p style="font-size: 24px; font-weight: bold; color: ${profitColor}; margin: 10px 0;">${totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)} Refined</p>`;
      html += `<p><strong>Trades Analyzed:</strong> ${filteredHistory.length}</p>`;
      if (botOwnerSteamIDs.size > 0) {
        const excludedCount = history.length - filteredHistory.length;
        html += `<p><strong>Owner Trades Excluded:</strong> ${excludedCount}</p>`;
      }
      html += '</div>';

      // Key Price Card
      html +=
        '<div style="flex: 1; min-width: 250px; background: #fff3cd; padding: 15px; border-radius: 8px;">';
      html += '<h3 style="margin-top: 0;">🔑 Key Price Used</h3>';
      html += `<p style="font-size: 18px; font-weight: bold; margin: 10px 0;">${keyPrice ? keyPrice.toFixed(2) : 'N/A'} Refined</p>`;
      html += '<p>Used for profit calculations</p>';
      html += '</div>';

      // Summary stats
      const profitableItems = allItems.filter(([, data]) => data.profit > 0).length;
      const lossItems = allItems.filter(([, data]) => data.profit < 0).length;
      const totalItemsTraded = allItems.length;

      html += `
      <div style="display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap;">
        <div style="flex: 1; min-width: 150px; background: #e8f4fd; padding: 15px; border-radius: 8px; text-align: center;">
          <h4>Items Traded</h4>
          <p style="font-size: 20px; font-weight: bold;">${totalItemsTraded}</p>
        </div>
        <div style="flex: 1; min-width: 150px; background: #d4edda; padding: 15px; border-radius: 8px; text-align: center;">
          <h4>Profitable Items</h4>
          <p style="font-size: 20px; font-weight: bold; color: #28a745;">${profitableItems}</p>
        </div>
        <div style="flex: 1; min-width: 150px; background: #f8d7da; padding: 15px; border-radius: 8px; text-align: center;">
          <h4>Loss Items</h4>
          <p style="font-size: 20px; font-weight: bold; color: #dc3545;">${lossItems}</p>
        </div>
      </div>
      `;

      html += '</div>';

      // Chart Container
      html +=
        '<div style="background: white; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">';
      html += '<div style="background: #f8f9fa; padding: 15px; border-bottom: 1px solid #ddd;">';
      html += '<h3 style="margin: 0;">📊 Cumulative Profit Over Time</h3>';
      html +=
        '<p style="margin: 5px 0 0 0; color: #666;">Track your profit growth across all completed trades</p>';
      html += '</div>';
      html +=
        '<div class="chart-fullscreen" style="position: relative; height: 400px; padding: 20px;">';
      html += '<canvas id="profitOverTime" style="width: 100%; height: 100%;"></canvas>';
      html += '</div>';
      html += '</div>';

      // All Items Table - Updated to show detailed item analysis
      if (allItems.length > 0) {
        html +=
          '<div style="background: white; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">';
        html += '<div style="background: #f8f9fa; padding: 15px; border-bottom: 1px solid #ddd;">';
        html += '<h3 style="margin: 0;">📊 Complete Item Analysis</h3>';
        html +=
          '<p style="margin: 5px 0 0 0; color: #666;">Detailed profit/loss breakdown for all traded items</p>';
        html += '</div>';
        html += '<div style="padding: 20px; overflow-x: auto;">';
        html += '<table style="width: 100%; border-collapse: collapse; min-width: 800px;">';
        html += '<thead>';
        html += '<tr style="background: #f8f9fa;">';
        html +=
          '<th style="padding: 12px; text-align: left; border-bottom: 1px solid #ddd;">Item Name</th>';
        html +=
          '<th style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">Net Qty</th>';
        html +=
          '<th style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">Bought</th>';
        html +=
          '<th style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">Sold</th>';
        html +=
          '<th style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">Profit/Loss</th>';
        html +=
          '<th style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">Avg Buy Price</th>';
        html +=
          '<th style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">Avg Sell Price</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';

        allItems.forEach(([sku, data], index) => {
          const itemName = (pricelist[sku] && pricelist[sku].name) || sku;
          const rowStyle = index % 2 === 0 ? 'background: #f9f9f9;' : '';
          const profitColor = data.profit >= 0 ? '#28a745' : '#dc3545';
          html += `<tr style="${rowStyle}">`;
          html += `<td style="padding: 12px; border-bottom: 1px solid #eee; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${itemName}">${itemName}</td>`;
          html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #eee;">${data.qty}</td>`;
          html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #eee;">${data.totalBought || 0}</td>`;
          html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #eee;">${data.totalSold || 0}</td>`;
          html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #eee; color: ${profitColor}; font-weight: bold;">${data.profit >= 0 ? '+' : ''}${data.profit.toFixed(2)} Ref</td>`;
          html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #eee;">${(data.avgBuyPrice || 0).toFixed(3)} Ref</td>`;
          html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #eee;">${(data.avgSellPrice || 0).toFixed(3)} Ref</td>`;
          html += '</tr>';
        });

        html += '</tbody>';
        html += '</table>';
        html += '</div>';
        html += '</div>';
      }

      html += '</div>';

      // Chart.js scripts
      html += `
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/luxon@3.4.3/build/global/luxon.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-luxon@1.3.1/dist/chartjs-adapter-luxon.umd.min.js"></script>

        <script>
          const ctxProfit = document.getElementById('profitOverTime').getContext('2d');
          new Chart(ctxProfit, {
            type: 'line',
            data: {
              datasets: [{
                label: 'Cumulative Profit (Refined Metal)',
                data: ${JSON.stringify(profitPoints)},
                borderColor: '${totalProfit >= 0 ? '#28a745' : '#dc3545'}',
                backgroundColor: '${totalProfit >= 0 ? 'rgba(40, 167, 69, 0.1)' : 'rgba(220, 53, 69, 0.1)'}',
                fill: true,
                parsing: {
                  xAxisKey: 'x',
                  yAxisKey: 'y'
                },
                tension: 0.2,
                pointBackgroundColor: '${totalProfit >= 0 ? '#28a745' : '#dc3545'}',
                pointBorderColor: '#fff',
                pointBorderWidth: 2
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: {
                  type: 'time',
                  time: { unit: 'day' },
                  title: { 
                    display: true, 
                    text: 'Date',
                    font: { weight: 'bold' }
                  }
                },
                y: {
                  title: { 
                    display: true, 
                    text: 'Cumulative Profit (Refined Metal)',
                    font: { weight: 'bold' }
                  }
                }
              },
              plugins: {
                legend: { 
                  display: true, 
                  position: 'top' 
                },
                title: {
                  display: true,
                  text: 'Profit Growth Over Time',
                  font: {
                    size: 16,
                    weight: 'bold'
                  }
                }
              },
              interaction: {
                intersect: false,
                mode: 'index'
              }
            }
          });
        </script>
      `;

      res.send(renderPage('Profit & Loss Dashboard', html));
    } catch (error) {
      console.error('Error in PnL route:', error);
      let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
      html +=
        '<div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 8px; text-align: center;">';
      html += '<h2>⚠️ Error Loading P&L Data</h2>';
      html += '<p>There was an error loading the profit and loss data.</p>';
      html += `<p><strong>Error details:</strong> ${error.message}</p>`;
      html += '<p>Please check that your bot configuration is correct and try again.</p>';
      html +=
        '<p><a href="/bot-config" style="background: #007cba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">🤖 Check Bot Config</a></p>';
      html += '</div>';
      html += '</div>';
      res.status(500).send(renderPage('P&L Dashboard - Error', html));
    }
  });

  app.use('/', router);
};
