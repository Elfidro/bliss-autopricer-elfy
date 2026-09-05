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
        if (pollData && pollData.offerData) {
          const allTrades = Object.values(pollData.offerData);
          
          let mainConfig = {};
          try {
            mainConfig = getBaseConfigManager().getConfig();
          } catch (error) {
            console.warn('Could not load main config.json for bot owner exclusion:', error.message);
          }
          
          const botOwnerSteamIDs = new Set(mainConfig.botOwnerSteamIDs || []);
          
          trades = allTrades.filter((t) => {
            if (!t.isAccepted) return false;
            if (t.partner && botOwnerSteamIDs.has(t.partner)) return false;
            return true;
          });
        }
      } catch (error) {
        console.log('Could not load polldata.json:', error.message || error);
      }

      // Calculate 24-hour metrics
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

      const trades24h = Array.isArray(trades) ? trades.filter((trade) => trade.time * 1000 > oneDayAgo) : [];
      const trades7d = Array.isArray(trades) ? trades.filter((trade) => trade.time * 1000 > oneWeekAgo) : [];

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
          ourTotalMetal = valueOur.total / 9;
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

      // Build modern dashboard HTML
      let html = '<div style="max-width: 1560px; margin: 0 auto;">';

      // Page Header
      html += `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
          <div>
            <h1 style="font-size: 1.9rem; font-weight: 800; margin-bottom: 6px; display: flex; align-items: center; gap: 12px;">
              <span>🚀</span> Trading Dashboard
            </h1>
            <p style="margin: 0; font-size: 0.95rem; color: var(--text-muted);">
              Real-time telemetry, automated trade volume, and bot operational health overview.
            </p>
          </div>
          <div style="display: flex; gap: 10px;">
            <a href="/pnl" class="btn btn-primary"><span>📈</span> View Detailed P&L</a>
            <a href="/trades" class="btn btn-secondary"><span>📊</span> Trade History</a>
          </div>
        </div>
      `;

      // Key Metrics Row (Modern Stats Grid)
      const profit24hCardClass = totalProfit24h >= 0 ? 'stat-ok' : 'stat-danger';
      const profit24hIcon = totalProfit24h >= 0 ? '📈' : '📉';

      const profit7dCardClass = totalProfit7d >= 0 ? 'stat-ok' : 'stat-danger';
      const profit7dIcon = totalProfit7d >= 0 ? '📊' : '📉';

      const healthCardClass = keyPriceHealth === 'Healthy' ? 'stat-ok' : keyPriceHealth === 'Warning' ? 'stat-warn' : 'stat-danger';
      const healthIcon = keyPriceHealth === 'Healthy' ? '✅' : keyPriceHealth === 'Warning' ? '⚠️' : '❌';

      html += `
        <div class="stats-grid">
          <div class="stat-card ${profit24hCardClass}">
            <div class="stat-top">
              <span class="stat-title">24h Profit / Loss</span>
              <div class="stat-icon-wrapper">${profit24hIcon}</div>
            </div>
            <div class="stat-value">${totalProfit24h >= 0 ? '+' : ''}${totalProfit24h.toFixed(2)} ref</div>
            <p class="stat-desc">Calculated across last 24 hours</p>
          </div>

          <div class="stat-card ${profit7dCardClass}">
            <div class="stat-top">
              <span class="stat-title">7-Day Profit / Loss</span>
              <div class="stat-icon-wrapper">${profit7dIcon}</div>
            </div>
            <div class="stat-value">${totalProfit7d >= 0 ? '+' : ''}${totalProfit7d.toFixed(2)} ref</div>
            <p class="stat-desc">Cumulative rolling 7 days</p>
          </div>

          <div class="stat-card stat-info">
            <div class="stat-top">
              <span class="stat-title">24h Transactions</span>
              <div class="stat-icon-wrapper">🔄</div>
            </div>
            <div class="stat-value">${trades24h.length}</div>
            <p class="stat-desc">Accepted customer trades</p>
          </div>

          <div class="stat-card ${healthCardClass}">
            <div class="stat-top">
              <span class="stat-title">System Health</span>
              <div class="stat-icon-wrapper">${healthIcon}</div>
            </div>
            <div class="stat-value">${keyPriceHealth}</div>
            <p class="stat-desc">Key feed data status</p>
          </div>
        </div>
      `;

      // Details & Top Items Row
      html += `
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 24px; margin-bottom: 24px;">
          <!-- Profit Breakdown Card -->
          <div class="ui-card" style="margin-bottom: 0;">
            <div class="ui-card-header">
              <h3 style="margin: 0; font-size: 1.15rem; display: flex; align-items: center; gap: 8px;">
                <span>📈</span> Profit Trajectory Breakdown
              </h3>
              <span class="badge badge-info">1 Key ≈ ${keyPrice.toFixed(2)} Ref</span>
            </div>

            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px;">
              <div style="padding: 16px; background: var(--surface-alt); border: 1px solid var(--border); border-radius: var(--radius); text-align: center;">
                <div style="font-size: 0.8rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px;">All Time</div>
                <div style="font-size: 1.5rem; font-weight: 800; color: ${totalProfitAll >= 0 ? 'var(--ok-text)' : 'var(--danger-text)'};">
                  ${totalProfitAll >= 0 ? '+' : ''}${totalProfitAll.toFixed(2)} ref
                </div>
              </div>

              <div style="padding: 16px; background: var(--surface-alt); border: 1px solid var(--border); border-radius: var(--radius); text-align: center;">
                <div style="font-size: 0.8rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px;">Past 7 Days</div>
                <div style="font-size: 1.5rem; font-weight: 800; color: ${totalProfit7d >= 0 ? 'var(--ok-text)' : 'var(--danger-text)'};">
                  ${totalProfit7d >= 0 ? '+' : ''}${totalProfit7d.toFixed(2)} ref
                </div>
              </div>

              <div style="padding: 16px; background: var(--surface-alt); border: 1px solid var(--border); border-radius: var(--radius); text-align: center;">
                <div style="font-size: 0.8rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px;">Past 24 Hours</div>
                <div style="font-size: 1.5rem; font-weight: 800; color: ${totalProfit24h >= 0 ? 'var(--ok-text)' : 'var(--danger-text)'};">
                  ${totalProfit24h >= 0 ? '+' : ''}${totalProfit24h.toFixed(2)} ref
                </div>
              </div>
            </div>

            <div style="padding: 16px 20px; background: var(--accent-subtle); border: 1px solid var(--accent-glow); border-radius: var(--radius);">
              <div style="font-size: 0.88rem; font-weight: 700; color: var(--accent); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                <span>💡</span> Operational Metrics Summary
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 0.88rem;">
                <div>Total Lifetime Trades: <strong style="color: var(--text);">${trades.length}</strong></div>
                <div>Avg Profit per Trade: <strong style="color: var(--text);">${trades.length > 0 ? (totalProfitAll / trades.length).toFixed(2) : '0.00'} ref</strong></div>
                <div>7-Day Volume: <strong style="color: var(--text);">${trades7d.length} trades</strong></div>
                <div>Key Price Last Sync: <strong style="color: var(--text);">${lastKeyUpdate}</strong></div>
              </div>
            </div>
          </div>

          <!-- Top Traded Items Card -->
          <div class="ui-card" style="margin-bottom: 0;">
            <div class="ui-card-header">
              <h3 style="margin: 0; font-size: 1.15rem; display: flex; align-items: center; gap: 8px;">
                <span>🔥</span> Top Items (24h)
              </h3>
            </div>

            <div>
              ${
                topItems.length === 0
                  ? '<div style="text-align: center; color: var(--text-dim); padding: 36px 12px; font-size: 0.9rem;">No trades recorded in the last 24 hours</div>'
                  : topItems.map(([itemName, count], index) => {
                      const rank = index + 1;
                      const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏅';
                      return `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 11px 0; border-bottom: 1px solid var(--border);">
                          <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 12px;">
                            <span style="font-size: 1.1rem; flex-shrink: 0;">${rankEmoji}</span>
                            <span style="font-weight: 600; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis;">${itemName}</span>
                          </div>
                          <span class="badge badge-info">${count} trade${count === 1 ? '' : 's'}</span>
                        </div>
                      `;
                    }).join('')
              }
            </div>
          </div>
        </div>
      `;

      // Quick Actions Panel
      html += `
        <div class="ui-card">
          <div class="ui-card-header">
            <h3 style="margin: 0; font-size: 1.15rem; display: flex; align-items: center; gap: 8px;">
              <span>⚡</span> Quick Navigation & Controls
            </h3>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 16px;">
            <a href="/pnl" class="stat-card stat-ok" style="text-decoration: none; cursor: pointer; padding: 18px;">
              <div style="font-size: 1.8rem; margin-bottom: 8px;">💰</div>
              <div style="font-weight: 700; font-size: 1rem; color: var(--text);">P&L Analysis</div>
              <p style="margin: 4px 0 0 0; font-size: 0.82rem; color: var(--text-muted);">Inspect profit graphs & trade details</p>
            </a>

            <a href="/trades" class="stat-card stat-info" style="text-decoration: none; cursor: pointer; padding: 18px;">
              <div style="font-size: 1.8rem; margin-bottom: 8px;">📊</div>
              <div style="font-weight: 700; font-size: 1rem; color: var(--text);">Trade History</div>
              <p style="margin: 4px 0 0 0; font-size: 0.82rem; color: var(--text-muted);">View all incoming/outgoing offers</p>
            </a>

            <a href="/key-prices" class="stat-card stat-warn" style="text-decoration: none; cursor: pointer; padding: 18px;">
              <div style="font-size: 1.8rem; margin-bottom: 8px;">🔑</div>
              <div style="font-weight: 700; font-size: 1rem; color: var(--text);">Key Prices</div>
              <p style="margin: 4px 0 0 0; font-size: 0.82rem; color: var(--text-muted);">PriceDB.io history & market charts</p>
            </a>

            <a href="/bounds" class="stat-card stat-danger" style="text-decoration: none; cursor: pointer; padding: 18px;">
              <div style="font-size: 1.8rem; margin-bottom: 8px;">⚖️</div>
              <div style="font-weight: 700; font-size: 1rem; color: var(--text);">Price Bounds</div>
              <p style="margin: 4px 0 0 0; font-size: 0.82rem; color: var(--text-muted);">Configure min/max buy & sell limits</p>
            </a>

            <a href="/bot-config" class="stat-card stat-info" style="text-decoration: none; cursor: pointer; padding: 18px;">
              <div style="font-size: 1.8rem; margin-bottom: 8px;">🤖</div>
              <div style="font-weight: 700; font-size: 1rem; color: var(--text);">Bot Config</div>
              <p style="margin: 4px 0 0 0; font-size: 0.82rem; color: var(--text-muted);">Manage tf2autobot instances</p>
            </a>

            <a href="/settings" class="stat-card" style="text-decoration: none; cursor: pointer; padding: 18px;">
              <div style="font-size: 1.8rem; margin-bottom: 8px;">⚙️</div>
              <div style="font-weight: 700; font-size: 1rem; color: var(--text);">Settings</div>
              <p style="margin: 4px 0 0 0; font-size: 0.82rem; color: var(--text-muted);">API tokens, algorithms & thresholds</p>
            </a>
          </div>
        </div>
      `;

      html += '</div>';

      res.send(renderPage('Dashboard', html));
    } catch (error) {
      console.error('Dashboard error:', error);
      res.status(500).send(renderPage('Error', '<div class="flash flash-error">Error loading dashboard: ' + error.message + '</div>'));
    }
  });
};
