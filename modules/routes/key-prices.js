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
        <div style="max-width: 1200px; margin: 0 auto; padding: 20px;">
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
            <h2 style="margin: 0 0 10px 0;">📈 Mann Co. Supply Crate Key Price History</h2>
            <p style="margin: 0 0 15px 0;">Historical key price data from backpack.tf via PriceDB.io</p>
            <button onclick="loadPriceDBData()" id="pricedbBtn" style="background: #6f42c1; color: white; border: none; padding: 12px 32px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 16px;">
              🌐 Load Price History
            </button>
          </div>
          
          <div id="loadingIndicator" style="display: none; text-align: center; padding: 40px;">
            <div style="display: inline-block; width: 50px; height: 50px; border: 5px solid #f3f3f3; border-top: 5px solid #6f42c1; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <p style="margin-top: 20px;">Loading...</p>
            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
          </div>
          
          <div id="pricedbContainer" style="display: none;">
            <div id="pricedbStats" style="margin-bottom: 20px;"></div>
            <div style="background: white; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">
              <div style="background: #f8f9fa; padding: 15px; border-bottom: 1px solid #ddd;">
                <h3 style="margin: 0;">📊 Price Trend Chart</h3>
              </div>
              <div style="padding: 20px;">
                <canvas id="pricedbChart" width="1000" height="400"></canvas>
              </div>
            </div>
            <div id="marketInsights" style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 8px;"></div>
          </div>
        </div>
        
        <script src="${externalLinks.chartJsCdnUrl}"></script>
        <script>
          let pricedbChartInstance = null;
          async function loadPriceDBData() {
            document.getElementById('pricedbBtn').disabled = true;
            document.getElementById('loadingIndicator').style.display = 'block';
            const response = await fetch('/api/key-prices/pricedb');
            const data = await response.json();
            displayPriceDBData(data);
            document.getElementById('loadingIndicator').style.display = 'none';
            document.getElementById('pricedbContainer').style.display = 'block';
            document.getElementById('pricedbBtn').innerText = '✅ Loaded';
            document.getElementById('pricedbBtn').style.background = '#28a745';
          }
          function displayPriceDBData(data) {
            data.sort((a, b) => a.time - b.time);
            const times = data.map(p => new Date(p.time * 1000).toLocaleString());
            const buys = data.map(p => p.buy.metal);
            const sells = data.map(p => p.sell.metal);
            const avgBuy = (buys.reduce((a,b)=>a+b,0)/buys.length).toFixed(2);
            const avgSell = (sells.reduce((a,b)=>a+b,0)/sells.length).toFixed(2);
            document.getElementById('pricedbStats').innerHTML = '<div style="display:flex;gap:20px;flex-wrap:wrap;"><div style="flex:1;background:#e8f4fd;padding:15px;border-radius:8px;"><h4>🟢 Buy</h4><p>Avg: '+avgBuy+'</p><p>Latest: '+buys.at(-1).toFixed(2)+'</p></div><div style="flex:1;background:#fff3cd;padding:15px;border-radius:8px;"><h4>🔴 Sell</h4><p>Avg: '+avgSell+'</p><p>Latest: '+sells.at(-1).toFixed(2)+'</p></div></div>';
            document.getElementById('marketInsights').innerHTML = '<h4>💡 Insights</h4><p>Spread: '+(sells.at(-1)-buys.at(-1)).toFixed(2)+' ref</p>';
            if(pricedbChartInstance) pricedbChartInstance.destroy();
            pricedbChartInstance = new Chart(document.getElementById('pricedbChart'), {
              type: 'line',
              data: {
                labels: times,
                datasets: [{label:'Buy',data:buys,borderColor:'#28a745',tension:0.3},{label:'Sell',data:sells,borderColor:'#dc3545',tension:0.3}]
              },
              options: {responsive:true,plugins:{legend:{position:'top'}}}
            });
          }
        </script>
      `;
      res.send(renderPage('Key Price History', html));
    } catch (err) {
      res.status(500).send(renderPage('Error', '<p>Error: ' + err.message + '</p>'));
    }
  });
};
