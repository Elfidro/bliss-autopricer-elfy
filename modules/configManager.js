const fs = require('fs');
const path = require('path');
const BotDiscovery = require('./botDiscovery');
const { loadJson, saveJson } = require('./utils');

/**
 * Enhanced Configuration Manager
 * Handles both traditional single-bot and multi-bot configurations
 */
class ConfigManager {
  constructor(configPath) {
    this.configPath = configPath;
    this.discovery = new BotDiscovery();
    this.config = this.loadOrCreateConfig();
  }

  /**
   * Load existing config or create a new one with auto-discovery
   */
  loadOrCreateConfig() {
    try {
      // Try to load existing config
      if (fs.existsSync(this.configPath)) {
        const config = loadJson(this.configPath);

        // If it's the old format, migrate it
        if (config.tf2AutobotDir && config.botTradingDir) {
          return this.migrateOldConfig(config);
        }

        return config;
      }
    } catch (err) {
      console.warn('Error loading config, creating new one:', err.message);
    }

    // Create new config with auto-discovery
    return this.createConfigWithDiscovery();
  }

  /**
   * Migrate old single-bot config to new multi-bot format
   * @param oldConfig
   */
  migrateOldConfig(oldConfig) {
    console.log('🔄 Migrating old configuration format...');

    const newConfig = {
      version: '2.0',
      port: oldConfig.port || 3000,
      ageThresholdSec: oldConfig.ageThresholdSec || 7200,
      pm2ProcessName: oldConfig.pm2ProcessName || 'tf2autobot',
      bots: [],
      selectedBot: null,
      migration: {
        migratedFrom: 'v1.0',
        migratedAt: new Date().toISOString(),
        originalConfig: oldConfig,
      },
    };

    // Try to convert the old config to a bot entry
    const tf2autobotPath = path.resolve(oldConfig.tf2AutobotDir);
    const botPath = path.resolve(tf2autobotPath, oldConfig.botTradingDir);

    if (fs.existsSync(botPath)) {
      newConfig.bots.push({
        id: 'migrated_bot',
        name: 'Migrated Bot',
        tf2autobotPath,
        botDirectory: oldConfig.botTradingDir,
        botPath,
        pricelistPath: path.join(botPath, 'pricelist.json'),
        enabled: true,
        source: 'migration',
      });
      newConfig.selectedBot = 'migrated_bot';
    }

    // Backup old config
    const backupPath = this.configPath + '.v1.backup';
    saveJson(backupPath, oldConfig);
    console.log(`Old config backed up to: ${backupPath}`);

    this.saveConfig(newConfig);
    return newConfig;
  }

  /**
   * Create new config with auto-discovery
   */
  createConfigWithDiscovery() {
    console.log('🆕 Creating new configuration with auto-discovery...');

    const discoveryResults = this.discovery.discover();

    const config = {
      version: '2.0',
      port: process.env.PRICE_WATCHER_PORT || 3000,
      ageThresholdSec: 7200,
      pm2ProcessName: 'tf2autobot',
      bots: [],
      selectedBot: null,
      discovery: {
        lastRun: new Date().toISOString(),
        results: discoveryResults.summary,
      },
    };

    // Add discovered bots
    for (const bot of discoveryResults.bots) {
      config.bots.push({
        ...bot,
        enabled: true,
        source: 'discovery',
      });
    }

    // Select the first bot if available
    if (config.bots.length > 0) {
      config.selectedBot = config.bots[0].id;
      console.log(`Auto-selected bot: ${config.bots[0].name}`);
    }

    this.saveConfig(config);
    return config;
  }

  /**
   * Get current selected bot configuration
   */
  getSelectedBot() {
    if (!this.config.selectedBot) {
      return null;
    }

    return this.config.bots.find((bot) => bot.id === this.config.selectedBot);
  }

  /**
   * Get all available bots
   */
  getAllBots() {
    return this.config.bots.filter((bot) => bot.enabled);
  }

  /**
   * Select a different bot
   * @param botId
   */
  selectBot(botId) {
    const bot = this.config.bots.find((b) => b.id === botId);
    if (!bot) {
      throw new Error(`Bot with ID "${botId}" not found`);
    }

    this.config.selectedBot = botId;
    this.saveConfig(this.config);
    console.log(`Selected bot: ${bot.name}`);
    return bot;
  }

  /**
   * Add a new bot manually with direct paths
   * @param botConfig
   */
  addBot(botConfig) {
    const bot = {
      id: `manual_${Date.now()}`,
      name: botConfig.name || 'Manual Bot',
      polldataPath: botConfig.polldataPath,
      pricelistPath: botConfig.pricelistPath,
      steamId: botConfig.steamId,
      enabled: true,
      source: 'manual',
      ...botConfig,
    };

    this.config.bots.push(bot);
    this.saveConfig(this.config);
    return bot;
  }

  /**
   * Remove a bot
   * @param botId
   */
  removeBot(botId) {
    const index = this.config.bots.findIndex((b) => b.id === botId);
    if (index === -1) {
      throw new Error(`Bot with ID "${botId}" not found`);
    }

    this.config.bots.splice(index, 1);

    // If we removed the selected bot, select another one
    if (this.config.selectedBot === botId) {
      this.config.selectedBot = this.config.bots.length > 0 ? this.config.bots[0].id : null;
    }

    this.saveConfig(this.config);
  }

  /**
   * Re-run discovery to find new bots
   */
  rediscover() {
    console.log('🔄 Re-running bot discovery...');

    const discoveryResults = this.discovery.discover();

    // Add newly discovered bots (avoid duplicates)
    // Check for duplicates using pricelistPath or steamId
    const existingBots = new Set(
      this.config.bots.map((bot) => bot.pricelistPath || bot.steamId).filter(Boolean)
    );

    let addedCount = 0;
    for (const bot of discoveryResults.bots) {
      const identifier = bot.pricelistPath || bot.steamId;
      if (identifier && !existingBots.has(identifier)) {
        this.config.bots.push({
          id: bot.id,
          name: bot.name,
          steamId: bot.steamId,
          polldataPath: bot.polldataPath,
          pricelistPath: bot.pricelistPath,
          enabled: true,
          source: 'discovery',
        });
        addedCount++;
        console.log(`✅ Added discovered bot: ${bot.name} (${bot.steamId})`);
      }
    }

    console.log(`📊 Discovery complete: Found ${discoveryResults.bots.length} bots, added ${addedCount} new bots`);

    this.config.discovery = {
      lastRun: new Date().toISOString(),
      results: discoveryResults.summary,
    };

    this.saveConfig(this.config);
    return discoveryResults;
  }

  /**
   * Get legacy config format for backward compatibility
   */
  getLegacyConfig() {
    const selectedBot = this.getSelectedBot();

    if (!selectedBot) {
      throw new Error('No bot selected. Please select a bot first.');
    }

    return {
      pm2ProcessName: this.config.pm2ProcessName,
      tf2AutobotDir: selectedBot.tf2autobotPath,
      botTradingDir: selectedBot.botDirectory,
      port: this.config.port,
      ageThresholdSec: this.config.ageThresholdSec,
    };
  }

  /**
   * Save configuration to file
   * @param config
   */
  saveConfig(config) {
    saveJson(this.configPath, config || this.config);
  }

  /**
   * Get configuration summary for display
   */
  getSummary() {
    const selectedBot = this.getSelectedBot();

    return {
      version: this.config.version,
      totalBots: this.config.bots.length,
      activeBots: this.getAllBots().length,
      selectedBot: selectedBot
        ? {
            id: selectedBot.id,
            name: selectedBot.name,
            path: selectedBot.botPath,
          }
        : null,
      lastDiscovery: this.config.discovery?.lastRun,
    };
  }
}

module.exports = ConfigManager;
