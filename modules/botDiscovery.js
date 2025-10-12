const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Bot Auto-Discovery System
 * Automatically finds tf2autobot installations and bot configurations
 */
class BotDiscovery {
  constructor() {
    this.discoveredBots = [];
    this.tf2autobotPaths = [];
  }

  /**
   * Find all potential tf2autobot installations
   */
  findTf2AutobotInstallations() {
    const searchPaths = [
      // Common installation locations
      '../../tf2autobot',
      '../../../tf2autobot',
      '../../../../tf2autobot',
      '../tf2autobot',
      './tf2autobot',
      // Common versioned installations
      '../../tf2autobot-5.*',
      '../../../tf2autobot-5.*',
      // Environment-based paths
      process.env.TF2AUTOBOT_DIR,
      process.env.HOME ? path.join(process.env.HOME, 'tf2autobot') : null,
      process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'tf2autobot') : null,
    ].filter(Boolean);

    const found = [];

    for (const searchPath of searchPaths) {
      try {
        // Handle glob patterns for versioned directories
        if (searchPath.includes('*')) {
          const basePath = searchPath.split('*')[0];
          const parentDir = path.dirname(basePath);
          const prefix = path.basename(basePath);

          if (fs.existsSync(parentDir)) {
            const dirs = fs
              .readdirSync(parentDir)
              .filter((dir) => dir.startsWith(prefix))
              .map((dir) => path.join(parentDir, dir));
            found.push(...dirs);
          }
        } else {
          const resolvedPath = path.resolve(searchPath);
          if (fs.existsSync(resolvedPath)) {
            found.push(resolvedPath);
          }
        }
      } catch (err) {
        // Silently skip invalid paths
      }
    }

    // Validate that these are actually tf2autobot installations
    this.tf2autobotPaths = found.filter((dir) => this.isTf2AutobotInstallation(dir));
    return this.tf2autobotPaths;
  }

  /**
   * Check if a directory is a valid tf2autobot installation
   * @param dirPath
   */
  isTf2AutobotInstallation(dirPath) {
    try {
      const packageJsonPath = path.join(dirPath, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        return false;
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      return (
        packageJson.name === 'tf2autobot' ||
        packageJson.dependencies?.['tf2-schema'] ||
        packageJson.dependencies?.['@tf2autobot/tf2-schema']
      );
    } catch {
      return false;
    }
  }

  /**
   * Find all bot configurations within tf2autobot installations
   */
  findBotConfigurations() {
    const bots = [];

    for (const tf2autobotPath of this.tf2autobotPaths) {
      try {
        const filesDir = path.join(tf2autobotPath, 'files');
        if (!fs.existsSync(filesDir)) {
          continue;
        }

        // Look for bot directories (usually contain 'config.json' or 'pricelist.json')
        const botDirs = fs
          .readdirSync(filesDir, { withFileTypes: true })
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => dirent.name);

        for (const botDir of botDirs) {
          const botPath = path.join(filesDir, botDir);
          const configPath = path.join(botPath, 'config.json');
          const pricelistPath = path.join(botPath, 'pricelist.json');
          const polldataPath = path.join(botPath, 'polldata.json');

          if (fs.existsSync(configPath) || fs.existsSync(pricelistPath)) {
            let botName = botDir;
            let steamId = null;

            // Try to get bot name and steam ID from config
            if (fs.existsSync(configPath)) {
              try {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                botName = config.name || config.botName || botDir;
                steamId = config.steamid || config.steamId;
              } catch {
                // Use directory name as fallback
              }
            }

            // Add bots that have at least pricelist.json
            // polldata.json is optional (may not exist until bot runs)
            if (fs.existsSync(pricelistPath)) {
              bots.push({
                id: `${path.basename(tf2autobotPath)}_${botDir}`,
                name: botName,
                steamId,
                polldataPath: fs.existsSync(polldataPath) ? polldataPath : null,
                pricelistPath,
                // Keep legacy fields for backward compatibility display
                tf2autobotPath,
                botDirectory: botDir,
                botPath,
              });
            }
          }
        }
      } catch (err) {
        console.warn(`Error scanning tf2autobot installation at ${tf2autobotPath}:`, err.message);
      }
    }

    this.discoveredBots = bots;
    return bots;
  }

  /**
   * Get running PM2 processes that look like tf2autobot instances
   */
  getRunningBotProcesses() {
    try {
      const pm2List = execSync('pm2 list -m', { encoding: 'utf8', stdio: 'pipe' });
      const processes = [];

      // Parse PM2 output to find bot processes
      const lines = pm2List.split('\n');
      for (const line of lines) {
        if (line.includes('tf2autobot') || line.includes('bot')) {
          const parts = line.split('│').map((p) => p.trim());
          if (parts.length >= 3) {
            processes.push({
              name: parts[1],
              status: parts[2],
              id: parts[0],
            });
          }
        }
      }

      return processes;
    } catch {
      // PM2 not available or no processes
      return [];
    }
  }

  /**
   * Perform full discovery
   */
  discover() {
    console.log('🔍 Discovering tf2autobot installations...');
    const installations = this.findTf2AutobotInstallations();
    console.log(`Found ${installations.length} tf2autobot installation(s)`);

    console.log('🤖 Discovering bot configurations...');
    const bots = this.findBotConfigurations();
    console.log(`Found ${bots.length} bot configuration(s)`);

    console.log('⚡ Checking running processes...');
    const processes = this.getRunningBotProcesses();
    console.log(`Found ${processes.length} running bot process(es)`);

    return {
      installations,
      bots,
      processes,
      summary: {
        totalInstallations: installations.length,
        totalBots: bots.length,
        runningProcesses: processes.length,
      },
    };
  }
}

module.exports = BotDiscovery;
