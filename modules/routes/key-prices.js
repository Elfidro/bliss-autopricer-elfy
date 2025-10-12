/* eslint-disable spellcheck/spell-checker */
const { db } = require('../dbInstance');
const renderPage = require('../layout');

module.exports = (app) => {
  app.get('/key-prices', async (req, res) => {
    try {
      const data = await db.any(`
        SELECT timestamp, buy_price_metal, sell_price_metal
        FROM key_prices
        WHERE created_at > NOW() - INTERVAL '14 days'
        ORDER BY created_at ASC
      `);

      // Handle empty data gracefully
      if (!data || data.length === 0) {
        let html = '<div style="max-width: 1200px; margin: 0 auto; padding: 20px;">';
        html +=
          '<div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; text-align: center;">';
        html += '<h2>📊 No Key Price Data Available</h2>';
        html +=
          '<p>No key prices have been recorded in the last 14 days. The system needs to run for a while to collect data.</p>';
        html += '<p>Key prices are automatically updated by the autopricer.</p>';
        html +=
          '<p><a href="/" style="background: #007cba; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">← Back to Dashboard</a></p>';
        html += '</div>';
        html += '</div>';
        return res.send(renderPage('Key Prices', html));
      }

      const timestamps = data.map((p) => new Date(p.timestamp * 1000).toLocaleString());
      const buyPrices = data.map((p) => parseFloat(p.buy_price_metal));
      const sellPrices = data.map((p) => parseFloat(p.sell_price_metal));

      const mean = (arr) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
      const stdDev = (arr) => {
        if (arr.length === 0) return 0;
        const avg = mean(arr);
        return Math.sqrt(arr.map((x) => Math.pow(x - avg, 2)).reduce((a, b) => a + b) / arr.length);
      };

      const stats = {
        buy: {
          mean: mean(buyPrices).toFixed(3),
          std: stdDev(buyPrices).toFixed(3),
        },
        sell: {
          mean: mean(sellPrices).toFixed(3),
          std: stdDev(sellPrices).toFixed(3),
        },
      };

      // Build the page content with modern styling
      let html = '<div style="max-width: 1200px; margin: 0 auto; padding: 20px;">';

      // Header
      html +=
        '<div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px;">';
      html += '<h2>📈 Key Price Analytics</h2>';
      html +=
        '<p>Monitor Mann Co. Supply Crate Key price trends over the last 14 days to make informed trading decisions.</p>';
      html += '</div>';

      // Statistics Cards
      html += '<div style="display: flex; gap: 20px; margin-bottom: 20px; flex-wrap: wrap;">';

      // Buy Price Stats
      html +=
        '<div style="flex: 1; min-width: 300px; background: #e8f4fd; padding: 15px; border-radius: 8px;">';
      html += '<h3 style="color: #28a745; margin-top: 0;">🟢 Buy Price Statistics</h3>';
      html += `<p><strong>Average:</strong> ${stats.buy.mean} Refined Metal</p>`;
      html += `<p><strong>Standard Deviation:</strong> ${stats.buy.std}</p>`;
      html += `<p><strong>Data Points:</strong> ${buyPrices.length}</p>`;
      html += '</div>';

      // Sell Price Stats
      html +=
        '<div style="flex: 1; min-width: 300px; background: #fff3cd; padding: 15px; border-radius: 8px;">';
      html += '<h3 style="color: #dc3545; margin-top: 0;">🔴 Sell Price Statistics</h3>';
      html += `<p><strong>Average:</strong> ${stats.sell.mean} Refined Metal</p>`;
      html += `<p><strong>Standard Deviation:</strong> ${stats.sell.std}</p>`;
      html += `<p><strong>Data Points:</strong> ${sellPrices.length}</p>`;
      html += '</div>';

      html += '</div>';

      // Chart Container
      html +=
        '<div style="background: white; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; margin-bottom: 20px;">';
      html += '<div style="background: #f8f9fa; padding: 15px; border-bottom: 1px solid #ddd;">';
      html += '<h3 style="margin: 0;">📊 Price Trend Chart</h3>';
      html +=
        '<p style="margin: 5px 0 0 0; color: #666;">Interactive chart showing buy and sell price movements</p>';
      html += '</div>';
      html += '<div style="padding: 20px;">';
      html += '<canvas id="priceChart" width="1000" height="400"></canvas>';
      html += '</div>';
      html += '</div>';

      // Data insights
      if (data.length > 0) {
        const latestBuy = buyPrices[buyPrices.length - 1];
        const latestSell = sellPrices[sellPrices.length - 1];
        const spread = latestSell - latestBuy;

        html +=
          '<div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 15px; border-radius: 8px;">';
        html += '<h4>💡 Current Market Insights</h4>';
        html += `<p><strong>Latest Buy Price:</strong> ${latestBuy.toFixed(2)} Refined Metal</p>`;
        html += `<p><strong>Latest Sell Price:</strong> ${latestSell.toFixed(2)} Refined Metal</p>`;
        html += `<p><strong>Current Spread:</strong> ${spread.toFixed(2)} Refined Metal</p>`;
        html += `<p><strong>Profit Margin:</strong> ${((spread / latestBuy) * 100).toFixed(2)}%</p>`;
        html += '</div>';
      }

      html += '</div>';

      // Add the chart script
      html += `
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <script>
          const ctx = document.getElementById('priceChart').getContext('2d');
          new Chart(ctx, {
            type: 'line',
            data: {
              labels: ${JSON.stringify(timestamps)},
              datasets: [
                {
                  label: 'Buy Price',
                  data: ${JSON.stringify(buyPrices)},
                  borderColor: '#28a745',
                  backgroundColor: 'rgba(40, 167, 69, 0.1)',
                  fill: false,
                  tension: 0.3,
                  pointBackgroundColor: '#28a745',
                  pointBorderColor: '#fff',
                  pointBorderWidth: 2
                },
                {
                  label: 'Sell Price',
                  data: ${JSON.stringify(sellPrices)},
                  borderColor: '#dc3545',
                  backgroundColor: 'rgba(220, 53, 69, 0.1)',
                  fill: false,
                  tension: 0.3,
                  pointBackgroundColor: '#dc3545',
                  pointBorderColor: '#fff',
                  pointBorderWidth: 2
                }
              ]
            },
            options: {
              responsive: true,
              plugins: {
                title: {
                  display: true,
                  text: 'Mann Co. Supply Crate Key Price Trends (Last 14 Days)',
                  font: {
                    size: 16,
                    weight: 'bold'
                  }
                },
                legend: {
                  position: 'top',
                }
              },
              scales: {
                y: {
                  title: {
                    display: true,
                    text: 'Price (Refined Metal)',
                    font: {
                      weight: 'bold'
                    }
                  },
                  beginAtZero: false
                },
                x: {
                  title: {
                    display: true,
                    text: 'Date & Time',
                    font: {
                      weight: 'bold'
                    }
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

      res.send(renderPage('Key Price Analytics', html));
    } catch (err) {
      console.error('Failed to load key prices:', err);

      let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
      html +=
        '<div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 8px; text-align: center;">';
      html += '<h2>❌ Error Loading Key Price Data</h2>';
      html += '<p>Could not retrieve key price data from the database.</p>';
      html += `<p><strong>Error:</strong> ${err.message}</p>`;
      html += '<p>This could indicate a database connection issue or missing data table.</p>';
      html += '</div>';
      html += '</div>';

      res.status(500).send(renderPage('Key Prices - Error', html));
    }
  });
};
