const express = require('express');
const renderPage = require('../layout');

module.exports = function (app, configManager) {
  const router = express.Router();

  // Bot Configuration Dashboard
  router.get('/', (req, res) => {
    const summary = configManager.getSummary();
    const allBots = configManager.getAllBots();
    const selectedBot = configManager.getSelectedBot();

    let html = '<div style="max-width: 1560px; margin: 0 auto;">';

    // Header
    html += `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
        <div>
          <h1 style="font-size: 1.9rem; font-weight: 800; margin-bottom: 6px; display: flex; align-items: center; gap: 12px;">
            <span>🤖</span> Bot Configuration Manager
          </h1>
          <p style="margin: 0; font-size: 0.95rem; color: var(--text-muted);">
            Manage your tf2autobot installations, inspect direct file bindings, and seamlessly switch active trading bots.
          </p>
        </div>
        <div style="display: flex; gap: 10px;">
          <a href="/bot-config/discover" class="btn btn-primary"><span>🔍</span> Re-scan for Bots</a>
          <a href="/bot-config/add" class="btn btn-success"><span>➕</span> Add Bot Manually</a>
          <a href="/bot-config/export" class="btn btn-secondary"><span>📤</span> Export Config</a>
        </div>
      </div>
    `;

    // Summary Statistics Grid
    html += `
      <div class="stats-grid">
        <div class="stat-card stat-info">
          <div class="stat-top">
            <span class="stat-title">Discovered Bots</span>
            <div class="stat-icon-wrapper">🤖</div>
          </div>
          <div class="stat-value">${summary.totalBots}</div>
          <p class="stat-desc">Total installations registered</p>
        </div>

        <div class="stat-card stat-ok">
          <div class="stat-top">
            <span class="stat-title">Active Bots</span>
            <div class="stat-icon-wrapper">⚡</div>
          </div>
          <div class="stat-value">${summary.activeBots}</div>
          <p class="stat-desc">Running and ready for trading</p>
        </div>

        <div class="stat-card stat-warn">
          <div class="stat-top">
            <span class="stat-title">Config Version</span>
            <div class="stat-icon-wrapper">📋</div>
          </div>
          <div class="stat-value" style="font-size: 1.8rem;">${summary.version || 'v2.0'}</div>
          <p class="stat-desc">Schema architecture</p>
        </div>

        <div class="stat-card stat-ok">
          <div class="stat-top">
            <span class="stat-title">Active Bot Status</span>
            <div class="stat-icon-wrapper">✅</div>
          </div>
          <div class="stat-value" style="font-size: 1.3rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${summary.selectedBot ? summary.selectedBot.name : 'None Selected'}
          </div>
          <p class="stat-desc">${summary.selectedBot ? summary.selectedBot.id : 'Requires selection'}</p>
        </div>
      </div>
    `;

    if (summary.selectedBot) {
      html += `
        <div class="ui-card" style="padding: 16px 20px; margin-bottom: 24px; border-left: 4px solid var(--ok);">
          <div style="font-size: 0.9rem; color: var(--text-muted);">
            Active Bot Path: <code style="margin-left: 6px;">${summary.selectedBot.path}</code>
          </div>
        </div>
      `;
    }

    if (allBots.length === 0) {
      html += `
        <div class="ui-card" style="text-align: center; padding: 48px 24px;">
          <div style="font-size: 40px; margin-bottom: 12px;">🤖</div>
          <h3 style="margin: 0 0 8px 0;">No Bots Discovered</h3>
          <p style="color: var(--text-muted); max-width: 500px; margin: 0 auto 20px auto;">
            No tf2autobot instances were detected automatically. Provide direct file paths to configure your trading bot.
          </p>
          <a href="/bot-config/add" class="btn btn-success"><span>➕</span> Configure Bot Manually</a>
        </div>
      `;
    } else {
      html += `
        <div class="table-container">
          <div class="table-header-bar">
            <div>
              <h3 style="margin: 0;"><span>🤖</span> Available Bot Instances</h3>
              <p style="margin: 4px 0 0 0; color: var(--text-muted);">Switch active pricelist tracking between registered tf2autobot bots</p>
            </div>
            <span class="badge badge-info">${allBots.length} registered</span>
          </div>
          <div style="overflow-x: auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="width: 14%;">Status</th>
                  <th style="width: 22%;">Bot Name</th>
                  <th style="width: 18%;">Steam ID</th>
                  <th style="width: 28%;">Pricelist / Storage Path</th>
                  <th style="width: 18%; text-align: center;">Actions</th>
                </tr>
              </thead>
              <tbody>
      `;

      allBots.forEach((bot) => {
        const isSelected = selectedBot && selectedBot.id === bot.id;
        html += `<tr class="${isSelected ? 'row-current' : ''}">`;
        html += `<td>${isSelected ? '<span class="badge badge-ok">● Active Bot</span>' : '<span class="badge badge-muted">○ Available</span>'}</td>`;
        html += `<td><strong>${bot.name || 'Unnamed Bot'}</strong></td>`;
        html += `<td><code class="sku-badge">${bot.steamId || 'Unknown'}</code></td>`;
        html += `<td><small style="color: var(--text-muted);"><code>${bot.pricelistPath || bot.botPath || 'Not configured'}</code></small></td>`;
        html += '<td style="text-align: center;">';

        if (!isSelected) {
          html += `<a href="/bot-config/select?id=${encodeURIComponent(bot.id)}" class="btn-icon-action act-add" style="margin-right: 6px;">Select Bot</a>`;
        }

        if (bot.source === 'manual') {
          html += `<a href="/bot-config/remove?id=${encodeURIComponent(bot.id)}" class="btn-icon-action act-remove" onclick="return confirm('Remove this bot configuration?')">✕ Remove</a>`;
        }

        html += '</td>';
        html += '</tr>';
      });

      html += `
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // Migration Notice
    if (configManager.config.migration) {
      html += `
        <div class="ui-card" style="border-left: 4px solid var(--accent); padding: 18px 24px;">
          <h4 style="margin: 0 0 6px 0;">📋 Architecture Migration Notice</h4>
          <p style="margin: 0; font-size: 0.88rem; color: var(--text-muted);">
            Configuration was migrated from version ${configManager.config.migration.migratedFrom} on ${new Date(configManager.config.migration.migratedAt).toLocaleString()}. Multi-bot profile switching is active.
          </p>
        </div>
      `;
    }

    html += '</div>';

    res.send(renderPage('Bot Configuration', html));
  });

  // Discover/Re-scan for bots
  router.get('/discover', (req, res) => {
    try {
      const results = configManager.rediscover();
      const newBots = results.bots.length;

      let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
      html +=
        '<div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 8px; text-align: center;">';
      html += '<h2>🔍 Bot Discovery Complete</h2>';
      html += `<p><strong>Found ${results.installations.length} tf2autobot installation(s)</strong></p>`;
      html += `<p><strong>Found ${newBots} bot configuration(s)</strong></p>`;
      html += `<p><strong>Found ${results.processes.length} running process(es)</strong></p>`;
      html +=
        '<p><a href="/bot-config" style="background: #007cba; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">← Back to Bot Configuration</a></p>';
      html += '</div>';
      html += '</div>';

      res.send(renderPage('Discovery Complete', html));
    } catch (err) {
      res.status(500).send(renderPage('Error', `<p>Discovery failed: ${err.message}</p>`));
    }
  });

  // Select a bot
  router.get('/select', (req, res) => {
    try {
      const botId = req.query.id;
      if (!botId) {
        return res.status(400).send(renderPage('Error', '<p>Bot ID is required</p>'));
      }

      const bot = configManager.selectBot(botId);

      let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
      html +=
        '<div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 8px; text-align: center;">';
      html += '<h2>✅ Bot Selected</h2>';
      html += `<p><strong>${bot.name}</strong> is now the active bot.</p>`;
      html += `<p>Path: <code>${bot.botPath}</code></p>`;
      html +=
        '<p><a href="/bot-config" style="background: #007cba; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">← Back to Bot Configuration</a></p>';
      html += '</div>';
      html += '</div>';

      res.send(renderPage('Bot Selected', html));
    } catch (err) {
      res.status(500).send(renderPage('Error', `<p>Failed to select bot: ${err.message}</p>`));
    }
  });

  // Add bot manually form
  router.get('/add', (req, res) => {
    let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
    html += '<h2>➕ Configure Bot Paths</h2>';
    html +=
      '<p>Enter the direct paths to your bot configuration files. Both paths are required.</p>';
    html +=
      '<div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 8px; margin-bottom: 20px;">';
    html +=
      '<strong>⚠️ Note:</strong> Auto-discovery has been removed for reliability. Please provide exact file paths.';
    html += '</div>';

    html +=
      '<form method="POST" style="background: white; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">';
    html += '<div style="margin-bottom: 15px;">';
    html +=
      '<label for="name" style="display: block; margin-bottom: 5px; font-weight: bold;">Bot Name:</label>';
    html +=
      '<input type="text" id="name" name="name" required style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" placeholder="My Trading Bot">';
    html += '<small style="color: #666;">A display name for this bot configuration</small>';
    html += '</div>';

    html += '<div style="margin-bottom: 15px;">';
    html +=
      '<label for="polldataPath" style="display: block; margin-bottom: 5px; font-weight: bold;">⚠️ Direct Path to polldata.json:</label>';
    html +=
      '<input type="text" id="polldataPath" name="polldataPath" required style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" placeholder="C:\\tf2autobot\\files\\mybot\\polldata.json">';
    html +=
      '<small style="color: #666;"><strong>Full absolute path</strong> to your bot\'s polldata.json file (e.g., C:\\tf2autobot\\files\\mybot\\polldata.json)</small>';
    html += '</div>';

    html += '<div style="margin-bottom: 15px;">';
    html +=
      '<label for="pricelistPath" style="display: block; margin-bottom: 5px; font-weight: bold;">⚠️ Direct Path to pricelist.json:</label>';
    html +=
      '<input type="text" id="pricelistPath" name="pricelistPath" required style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" placeholder="C:\\tf2autobot\\files\\mybot\\pricelist.json">';
    html +=
      '<small style="color: #666;"><strong>Full absolute path</strong> to your bot\'s pricelist.json file (e.g., C:\\tf2autobot\\files\\mybot\\pricelist.json)</small>';
    html += '</div>';

    html += '<div style="margin-bottom: 15px;">';
    html +=
      '<label for="steamId" style="display: block; margin-bottom: 5px; font-weight: bold;">Steam ID (optional):</label>';
    html +=
      '<input type="text" id="steamId" name="steamId" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" placeholder="76561198012345678">';
    html += '<small style="color: #666;">Your bot\'s Steam ID for reference</small>';
    html += '</div>';

    html += '<div style="margin-top: 20px;">';
    html +=
      '<button type="submit" style="background: #28a745; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px;">Add Bot Configuration</button>';
    html +=
      '<a href="/bot-config" style="background: #6c757d; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Cancel</a>';
    html += '</div>';
    html += '</form>';
    html += '</div>';

    res.send(renderPage('Add Bot Manually', html));
  });

  // Add bot manually POST
  router.post('/add', (req, res) => {
    try {
      const { name, polldataPath, pricelistPath, steamId } = req.body;

      if (!name || !polldataPath || !pricelistPath) {
        return res
          .status(400)
          .send(
            renderPage(
              'Error',
              '<p>Bot name, polldata.json path, and pricelist.json path are all required</p>'
            )
          );
      }

      // Validate that paths exist
      const fs = require('fs');
      if (!fs.existsSync(polldataPath)) {
        return res
          .status(400)
          .send(renderPage('Error', `<p>polldata.json not found at: ${polldataPath}</p>`));
      }
      if (!fs.existsSync(pricelistPath)) {
        return res
          .status(400)
          .send(renderPage('Error', `<p>pricelist.json not found at: ${pricelistPath}</p>`));
      }

      const bot = configManager.addBot({
        name,
        polldataPath,
        pricelistPath,
        steamId: steamId || undefined,
      });

      let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
      html +=
        '<div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 8px; text-align: center;">';
      html += '<h2>✅ Bot Added Successfully</h2>';
      html += `<p><strong>${bot.name}</strong> has been added to your configuration.</p>`;
      html += `<p>Polldata: <code>${polldataPath}</code></p>`;
      html += `<p>Pricelist: <code>${pricelistPath}</code></p>`;
      html +=
        '<p><a href="/bot-config" style="background: #007cba; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">← Back to Bot Configuration</a></p>';
      html += '</div>';
      html += '</div>';

      res.send(renderPage('Bot Added', html));
    } catch (err) {
      res
        .status(500)
        .send(
          renderPage(
            'Error',
            `<p>Failed to add bot: ${err instanceof Error ? err.message : String(err)}</p>`
          )
        );
    }
  });

  // Remove bot
  router.get('/remove', (req, res) => {
    try {
      const botId = req.query.id;
      if (!botId) {
        return res.status(400).send(renderPage('Error', '<p>Bot ID is required</p>'));
      }

      const removedBot = configManager.removeBot(botId);

      let html = '<div style="max-width: 800px; margin: 0 auto; padding: 20px;">';
      html +=
        '<div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 8px; text-align: center;">';
      html += '<h2>✅ Bot Removed</h2>';
      html += `<p><strong>${removedBot?.name || 'Bot'}</strong> has been removed from your configuration.</p>`;
      html +=
        '<p><a href="/bot-config" style="background: #007cba; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px;">← Back to Bot Configuration</a></p>';
      html += '</div>';
      html += '</div>';

      res.send(renderPage('Bot Removed', html));
    } catch (err) {
      res.status(500).send(renderPage('Error', `<p>Failed to remove bot: ${err.message}</p>`));
    }
  });

  // Export configuration
  router.get('/export', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="bot-config-export.json"');
    res.send(JSON.stringify(configManager.config, null, 2));
  });

  app.use('/bot-config', router);
};
