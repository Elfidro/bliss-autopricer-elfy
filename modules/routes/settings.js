const path = require('path');
const express = require('express');
const renderPage = require('../layout');
const { loadJson, saveJson } = require('../utils');
const { getBaseConfigManager } = require('../baseConfigManager');

module.exports = function (app) {
  const router = express.Router();

  // Settings page
  router.get('/', (req, res) => {
    try {
      // Load current configuration
      const baseConfig = getBaseConfigManager();
      let config = {};
      try {
        config = baseConfig.getConfig();
      } catch (error) {
        console.log('Creating new config.json with defaults');
        config = {
          bptfAPIKey: '',
          bptfToken: '',
          steamAPIKey: '',
          database: {
            schema: 'tf2',
            host: 'localhost',
            port: 5432,
            name: 'bptf-autopricer',
            user: 'postgres',
            password: '',
          },
          pricerPort: 3456,
        };
      }

      // Load pricer config
      const pricerConfigPath = path.resolve(__dirname, '../../pricerConfig.json');
      let pricerConfig = {};
      try {
        pricerConfig = loadJson(pricerConfigPath);
      } catch (error) {
        console.log('Creating new pricerConfig.json with defaults');
        pricerConfig = {
          version: '2.0',
          port: 3000,
          ageThresholdSec: 7200,
          pm2ProcessName: 'tf2autobot',
        };
      }

      let html = '<div style="max-width: 1000px; margin: 0 auto; padding: 20px;">';

      // Success/Error messages
      if (req.query.success) {
        html +=
          '<div style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 8px; margin-bottom: 20px;">✅ Settings saved successfully!</div>';
      }
      if (req.query.error) {
        html +=
          '<div style="background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; padding: 15px; border-radius: 8px; margin-bottom: 20px;">❌ Error saving settings. Please try again.</div>';
      }

      // Header
      html +=
        '<div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 20px;">';
      html += '<h2>⚙️ Application Settings</h2>';
      html += '<p>Configure API keys, database settings, and application preferences.</p>';
      html += '</div>';

      // Settings Form
      html +=
        '<form method="POST" action="/settings/update" style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #ddd;">';

      // API Settings Section
      html += '<div style="margin-bottom: 30px;">';
      html +=
        '<h3 style="color: #007cba; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">🔌 API Configuration</h3>';

      html += '<div style="display: grid; grid-template-columns: 1fr; gap: 20px; margin: 20px 0;">';
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Steam API Key:</label>
        <input type="password" name="steam_api_key" value="${config.steamAPIKey || ''}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"
               placeholder="Enter your Steam API key">
        <small style="color: #666;">Required for Steam Web API calls</small>
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Backpack.tf API Key:</label>
        <input type="password" name="bptf_api_key" value="${config.bptfAPIKey || ''}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"
               placeholder="Enter your Backpack.tf API key">
        <small style="color: #666;">Required for Backpack.tf API calls</small>
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Backpack.tf Token:</label>
        <input type="password" name="bptf_token" value="${config.bptfToken || ''}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"
               placeholder="Enter your Backpack.tf token">
        <small style="color: #666;">Required for authenticated Backpack.tf requests</small>
      </div>`;
      html += '</div>';
      html += '</div>';

      // Database Settings Section
      html += '<div style="margin-bottom: 30px;">';
      html +=
        '<h3 style="color: #007cba; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">🗃️ Database Configuration</h3>';

      html +=
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0;">';
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Database Host:</label>
        <input type="text" name="db_host" value="${config.database?.host || 'localhost'}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Database Port:</label>
        <input type="number" name="db_port" value="${config.database?.port || 5432}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Database Name:</label>
        <input type="text" name="db_name" value="${config.database?.name || 'bptf-autopricer'}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Database User:</label>
        <input type="text" name="db_user" value="${config.database?.user || 'postgres'}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Database Password:</label>
        <input type="password" name="db_password" value="${config.database?.password || ''}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Database Schema:</label>
        <input type="text" name="db_schema" value="${config.database?.schema || 'tf2'}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
      </div>`;
      html += '</div>';
      html += '</div>';

      // Application Settings Section
      html += '<div style="margin-bottom: 30px;">';
      html +=
        '<h3 style="color: #007cba; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">⚙️ Application Configuration</h3>';

      html +=
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0;">';
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Pricer Port:</label>
        <input type="number" name="pricer_port" value="${config.pricerPort || 3456}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" min="1000" max="65535">
        <small style="color: #666;">Port for the price manager web interface</small>
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Web Interface Port:</label>
        <input type="number" name="web_port" value="${pricerConfig.port || 3000}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" min="1000" max="65535">
        <small style="color: #666;">Port for this web interface</small>
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Age Threshold (seconds):</label>
        <input type="number" name="age_threshold" value="${pricerConfig.ageThresholdSec || 7200}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" min="300" max="86400">
        <small style="color: #666;">Maximum age for price data (7200 = 2 hours)</small>
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">PM2 Process Name:</label>
        <input type="text" name="pm2_process_name" value="${pricerConfig.pm2ProcessName || 'tf2autobot'}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
        <small style="color: #666;">Name of the PM2 process for bot restart</small>
      </div>`;
      html += '</div>';
      html += '</div>';

      // Trading Settings Section
      html += '<div style="margin-bottom: 30px;">';
      html +=
        '<h3 style="color: #007cba; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">💰 Trading Configuration</h3>';

      html +=
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0;">';
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Min Sell Margin:</label>
        <input type="number" name="min_sell_margin" value="${config.minSellMargin || 0.11}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" 
               min="0" max="1" step="0.01">
        <small style="color: #666;">Minimum profit margin for selling (0.11 = 11%)</small>
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">SCM Margin Buy:</label>
        <input type="number" name="scm_margin_buy" value="${config.scmMarginBuy ?? 0}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" 
               step="0.01">
        <small style="color: #666;">Steam Community Market margin for buy prices</small>
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">SCM Margin Sell:</label>
        <input type="number" name="scm_margin_sell" value="${config.scmMarginSell ?? 0}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" 
               step="0.01">
        <small style="color: #666;">Steam Community Market margin for sell prices</small>
      </div>`;
      html += `<div style="grid-column: 1 / -1;">
        <label style="display: flex; align-items: center; margin-bottom: 10px;">
          <input type="checkbox" name="use_pricedb_fallback" ${config.usePriceDbFallback !== false ? 'checked' : ''} 
                 style="margin-right: 8px;">
          <span style="font-weight: bold;">Use PriceDB.io as Priority Fallback</span>
        </label>
        <small style="color: #666; display: block; margin-left: 24px;">Uses pricedb.io as PRIMARY fallback when listings are insufficient (before SCM)</small>
      </div>`;
      html += `<div style="grid-column: 1 / -1;">
        <label style="display: flex; align-items: center; margin-bottom: 10px;">
          <input type="checkbox" name="use_scm_fallback" ${config.useScmFallback !== false ? 'checked' : ''} 
                 style="margin-right: 8px;">
          <span style="font-weight: bold;">Use Steam Community Market Fallback</span>
        </label>
        <small style="color: #666; display: block; margin-left: 24px;">Use Steam Community Market as fallback pricing source (will be used after PriceDB if both are enabled)</small>
      </div>`;
      html += '</div>';
      html += '</div>';

      // Excluded Steam IDs Section
      html += '<div style="margin-bottom: 30px;">';
      html +=
        '<h3 style="color: #007cba; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">🚫 Excluded Steam IDs</h3>';
      html +=
        '<p style="color: #666; margin-bottom: 15px;">Steam IDs to exclude from listing calculations (e.g., known scammers, manipulators)</p>';

      const excludedIds = config.excludedSteamIDs || [];
      html += '<div>';
      html += `<textarea name="excluded_steam_ids" rows="6" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace;"
               placeholder="Enter one Steam ID per line&#10;76561198083901668&#10;76561198123456789">${excludedIds.join('\n')}</textarea>`;
      html += '<small style="color: #666;">One Steam ID per line (17 digits)</small>';
      html += '</div>';
      html += '</div>';

      // Trusted Steam IDs Section
      html += '<div style="margin-bottom: 30px;">';
      html +=
        '<h3 style="color: #007cba; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">⭐ Trusted/Priority Steam IDs</h3>';
      html +=
        '<p style="color: #666; margin-bottom: 15px;">Steam IDs that are trusted and given priority in listing calculations</p>';

      const trustedIds = config.trustedSteamIDs || [];
      html += '<div>';
      html += `<textarea name="trusted_steam_ids" rows="6" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace;"
               placeholder="Enter one Steam ID per line&#10;76561198083901668&#10;76561198123456789">${trustedIds.join('\n')}</textarea>`;
      html += '<small style="color: #666;">One Steam ID per line (17 digits)</small>';
      html += '</div>';
      html += '</div>';

      // Excluded Listing Descriptions Section
      html += '<div style="margin-bottom: 30px;">';
      html +=
        '<h3 style="color: #007cba; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">🔇 Excluded Listing Descriptions</h3>';
      html +=
        '<p style="color: #666; margin-bottom: 15px;">Keywords to filter out from listing descriptions (e.g., "spell", "exorcism", "footsteps")</p>';

      const excludedDescriptions = config.excludedListingDescriptions || [];
      html += '<div>';
      html += `<textarea name="excluded_descriptions" rows="6" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace;"
               placeholder="Enter one keyword per line&#10;exorcism&#10;spell&#10;footsteps">${excludedDescriptions.join('\n')}</textarea>`;
      html += '<small style="color: #666;">One keyword per line (case-insensitive)</small>';
      html += '</div>';
      html += '</div>';

      // Bot Owners Section - NEW
      html += '<div style="margin-bottom: 30px;">';
      html +=
        '<h3 style="color: #007cba; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">👑 Bot Owners (P&L Exclusion)</h3>';
      html +=
        '<p style="color: #666; margin-bottom: 15px;">Steam IDs of bot owners whose trades should be excluded from profit/loss calculations (since they can deposit/withdraw freely)</p>';

      const ownerIds = config.botOwnerSteamIDs || [];
      html += '<div id="owner-ids-container">';

      if (ownerIds.length === 0) {
        html +=
          '<div class="owner-id-row" style="display: flex; gap: 10px; margin-bottom: 10px; align-items: center;">';
        html +=
          '<input type="text" name="bot_owner_ids[]" placeholder="Enter Steam ID (e.g., 76561198083901668)" style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">';
        html +=
          '<button type="button" onclick="removeOwnerRow(this)" style="background: #dc3545; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;">❌</button>';
        html += '</div>';
      } else {
        ownerIds.forEach((id) => {
          html +=
            '<div class="owner-id-row" style="display: flex; gap: 10px; margin-bottom: 10px; align-items: center;">';
          html += `<input type="text" name="bot_owner_ids[]" value="${id}" placeholder="Enter Steam ID (e.g., 76561198083901668)" style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">`;
          html +=
            '<button type="button" onclick="removeOwnerRow(this)" style="background: #dc3545; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;">❌</button>';
          html += '</div>';
        });
      }

      html += '</div>';
      html +=
        '<button type="button" onclick="addOwnerRow()" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-top: 10px;">➕ Add Another Owner</button>';
      html += '</div>';

      // WebSocket Relay Configuration Section
      html += '<div style="margin-bottom: 30px;">';
      html +=
        '<h3 style="color: #007cba; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">🔌 WebSocket Relay Configuration</h3>';
      html +=
        '<p style="color: #666; margin-bottom: 15px;">Configure connection to backpack.tf websocket relay server (allows multiple instances to share one connection)</p>';

      html +=
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0;">';
      html += `<div>
        <label style="display: flex; align-items: center; margin-bottom: 15px;">
          <input type="checkbox" name="relay_enabled" ${config.websocketRelay?.enabled ? 'checked' : ''} 
                 style="margin-right: 8px;">
          <span style="font-weight: bold;">Enable Relay Mode</span>
        </label>
        <small style="color: #666;">Use relay server instead of direct backpack.tf connection</small>
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Relay Protocol:</label>
        <select name="relay_protocol" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
          <option value="ws" ${(config.websocketRelay?.protocol || 'ws') === 'ws' ? 'selected' : ''}>ws (HTTP)</option>
          <option value="wss" ${(config.websocketRelay?.protocol || 'ws') === 'wss' ? 'selected' : ''}>wss (HTTPS)</option>
        </select>
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Relay Host:</label>
        <input type="text" name="relay_host" value="${config.websocketRelay?.host || 'localhost'}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
        <small style="color: #666;">IP address or hostname of relay server</small>
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Relay Port:</label>
        <input type="number" name="relay_port" value="${config.websocketRelay?.port || 7789}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" min="1" max="65535">
        <small style="color: #666;">Port number of relay server (default: 7789)</small>
      </div>`;
      html += '</div>';
      html += '</div>';

      // Price Swing Limits Section
      html += '<div style="margin-bottom: 30px;">';
      html +=
        '<h3 style="color: #007cba; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">� Price Swing Limits</h3>';
      html +=
        '<p style="color: #666; margin-bottom: 15px;">Control maximum price changes per update to prevent sudden swings</p>';

      html +=
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0;">';
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Max Buy Increase:</label>
        <input type="number" name="max_buy_increase" value="${config.priceSwingLimits?.maxBuyIncrease || 0.1}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" 
               min="0" max="1" step="0.01">
        <small style="color: #666;">Maximum buy price increase per update (0.1 = 10%)</small>
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Max Sell Decrease:</label>
        <input type="number" name="max_sell_decrease" value="${config.priceSwingLimits?.maxSellDecrease || 0.1}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" 
               min="0" max="1" step="0.01">
        <small style="color: #666;">Maximum sell price decrease per update (0.1 = 10%)</small>
      </div>`;
      html += '</div>';
      html += '</div>';

      // Max Percentage Differences Section
      html += '<div style="margin-bottom: 30px;">';
      html +=
        '<h3 style="color: #007cba; border-bottom: 2px solid #e9ecef; padding-bottom: 10px;">📈 Max Percentage Differences (BPTF Baseline)</h3>';
      html +=
        '<p style="color: #666; margin-bottom: 15px;">Maximum allowed difference from Backpack.tf baseline prices before rejecting</p>';

      html +=
        '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0;">';
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Max Buy Difference:</label>
        <input type="number" name="max_percentage_diff_buy" value="${config.maxPercentageDifferences?.buy ?? 5}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" 
               step="0.1">
        <small style="color: #666;">Maximum % buy price can differ from BPTF (5 = 5%)</small>
      </div>`;
      html += `<div>
        <label style="display: block; margin-bottom: 5px; font-weight: bold;">Max Sell Difference:</label>
        <input type="number" name="max_percentage_diff_sell" value="${config.maxPercentageDifferences?.sell ?? -8}" 
               style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" 
               step="0.1">
        <small style="color: #666;">Maximum % sell price can differ from BPTF (-8 = -8%)</small>
      </div>`;
      html += '</div>';
      html += '</div>';

      // Action Buttons
      html += '<div style="border-top: 1px solid #ddd; padding-top: 20px; text-align: right;">';
      html +=
        '<button type="button" onclick="window.location.href=\'/\'" style="background: #6c757d; color: white; padding: 10px 20px; border: none; border-radius: 4px; margin-right: 10px; cursor: pointer;">Cancel</button>';
      html +=
        '<button type="submit" style="background: #28a745; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer;">💾 Save Settings</button>';
      html += '</div>';

      html += '</form>';

      // JavaScript for managing owner IDs
      html += `
        <script>
          function addOwnerRow() {
            const container = document.getElementById('owner-ids-container');
            const newRow = document.createElement('div');
            newRow.className = 'owner-id-row';
            newRow.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px; align-items: center;';
            newRow.innerHTML = \`
              <input type="text" name="bot_owner_ids[]" placeholder="Enter Steam ID (e.g., 76561198083901668)" style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
              <button type="button" onclick="removeOwnerRow(this)" style="background: #dc3545; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;">❌</button>
            \`;
            container.appendChild(newRow);
          }

          function removeOwnerRow(button) {
            const container = document.getElementById('owner-ids-container');
            const rows = container.querySelectorAll('.owner-id-row');
            
            // Always keep at least one row
            if (rows.length > 1) {
              button.parentElement.remove();
            } else {
              // Clear the input instead of removing the row
              const input = button.parentElement.querySelector('input');
              input.value = '';
            }
          }
        </script>
      `;

      html += '</div>';

      res.send(renderPage('Settings', html));
    } catch (error) {
      console.error('Settings page error:', error);
      res.status(500).send(renderPage('Error', '<div>Error loading settings page</div>'));
    }
  });

  // Update settings endpoint
  router.post('/update', (req, res) => {
    try {
      const { getBaseConfigManager } = require('../baseConfigManager');
      const baseConfig = getBaseConfigManager();
      const pricerConfigPath = path.resolve(__dirname, '../../pricerConfig.json');

      let config = {};
      let pricerConfig = {};

      try {
        config = baseConfig.getConfig();
      } catch {
        console.log('Creating new config.json');
        config = {};
      }

      try {
        pricerConfig = loadJson(pricerConfigPath);
      } catch {
        console.log('Creating new pricerConfig.json');
        pricerConfig = {};
      }

      // Update API settings - use correct property names
      if (req.body.steam_api_key) {
        config.steamAPIKey = req.body.steam_api_key;
      }
      if (req.body.bptf_api_key) {
        config.bptfAPIKey = req.body.bptf_api_key;
      }
      if (req.body.bptf_token) {
        config.bptfToken = req.body.bptf_token;
      }

      // Update database settings - use correct structure
      if (!config.database) {
        config.database = {};
      }
      config.database.host = req.body.db_host || 'localhost';
      config.database.port = parseInt(req.body.db_port) || 5432;
      config.database.name = req.body.db_name || 'bptf-autopricer';
      config.database.user = req.body.db_user || 'postgres';
      config.database.schema = req.body.db_schema || 'tf2';
      if (req.body.db_password) {
        config.database.password = req.body.db_password;
      }

      // Update application settings
      config.pricerPort = parseInt(req.body.pricer_port) || 3456;
      config.minSellMargin = parseFloat(req.body.min_sell_margin) || 0.11;

      // Update SCM margins
      config.scmMarginBuy = parseFloat(req.body.scm_margin_buy) || 0;
      config.scmMarginSell = parseFloat(req.body.scm_margin_sell) || 0;

      // Update price swing limits
      if (!config.priceSwingLimits) {
        config.priceSwingLimits = {};
      }
      config.priceSwingLimits.maxBuyIncrease = parseFloat(req.body.max_buy_increase) || 0.1;
      config.priceSwingLimits.maxSellDecrease = parseFloat(req.body.max_sell_decrease) || 0.1;

      // Update max percentage differences
      if (!config.maxPercentageDifferences) {
        config.maxPercentageDifferences = {};
      }
      config.maxPercentageDifferences.buy = parseFloat(req.body.max_percentage_diff_buy) ?? 5;
      config.maxPercentageDifferences.sell = parseFloat(req.body.max_percentage_diff_sell) ?? -8;

      // Update trading settings
      config.usePriceDbFallback = req.body.use_pricedb_fallback === 'on';
      config.useScmFallback = req.body.use_scm_fallback === 'on';

      // Update excluded Steam IDs
      if (req.body.excluded_steam_ids) {
        config.excludedSteamIDs = req.body.excluded_steam_ids
          .split('\n')
          .map((id) => id.trim())
          .filter((id) => id.length > 0 && /^[0-9]{17}$/.test(id));
      } else {
        config.excludedSteamIDs = [];
      }

      // Update trusted Steam IDs
      if (req.body.trusted_steam_ids) {
        config.trustedSteamIDs = req.body.trusted_steam_ids
          .split('\n')
          .map((id) => id.trim())
          .filter((id) => id.length > 0 && /^[0-9]{17}$/.test(id));
      } else {
        config.trustedSteamIDs = [];
      }

      // Update excluded listing descriptions
      if (req.body.excluded_descriptions) {
        config.excludedListingDescriptions = req.body.excluded_descriptions
          .split('\n')
          .map((desc) => desc.trim())
          .filter((desc) => desc.length > 0);
      } else {
        config.excludedListingDescriptions = [];
      }

      // Update bot owner Steam IDs
      let ownerIds = req.body.bot_owner_ids || [];
      if (typeof ownerIds === 'string') {
        ownerIds = [ownerIds];
      }
      // Filter out empty entries and validate Steam ID format
      config.botOwnerSteamIDs = ownerIds
        .filter((id) => id && id.trim().length > 0)
        .map((id) => id.trim())
        .filter((id) => /^[0-9]{17}$/.test(id)); // Basic Steam ID validation

      // Update websocket relay settings
      if (!config.websocketRelay) {
        config.websocketRelay = {};
      }
      config.websocketRelay.enabled = req.body.relay_enabled === 'on';
      config.websocketRelay.protocol = req.body.relay_protocol || 'ws';
      config.websocketRelay.host = req.body.relay_host || 'localhost';
      config.websocketRelay.port = parseInt(req.body.relay_port) || 7789;

      // Update pricer config settings
      pricerConfig.port = parseInt(req.body.web_port) || 3000;
      pricerConfig.ageThresholdSec = parseInt(req.body.age_threshold) || 7200;
      pricerConfig.pm2ProcessName = req.body.pm2_process_name || 'tf2autobot';

      // Save configurations
      baseConfig.saveConfig(config);
      saveJson(pricerConfigPath, pricerConfig);

      // Redirect with success message
      res.redirect('/settings?success=1');
    } catch (error) {
      console.error('Settings update error:', error);
      res.redirect('/settings?error=1');
    }
  });

  app.use('/settings', router);
};
