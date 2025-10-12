const path = require('path');
const renderPage = require('../layout');
const { loadJson } = require('../utils');
const { db } = require('../dbInstance');
const { getBaseConfigManager } = require('../baseConfigManager');

module.exports = function (app, configManager) {
  app.get('/dashboard', async (req, res) => {
    try {
      // Load trade data from configured bot
      const selectedBot = configManager?.getSelectedBot();
      const pollDataPath = selectedBot?.polldataPath || path.resolve(__dirname, '../../polldata.json');
      let trades = [];
      try {
        const pollData = loadJson(pollDataPath);
        // polldata.json contains { offerData: {...} } - extract trades from offerData
        if (pollData && pollData.offerData) {
          // Filter for only accepted trades (same as P&L page)
          const allTrades = Object.values(pollData.offerData);
          
          // Get bot owner Steam IDs for exclusion from profit calculations
          let mainConfig = {};
          try {
            mainConfig = getBaseConfigManager().getConfig();
          } catch (error) {
            console.warn('Could not load main config.json for bot owner exclusion:', error.message);
          }
          
          const botOwnerSteamIDs = new Set(mainConfig.botOwnerSteamIDs || []);
          
          // Filter: only accepted trades, exclude bot owner trades
          trades = allTrades.filter((t) => {
            if (!t.isAccepted) return false;
            if (t.partner && botOwnerSteamIDs.has(t.partner)) return false;
            return true;
          });
        }
      } catch (error) {
        // Silent fail - dashboard works without trade data
        console.log('Could not load polldata.json:', error.message || error);
      }

      // Calculate 24-hour metrics
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

      const trades24h = Array.isArray(trades) ? trades.filter((trade) => trade.time * 1000 > oneDayAgo) : [];
      const trades7d = Array.isArray(trades) ? trades.filter((trade) => trade.time * 1000 > oneWeekAgo) : [];

      // Calculate profit/loss for recent trades
      let totalProfit24h = 0;
      let totalProfit7d = 0;
      let totalProfitAll = 0;

      // Get dynamic key price
      const Methods = require('../../methods');
      const methods = new Methods();
      const pricelistPath = selectedBot?.pricelistPath || path.resolve(__dirname, '../../pricelist.json');
      const keyPrice = await methods.getKeyPrice(pricelistPath);

      // Calculate profit using trade value structure (value.our vs value.their)
      trades24h.forEach((trade) => {
        const valueOur = trade.value?.our || { keys: 0, metal: 0 };
        const valueTheir = trade.value?.their || { keys: 0, metal: 0 };
        
        let ourTotalMetal, theirTotalMetal;
        if (valueOur.total !== undefined && valueTheir.total !== undefined) {
          ourTotalMetal = valueOur.total / 9; // Convert scrap to refined
          theirTotalMetal = valueTheir.total / 9;
        } else {
          ourTotalMetal = (valueOur.keys || 0) * keyPrice + (valueOur.metal || 0);
          theirTotalMetal = (valueTheir.keys || 0) * keyPrice + (valueTheir.metal || 0);
        }
        totalProfit24h += (theirTotalMetal - ourTotalMetal);
      });

      trades7d.forEach((trade) => {
        const valueOur = trade.value?.our || { keys: 0, metal: 0 };
        const valueTheir = trade.value?.their || { keys: 0, metal: 0 };
        
        let ourTotalMetal, theirTotalMetal;
        if (valueOur.total !== undefined && valueTheir.total !== undefined) {
          ourTotalMetal = valueOur.total / 9;
          theirTotalMetal = valueTheir.total / 9;
        } else {
          ourTotalMetal = (valueOur.keys || 0) * keyPrice + (valueOur.metal || 0);
          theirTotalMetal = (valueTheir.keys || 0) * keyPrice + (valueTheir.metal || 0);
        }
        totalProfit7d += (theirTotalMetal - ourTotalMetal);
      });

      trades.forEach((trade) => {
        const valueOur = trade.value?.our || { keys: 0, metal: 0 };
        const valueTheir = trade.value?.their || { keys: 0, metal: 0 };
        
        let ourTotalMetal, theirTotalMetal;
        if (valueOur.total !== undefined && valueTheir.total !== undefined) {
          ourTotalMetal = valueOur.total / 9;
          theirTotalMetal = valueTheir.total / 9;
        } else {
          ourTotalMetal = (valueOur.keys || 0) * keyPrice + (valueOur.metal || 0);
          theirTotalMetal = (valueTheir.keys || 0) * keyPrice + (valueTheir.metal || 0);
        }
        totalProfitAll += (theirTotalMetal - ourTotalMetal);
      });

      // Get key price data for health check
      let keyPriceHealth = 'Unknown';
      let lastKeyUpdate = 'Unknown';
      try {
        const keyData = await db.any(`
          SELECT timestamp, buy_price_metal, sell_price_metal, created_at
          FROM key_prices
          ORDER BY created_at DESC
          LIMIT 1
        `);
        if (keyData.length > 0) {
          const lastUpdate = new Date(keyData[0].created_at);
          const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
          keyPriceHealth =
            hoursSinceUpdate < 2 ? 'Healthy' : hoursSinceUpdate < 12 ? 'Warning' : 'Critical';
          lastKeyUpdate = lastUpdate.toLocaleString();
        }
      } catch (error) {
        console.log('Key price data not available');
      }

      // Calculate top traded items
      const itemCounts = {};
      trades24h.forEach((trade) => {
        if (trade.item && trade.item.name) {
          itemCounts[trade.item.name] = (itemCounts[trade.item.name] || 0) + 1;
        }
      });

      const topItems = Object.entries(itemCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5);

      // Build the dashboard HTML
      let html = '<div style="max-width: 1400px; margin: 0 auto; padding: 20px;">';

      // Header
      html +=
        '<div style="background: linear-gradient(135deg, #007cba 0%, #005a8b 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; text-align: center;">';
      html += '<h1 style="margin: 0 0 10px 0; font-size: 2.5em;">🚀 Trading Dashboard</h1>';
      html +=
        '<p style="margin: 0; font-size: 1.2em; opacity: 0.9;">Real-time overview of your trading bot performance</p>';
      html += '</div>';

      // Key Metrics Row
      html +=
        '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 30px;">';

      // 24h Profit Card
      const profit24hColor = totalProfit24h >= 0 ? '#28a745' : '#dc3545';
      const profit24hIcon = totalProfit24h >= 0 ? '📈' : '📉';
      html += `<div style="background: white; border: 1px solid #ddd; border-radius: 12px; padding: 25px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <div style="font-size: 2.5em; margin-bottom: 10px;">${profit24hIcon}</div>
        <h3 style="margin: 0 0 5px 0; color: #333;">24h Profit/Loss</h3>
        <div style="font-size: 2em; font-weight: bold; color: ${profit24hColor};">${totalProfit24h.toFixed(2)} ref</div>
        <p style="margin: 5px 0 0 0; color: #666; font-size: 0.9em;">Last 24 hours</p>
      </div>`;

      // 7d Profit Card
      const profit7dColor = totalProfit7d >= 0 ? '#28a745' : '#dc3545';
      const profit7dIcon = totalProfit7d >= 0 ? '📊' : '📉';
      html += `<div style="background: white; border: 1px solid #ddd; border-radius: 12px; padding: 25px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <div style="font-size: 2.5em; margin-bottom: 10px;">${profit7dIcon}</div>
        <h3 style="margin: 0 0 5px 0; color: #333;">7-Day Profit/Loss</h3>
        <div style="font-size: 2em; font-weight: bold; color: ${profit7dColor};">${totalProfit7d.toFixed(2)} ref</div>
        <p style="margin: 5px 0 0 0; color: #666; font-size: 0.9em;">Last 7 days</p>
      </div>`;

      // Total Trades Card
      html += `<div style="background: white; border: 1px solid #ddd; border-radius: 12px; padding: 25px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <div style="font-size: 2.5em; margin-bottom: 10px;">🔄</div>
        <h3 style="margin: 0 0 5px 0; color: #333;">24h Trades</h3>
        <div style="font-size: 2em; font-weight: bold; color: #007cba;">${trades24h.length}</div>
        <p style="margin: 5px 0 0 0; color: #666; font-size: 0.9em;">Total transactions</p>
      </div>`;

      // System Health Card
      const healthColor =
        keyPriceHealth === 'Healthy'
          ? '#28a745'
          : keyPriceHealth === 'Warning'
            ? '#ffc107'
            : '#dc3545';
      const healthIcon =
        keyPriceHealth === 'Healthy' ? '✅' : keyPriceHealth === 'Warning' ? '⚠️' : '❌';
      html += `<div style="background: white; border: 1px solid #ddd; border-radius: 12px; padding: 25px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <div style="font-size: 2.5em; margin-bottom: 10px;">${healthIcon}</div>
        <h3 style="margin: 0 0 5px 0; color: #333;">System Health</h3>
        <div style="font-size: 1.5em; font-weight: bold; color: ${healthColor};">${keyPriceHealth}</div>
        <p style="margin: 5px 0 0 0; color: #666; font-size: 0.9em;">Price data status</p>
      </div>`;

      html += '</div>';

      // Charts and Details Row
      html +=
        '<div style="display: grid; grid-template-columns: 2fr 1fr; gap: 30px; margin-bottom: 30px;">';

      // Profit Trend Chart (Simple)
      html +=
        '<div style="background: white; border: 1px solid #ddd; border-radius: 12px; padding: 25px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">';
      html += '<h3 style="margin: 0 0 20px 0; color: #333;">📈 Profit Trend Overview</h3>';

      // Simple profit breakdown
      const profitAllColor = totalProfitAll >= 0 ? '#28a745' : '#dc3545';
      html +=
        '<div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; text-align: center;">';
      html += `<div style="padding: 15px; background: #f8f9fa; border-radius: 8px;">
        <div style="font-size: 1.1em; font-weight: bold; color: #333;">All Time</div>
        <div style="font-size: 1.8em; font-weight: bold; color: ${profitAllColor}; margin-top: 5px;">${totalProfitAll.toFixed(2)} ref</div>
      </div>`;
      html += `<div style="padding: 15px; background: #f8f9fa; border-radius: 8px;">
        <div style="font-size: 1.1em; font-weight: bold; color: #333;">7 Days</div>
        <div style="font-size: 1.8em; font-weight: bold; color: ${profit7dColor}; margin-top: 5px;">${totalProfit7d.toFixed(2)} ref</div>
      </div>`;
      html += `<div style="padding: 15px; background: #f8f9fa; border-radius: 8px;">
        <div style="font-size: 1.1em; font-weight: bold; color: #333;">24 Hours</div>
        <div style="font-size: 1.8em; font-weight: bold; color: ${profit24hColor}; margin-top: 5px;">${totalProfit24h.toFixed(2)} ref</div>
      </div>`;
      html += '</div>';

      html +=
        '<div style="margin-top: 20px; padding: 15px; background: #e8f4fd; border-radius: 8px;">';
      html += '<p style="margin: 0; color: #007cba; font-weight: bold;">💡 Quick Stats:</p>';
      html +=
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; font-size: 0.9em;">';
      html += `<div>Total Trades: <strong>${trades.length}</strong></div>`;
      html += `<div>Avg per Trade: <strong>${trades.length > 0 ? (totalProfitAll / trades.length).toFixed(2) : '0.00'} ref</strong></div>`;
      html += `<div>7d Trade Volume: <strong>${trades7d.length}</strong></div>`;
      html += `<div>Key Data Updated: <strong>${lastKeyUpdate}</strong></div>`;
      html += '</div>';
      html += '</div>';

      html += '</div>';

      // Top Items Panel
      html +=
        '<div style="background: white; border: 1px solid #ddd; border-radius: 12px; padding: 25px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">';
      html += '<h3 style="margin: 0 0 20px 0; color: #333;">🔥 Top Items (24h)</h3>';

      if (topItems.length === 0) {
        html +=
          '<div style="text-align: center; color: #666; padding: 20px;">No trades in the last 24 hours</div>';
      } else {
        topItems.forEach(([itemName, count], index) => {
          const rank = index + 1;
          const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏅';
          html += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #eee;">
            <div style="display: flex; align-items: center;">
              <span style="font-size: 1.2em; margin-right: 10px;">${rankEmoji}</span>
              <span style="font-weight: bold;">${itemName}</span>
            </div>
            <span style="background: #007cba; color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.9em;">${count} trades</span>
          </div>`;
        });
      }

      html += '</div>';
      html += '</div>';

      // Quick Actions
      html +=
        '<div style="background: white; border: 1px solid #ddd; border-radius: 12px; padding: 25px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">';
      html += '<h3 style="margin: 0 0 20px 0; color: #333;">⚡ Quick Actions</h3>';
      html +=
        '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">';

      html +=
        '<a href="/pnl" style="background: #28a745; color: white; padding: 15px; border-radius: 8px; text-decoration: none; text-align: center; transition: all 0.2s;">';
      html += '<div style="font-size: 1.5em; margin-bottom: 5px;">💰</div>';
      html += '<div style="font-weight: bold;">P&L Analysis</div>';
      html += '</a>';

      html +=
        '<a href="/trades" style="background: #007cba; color: white; padding: 15px; border-radius: 8px; text-decoration: none; text-align: center; transition: all 0.2s;">';
      html += '<div style="font-size: 1.5em; margin-bottom: 5px;">📊</div>';
      html += '<div style="font-weight: bold;">Trade History</div>';
      html += '</a>';

      html +=
        '<a href="/key-prices" style="background: #fd7e14; color: white; padding: 15px; border-radius: 8px; text-decoration: none; text-align: center; transition: all 0.2s;">';
      html += '<div style="font-size: 1.5em; margin-bottom: 5px;">🔑</div>';
      html += '<div style="font-weight: bold;">Key Prices</div>';
      html += '</a>';

      html +=
        '<a href="/settings" style="background: #6c757d; color: white; padding: 15px; border-radius: 8px; text-decoration: none; text-align: center; transition: all 0.2s;">';
      html += '<div style="font-size: 1.5em; margin-bottom: 5px;">⚙️</div>';
      html += '<div style="font-weight: bold;">Settings</div>';
      html += '</a>';

      html +=
        '<a href="/bot-config" style="background: #17a2b8; color: white; padding: 15px; border-radius: 8px; text-decoration: none; text-align: center; transition: all 0.2s;">';
      html += '<div style="font-size: 1.5em; margin-bottom: 5px;">🤖</div>';
      html += '<div style="font-weight: bold;">Bot Config</div>';
      html += '</a>';

      html +=
        '<a href="/bounds" style="background: #dc3545; color: white; padding: 15px; border-radius: 8px; text-decoration: none; text-align: center; transition: all 0.2s;">';
      html += '<div style="font-size: 1.5em; margin-bottom: 5px;">⚖️</div>';
      html += '<div style="font-weight: bold;">Price Bounds</div>';
      html += '</a>';

      html += '</div>';
      html += '</div>';

      html += '</div>';

      res.send(renderPage('Dashboard', html));
    } catch (error) {
      console.error('Dashboard error:', error);
      res.status(500).send(renderPage('Error', '<div>Error loading dashboard</div>'));
    }
  });
};
