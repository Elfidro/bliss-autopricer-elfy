// index.js
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const ConfigManager = require('./configManager');
const { getBaseConfigManager } = require('./baseConfigManager');
const { createAuthMiddleware } = require('./auth');

const app = express();
// Increase body parser limits for large pricelists and parameter arrays
app.use(bodyParser.urlencoded({ 
  extended: true, 
  limit: '50mb', 
  parameterLimit: 1000000 
}));
app.use(bodyParser.json({ limit: '50mb' }));

const CONFIG_PATH = path.resolve(__dirname, '../pricerConfig.json');
const configManager = new ConfigManager(CONFIG_PATH);

// Get legacy config for backward compatibility with existing routes
let config;
try {
  config = configManager.getLegacyConfig();
} catch (err) {
  console.error('❌ No bot selected or configuration error:', err.message);
  console.log('🔧 Please run the bot configuration setup first');
  console.log('📋 Configuration Summary:');
  console.log(JSON.stringify(configManager.getSummary(), null, 2));

  // Provide default config to prevent crashes
  config = {
    pm2ProcessName: 'tf2autobot',
    tf2AutobotDir: '../../tf2autobot-5.13.0',
    botTradingDir: 'files/bot',
    port: process.env.PRICE_WATCHER_PORT || 3000,
    ageThresholdSec: 7200,
  };
}

const PORT = config.port;

function mountRoutes() {
  // Must come before every route: /settings renders API keys and the database
  // password into the page, so nothing here may be served unauthenticated.
  let webAuth = {};
  try {
    webAuth = getBaseConfigManager().getConfig().webAuth || {};
  } catch (err) {
    console.error(`❌ Could not read webAuth from config.json: ${err.message}`);
  }
  app.use(createAuthMiddleware(webAuth));

  require('./routes/pricelist')(app, config, configManager);
  require('./routes/trades')(app, config, configManager);
  require('./routes/key-prices')(app, config);
  require('./routes/actions')(app, config, configManager);
  require('./routes/logs')(app, config);
  require('./routes/pnl')(app, config, configManager);
  require('./routes/bounds')(app, config);

  // Add bot management routes
  require('./routes/bot-config')(app, configManager);

  // Add new dashboard and settings routes
  require('./routes/dashboard')(app, configManager);
  require('./routes/settings')(app);
}

function startPriceWatcher() {
  mountRoutes();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PriceWatcher web server running on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startPriceWatcher();
}

module.exports = { startPriceWatcher };
