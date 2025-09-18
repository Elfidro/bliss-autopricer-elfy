# Bliss Autopricer

[![npm version](https://img.shields.io/npm/v/pg-promise?label=pg-promise)](https://www.npmjs.com/package/pg-promise)
[![Node.js](https://img.shields.io/badge/node-%3E=22.0.0-brightgreen)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-%3E=12-blue)](https://www.postgresql.org/)
[![ESLint](https://img.shields.io/badge/code_style-ESLint-blueviolet)](https://eslint.org/)
[![Prettier](https://img.shields.io/badge/code_style-Prettier-ff69b4)](https://prettier.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<div align="center">
  <img src="https://github.com/jack-richards/bptf-autopricer/assets/58331725/203fe808-30ff-4d7d-868c-a3ef6d31497d" alt="Bliss Autopricer Logo" style="width: 280px; height: 320px;">
</div>

An advanced TF2 item pricing system that uses live backpack.tf listings and Steam Community Market data to generate intelligent, profitable prices for TF2Autobot. This enhanced fork builds upon [Jack Richards' excellent original autopricer](https://github.com/jack-richards/bptf-autopricer) with significant improvements to reliability, multi-bot support, and pricing intelligence.

## 🚀 Quick Start

```bash
# 1. Clone and install
git clone https://github.com/OliverPerring/bliss-autopricer.git
cd bliss-autopricer
npm install

# 2. Setup bot configuration (auto-discovers your bots)
npm run setup

# 3. Initialize database
npm run validate-config

# 4. Start the autopricer
npm start
```

Visit the web interface at `http://localhost:3000` to manage your pricing!

## ✨ What's New in This Fork

### 🏆 Major Enhancements Over Jack's Original

- **🤖 Multi-Bot Management**: Seamlessly manage multiple TF2Autobot instances with automatic discovery
- **📊 Enhanced Pricing Intelligence**: Pure backpack.tf + Steam Community Market pricing (no more prices.tf dependency)
- **🔄 Bulletproof WebSocket**: Automatic connection recovery with health monitoring
- **⚡ One-Command Setup**: Intelligent configuration wizard that finds your bots automatically
- **🎯 Advanced Fallback System**: SCM pricing for items with insufficient listing data
- **💾 Configuration Migration**: Automatically upgrades old configurations to the new multi-bot system
- **🔌 WebSocket Relay Support**: Connect through internal relay server for multiple instance deployments

### 🙏 Attribution

**Huge thanks to [Jack Richards](https://github.com/jack-richards)** for creating the original [bptf-autopricer](https://github.com/jack-richards/bptf-autopricer)! This fork builds upon his excellent foundation with enhanced features for modern TF2 trading needs.

## 🎯 Key Features

### Intelligent Pricing System

- **📈 Live Listing Analysis**: Real-time backpack.tf listing data processing
- **💰 Steam Community Market Integration**: SCM fallback pricing for rare/illiquid items
- **🎪 Unusual Support**: Full pricing support for unusual items and special attributes
- **🛡️ Profit Protection**: Configurable margins and sanity checks
- **🔍 Outlier Detection**: Automatic filtering of suspicious listings

### Advanced Bot Management

- **🔍 Auto-Discovery**: Finds all TF2Autobot installations automatically
- **🔄 Easy Switching**: Switch between bots with a single click
- **📊 Unified Dashboard**: Manage all your bots from one interface
- **⚙️ Configuration Backup**: Safe configuration migration and backup

### Reliability & Performance

- **🔌 WebSocket Health Monitoring**: Real-time connection status tracking
- **♻️ Auto-Recovery**: Automatic reconnection when connections fail
- **⚡ Rate Limiting**: Intelligent API request management
- **📦 Batch Processing**: Efficient handling of large item lists

## 📋 Requirements

- **Node.js** v22.0.0+ (required for built-in fetch support)
- **PostgreSQL** v12+
- **TF2Autobot** (any recent version)
- **API Keys**: backpack.tf API key and Steam API key

## 📖 Documentation

- **[📦 Installation Guide](docs/INSTALLATION.md)** - Complete setup instructions
- **[🤖 Multi-Bot Setup](docs/MULTI-BOT.md)** - Managing multiple bots
- **[⚙️ Configuration Reference](docs/CONFIGURATION.md)** - All configuration options
- **[🔧 Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[📡 API Documentation](docs/API.md)** - REST API and WebSocket usage

## 🏗️ Architecture

### Pricing Logic Flow

1. **Live Listings**: Analyze backpack.tf buy/sell listings from trusted sources
2. **Steam Community Market**: Fallback to SCM prices with configurable margins
3. **Sanity Checks**: Validate prices against configured thresholds
4. **Profit Margins**: Apply buy/sell spreads for profitable trading
5. **TF2Autobot Integration**: Seamless pricelist updates via Socket.IO

### Multi-Bot System

```
Bliss Autopricer
├── Bot Discovery Engine
├── Configuration Manager
├── Pricing Engine
├── WebSocket Manager
└── Web Interface
    ├── Bot Selection
    ├── Price Monitoring
    ├── Configuration
    └── Health Dashboard
```

## 🔧 API Keys Setup

You'll need these API keys for full functionality:

1. **Backpack.tf API Key**: Get from [backpack.tf/api/register](https://backpack.tf/api/register)
2. **Steam API Key**: Get from [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)

⚠️ **Important**: Without proper API keys, you may encounter 403 errors. The setup wizard will help you configure these correctly.

## 📊 Web Interface

The web dashboard provides:

- **📋 Pricelist Management**: View and edit item prices
- **🤖 Bot Configuration**: Switch between multiple bots
- **📈 Price Analytics**: Monitor pricing performance
- **🔗 WebSocket Status**: Real-time connection health
- **📊 Trade Statistics**: P&L tracking and analytics

## 🔄 Updating Your Installation

If you've already cloned the repository and want to update to the latest version:

```bash
cd bliss-autopricer
git pull origin
npm install
```

Your configuration files (`pricerConfig.json`, `files/`) will be preserved during updates.

## 🔌 WebSocket Relay Configuration

For deployments with multiple autopricer instances, you can use the [backpack-tf-socket-relay](https://github.com/OliverPerring/backpack-tf-socket-relay) to share a single websocket connection to backpack.tf.

### Setup Relay Mode

1. **Start your relay server** (default port 7789):

   ```bash
   # In your relay server directory
   npm start
   ```

2. **Configure autopricer** via web interface at `/settings` or manually in `config.json`:

   ```json
   {
     "websocketRelay": {
       "enabled": true,
       "protocol": "ws",
       "host": "localhost",
       "port": 7789
     }
   }
   ```

3. **Restart autopricer** to use relay connection

The autopricer will connect to `ws://localhost:7789/relay` when relay mode is enabled.

### Benefits of Relay Mode

- **Multiple Instances**: Run several autopricing instances with one backpack.tf connection
- **Reduced API Load**: Single websocket connection shared across all instances
- **Better Reliability**: Centralized connection management with automatic failover
- **Compliance**: Respects backpack.tf's single connection per API key limitation

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚡ Support

- **🐛 Bug Reports**: [Open an issue](https://github.com/OliverPerring/bliss-autopricer/issues)
- **💡 Feature Requests**: [Submit a suggestion](https://github.com/OliverPerring/bliss-autopricer/issues)
- **📖 Documentation**: Check the [docs](docs/) folder

---

<div align="center">

**Built with ❤️ for the TF2 trading community**

_Continuing Jack Richards' Pricer with modern enhancements_

</div>
