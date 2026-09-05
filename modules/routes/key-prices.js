/* eslint-disable spellcheck/spell-checker */
const renderPage = require('../layout');
const { getBaseConfigManager } = require('../baseConfigManager');

module.exports = (app) => {
  app.get('/api/key-prices/pricedb', async (req, res) => {
    try {
      const https = require('node:https');
      const config = getBaseConfigManager().getConfig();
      const apiSettings = config.apiSettings || { priceDbBaseUrl: 'https://pricedb.io/api' };
      
      https.get(`${apiSettings.priceDbBaseUrl}/item-history/5021;6`, (response) => {
        let data = '';
        
        response.on('data', (chunk) => {
          data += chunk;
        });
        
        response.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            res.json(jsonData);
          } catch (err) {
            res.status(500).json({ error: 'Failed to parse', message: err.message });
          }
        });
      }).on('error', (err) => {
        res.status(500).json({ error: 'Failed to fetch', message: err.message });
      });
    } catch (err) {
      res.status(500).json({ error: 'Server error', message: err.message });
    }
  });

  app.get('/key-prices', async (req, res) => {
    try {
      const config = getBaseConfigManager().getConfig();
      const externalLinks = config.externalLinks || { chartJsCdnUrl: 'https://cdn.jsdelivr.net/npm/chart.js' };

      const html = `
        <div style="max-width: 1560px; margin: 0 auto;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
            <div>
              <h1 style="font-size: 1.9rem; font-weight: 800; margin-bottom: 6px; display: flex; align-items: center; gap: 12px;">
                <span>📈</span> Mann Co. Supply Crate Key Price History
              </h1>
              <p style="margin: 0; font-size: 0.95rem; color: var(--text-muted);">
                Real-time & historical key price trajectory from backpack.tf via PriceDB.io API.
              </p>
            </div>
            <div>
              <button onclick="loadPriceDBData()" id="pricedbBtn" class="btn btn-primary" style="font-size: 0.95rem; padding: 10px 22px;">
                <span>🌐</span> Load Price History
              </button>
            </div>
          </div>
          
          <div id="loadingIndicator" style="display: none; text-align: center; padding: 60px 20px;">
            <div style="display: inline-block; width: 44px; height: 44px; border: 4px solid var(--border); border-top: 4px solid var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
            <p style="margin-top: 16px; font-weight: 600; color: var(--text-muted);">Fetching market history from PriceDB.io...</p>
            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
          </div>
          
          <div id="pricedbContainer" style="display: none;">
            <div id="pricedbStats" style="margin-bottom: 24px;"></div>
            
            <div class="table-container" style="margin-bottom: 24px;">
              <div class="table-header-bar">
                <div>
                  <h3 style="margin: 0;"><span>📊</span> Price Trend Chart</h3>
                  <p style="margin: 4px 0 0 0; color: var(--text-muted);">Historical Buy vs. Sell refined metal prices</p>
                </div>
              </div>
              <div style="padding: 24px; position: relative; height: 420px;">
                <canvas id="pricedbChart"></canvas>
              </div>
            </div>

            <div id="marketInsights" class="ui-card" style="border-left: 4px solid var(--accent); padding: 20px 24px;"></div>
          </div>
        </div>
        
        <script src="${externalLinks.chartJsCdnUrl}"></script>
        <script>
          let pricedbChartInstance = null;
          async function loadPriceDBData() {
            const btn = document.getElementById('pricedbBtn');
            btn.disabled = true;
            document.getElementById('loadingIndicator').style.display = 'block';
            try {
              const response = await fetch('/api/key-prices/pricedb');
              const data = await response.json();
              displayPriceDBData(data);
              document.getElementById('loadingIndicator').style.display = 'none';
              document.getElementById('pricedbContainer').style.display = 'block';
              btn.innerHTML = '<span>✅</span> Refresh Data';
              btn.disabled = false;
            } catch (err) {
              document.getElementById('loadingIndicator').style.display = 'none';
              btn.disabled = false;
              alert('Failed to load PriceDB data: ' + err.message);
            }
          }

          function displayPriceDBData(data) {
            data.sort((a, b) => a.time - b.time);
            const times = data.map(p => new Date(p.time * 1000).toLocaleDateString());
            const buys = data.map(p => p.buy.metal);
            const sells = data.map(p => p.sell.metal);
            const avgBuy = (buys.reduce((a,b)=>a+b,0)/buys.length).toFixed(2);
            const avgSell = (sells.reduce((a,b)=>a+b,0)/sells.length).toFixed(2);
            const latestBuy = buys.at(-1).toFixed(2);
            const latestSell = sells.at(-1).toFixed(2);
            const spread = (sells.at(-1) - buys.at(-1)).toFixed(2);

            document.getElementById('pricedbStats').innerHTML = \`
              <div class="stats-grid">
                <div class="stat-card stat-ok">
                  <div class="stat-top">
                    <span class="stat-title">Latest Buy Price</span>
                    <div class="stat-icon-wrapper">🟢</div>
                  </div>
                  <div class="stat-value">\${latestBuy} ref</div>
                  <p class="stat-desc">Historical Avg: \${avgBuy} ref</p>
                </div>

                <div class="stat-card stat-danger">
                  <div class="stat-top">
                    <span class="stat-title">Latest Sell Price</span>
                    <div class="stat-icon-wrapper">🔴</div>
                  </div>
                  <div class="stat-value">\${latestSell} ref</div>
                  <p class="stat-desc">Historical Avg: \${avgSell} ref</p>
                </div>

                <div class="stat-card stat-warn">
                  <div class="stat-top">
                    <span class="stat-title">Current Spread</span>
                    <div class="stat-icon-wrapper">⚡</div>
                  </div>
                  <div class="stat-value">\${spread} ref</div>
                  <p class="stat-desc">Sell margin gap</p>
                </div>

                <div class="stat-card stat-info">
                  <div class="stat-top">
                    <span class="stat-title">Recorded Points</span>
                    <div class="stat-icon-wrapper">📈</div>
                  </div>
                  <div class="stat-value">\${data.length}</div>
                  <p class="stat-desc">Historical price records</p>
                </div>
              </div>
            \`;

            document.getElementById('marketInsights').innerHTML = \`
              <h4 style="margin: 0 0 8px 0; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                <span>💡</span> Key Market Analytics
              </h4>
              <p style="margin: 0; color: var(--text-muted); font-size: 0.92rem;">
                Current key price spread is <strong>\${spread} ref</strong>. The key market shows a 
                \${parseFloat(latestBuy) >= parseFloat(avgBuy) ? 'steady or rising' : 'softening'} valuation compared to the historical average of \${avgBuy} ref.
              </p>
            \`;

            if (pricedbChartInstance) pricedbChartInstance.destroy();
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
            const textColor = isDark ? '#94a3b8' : '#64748b';

            pricedbChartInstance = new Chart(document.getElementById('pricedbChart'), {
              type: 'line',
              data: {
                labels: times,
                datasets: [
                  {
                    label: 'Buy Price (Ref)',
                    data: buys,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: false,
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: 2
                  },
                  {
                    label: 'Sell Price (Ref)',
                    data: sells,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    fill: false,
                    tension: 0.3,
                    borderWidth: 2,
                    pointRadius: 2
                  }
                ]
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: 'top',
                    labels: { color: textColor, font: { family: "'Plus Jakarta Sans', sans-serif" } }
                  }
                },
                scales: {
                  x: { grid: { color: gridColor }, ticks: { color: textColor } },
                  y: { grid: { color: gridColor }, ticks: { color: textColor } }
                }
              }
            });
          }
        </script>
      `;
      res.send(renderPage('Key Price History', html));
    } catch (err) {
      res.status(500).send(renderPage('Error', '<div class="flash flash-error">Error: ' + err.message + '</div>'));
    }
  });
};
