# ⚙️ Configuration Reference

Complete reference for all Bliss Autopricer configuration options.

## Main Configuration File (`pricerConfig.json`)

### Basic Structure

```json
{
  "selectedBot": "main-bot",
  "bots": {
    "main-bot": {
      "name": "Main Trading Bot",
      "polldataPath": "C:/tf2autobot/files/main-bot/polldata.json",
      "pricelistPath": "C:/tf2autobot/files/main-bot/pricelist.json",
      "steamId": "76561198012345678",
      "description": "Primary trading bot"
    }
  },
  "database": {
    "host": "localhost",
    "port": 5432,
    "database": "tf2autopricer",
    "user": "autopricer",
    "password": "your_secure_password"
  },
  "port": 3000,
  "ageThresholdSec": 7200
}
```

## Configuration Options

### Global Settings

| Option            | Type   | Default | Description                                           |
| ----------------- | ------ | ------- | ----------------------------------------------------- |
| `selectedBot`     | string | `null`  | ID of currently active bot                            |
| `port`            | number | `3000`  | Web interface port                                    |
| `ageThresholdSec` | number | `7200`  | Time in seconds before prices are considered outdated |

### Bot Configuration

⚠️ **Breaking Change**: Bot configuration now requires direct file paths instead of installation directories.

| Option          | Type   | Required | Description                                  |
| --------------- | ------ | -------- | -------------------------------------------- |
| `name`          | string | Yes      | Display name for the bot                     |
| `polldataPath`  | string | Yes      | Absolute path to bot's `polldata.json` file  |
| `pricelistPath` | string | Yes      | Absolute path to bot's `pricelist.json` file |
| `steamId`       | string | Yes      | Bot's 64-bit Steam ID                        |
| `description`   | string | No       | Optional description of bot's purpose        |
| `tags`          | array  | No       | Tags for organizing bots                     |
| `group`         | string | No       | Group name for bot categorization            |

### Database Configuration

| Option                    | Type    | Default     | Description                  |
| ------------------------- | ------- | ----------- | ---------------------------- |
| `host`                    | string  | `localhost` | PostgreSQL server hostname   |
| `port`                    | number  | `5432`      | PostgreSQL server port       |
| `database`                | string  | Required    | Database name                |
| `user`                    | string  | Required    | Database username            |
| `password`                | string  | Required    | Database password            |
| `ssl`                     | boolean | `false`     | Enable SSL connection        |
| `connectionTimeoutMillis` | number  | `5000`      | Connection timeout           |
| `max`                     | number  | `10`        | Maximum connection pool size |

## Bot-Specific Configuration (`config.json`)

Each bot has its own `config.json` file in its directory with TF2Autobot settings plus autopricer-specific options.

### API Keys (Required)

```json
{
  "bptfAccessToken": "your_bptf_access_token",
  "bptfApiKey": "your_bptf_api_key",
  "steamApiKey": "your_steam_api_key"
}
```

### Pricing Configuration

```json
{
  "minSellMargin": 0.11,
  "minListingCount": 3,
  "usePriceDbFallback": true,
  "alwaysQuerySnapshotAPI": true,
  "maxPercentageDifferences": {
    "buy": 5,
    "sell": -8
  },
  "priceSwingLimits": {
    "maxBuyIncrease": 0.1,
    "maxSellDecrease": 0.1
  }
}
```

### Pricing Options

| Option                  | Type    | Default | Description                                                       |
| ----------------------- | ------- | ------- | ----------------------------------------------------------------- |
| `minSellMargin`         | number  | `0.11`  | Minimum profit margin for selling (0.11 = 11% or 1 scrap)        |
| `minListingCount`       | number  | `3`     | Minimum buy/sell listings required to price an item (range: 1-20) |
| `usePriceDbFallback`    | boolean | `true`  | Use pricedb.io as primary fallback, then SCM if item not found   |
| `alwaysQuerySnapshotAPI`| boolean | `true`  | Always query the snapshot API for price data                      |
| `maxPercentageDifferences.buy` | number | `5` | Maximum percentage difference for buy prices vs baseline    |
| `maxPercentageDifferences.sell` | number | `-8` | Maximum percentage difference for sell prices vs baseline  |
| `priceSwingLimits.maxBuyIncrease` | number | `0.1` | Maximum buy price increase (10%)                        |
| `priceSwingLimits.maxSellDecrease` | number | `0.1` | Maximum sell price decrease (10%)                      |

**Note**: `priceAllItems` and `fallbackOntoPricesTf` have been removed from the public release. Users must manually add items through the GUI or `item_list.json`.

### Trusted/Blacklisted Users

```json
{
  "trustedSteamIDs": ["76561198012345678", "76561198087654321"],
  "blacklistedSteamIDs": ["76561198999999999"],
  "excludedDescriptions": ["spelled", "haunted", "cursed"]
}
```

### WebSocket Configuration

```json
{
  "websocket": {
    "reconnectInterval": 30000,
    "maxReconnectAttempts": 10,
    "healthCheckInterval": 60000,
    "enableHeartbeat": true,
    "heartbeatInterval": 25000
  },
  "websocketRelay": {
    "enabled": false,
    "protocol": "ws",
    "host": "localhost",
    "port": 7789
  }
}
```

**WebSocket Relay Options:**

| Option     | Type    | Default       | Description                                    |
| ---------- | ------- | ------------- | ---------------------------------------------- |
| `enabled`  | boolean | `false`       | Enable relay mode instead of direct connection |
| `protocol` | string  | `"ws"`        | Protocol (`"ws"` or `"wss"`)                   |
| `host`     | string  | `"localhost"` | Relay server hostname or IP address            |
| `port`     | number  | `7789`        | Relay server port                              |

⚠️ **Relay Mode**: When enabled, connects to your internal relay server instead of directly to backpack.tf. This allows multiple autopricer instances to share a single websocket connection through your `backpack-tf-socket-relay` service.

The relay connection will use the endpoint: `{protocol}://{host}:{port}/relay`

### Rate Limiting

```json
{
  "rateLimiting": {
    "bptfRequests": 10,
    "scmRequests": 5,
    "requestWindow": 60000,
    "burstAllowance": 20
  }
}
```

## Environment Variables

You can override configuration using environment variables:

### Database

- `DB_HOST` - Database hostname
- `DB_PORT` - Database port
- `DB_NAME` - Database name
- `DB_USER` - Database username
- `DB_PASSWORD` - Database password

### Application

- `PRICE_WATCHER_PORT` - Web interface port
- `NODE_ENV` - Environment (development/production)
- `LOG_LEVEL` - Logging level (debug/info/warn/error)

### API Keys

- `BPTF_ACCESS_TOKEN` - Backpack.tf access token
- `BPTF_API_KEY` - Backpack.tf API key
- `STEAM_API_KEY` - Steam API key

## Advanced Configuration

### Custom Pricing Logic

```json
{
  "customPricing": {
    "enableML": false,
    "historicalWeighting": 0.3,
    "trendAnalysis": true,
    "seasonalAdjustments": false,
    "customRules": [
      {
        "condition": "item.quality === 'Unusual'",
        "action": "applyUnusualLogic"
      }
    ]
  }
}
```

### Caching Configuration

```json
{
  "cache": {
    "enableRedis": false,
    "redisUrl": "redis://localhost:6379",
    "ttl": {
      "prices": 3600,
      "listings": 1800,
      "scmPrices": 7200
    }
  }
}
```

### Monitoring & Alerts

```json
{
  "monitoring": {
    "enableHealthChecks": true,
    "alertWebhooks": ["https://discord.com/api/webhooks/..."],
    "alerts": {
      "priceDeviation": 0.25,
      "connectionFailures": 3,
      "apiErrors": 5
    }
  }
}
```

## Validation Schema

The configuration is validated against a JSON schema. Key validation rules:

### Required Fields

- `selectedBot` must exist in `bots` object
- Each bot must have `name`, `polldataPath`, `pricelistPath`, and `steamId`
- Database configuration must include all connection details

### Path Validation

- `polldataPath` must be absolute path to existing `polldata.json` file
- `pricelistPath` must be absolute path to existing `pricelist.json` file
- Paths must exist and be accessible

### Type Validation

- Port numbers must be valid integers (1-65535)
- Margins must be numbers between 0 and 1
- Boolean values must be true/false
- `steamId` must be valid 64-bit Steam ID string

## Configuration Migration

⚠️ **Breaking Change**: The bot configuration format has changed significantly. Previous installations using `tf2autobotPath` and `botDirectory` must be reconfigured manually using the Bot Configuration GUI with direct file paths.

### Old Format (No Longer Supported)

```json
// Old format - NO LONGER WORKS
{
  "tf2autobotPath": "/path/to/tf2autobot",
  "botDirectory": "files/bot1"
}
```

### New Format (Required)

```json
// New format - Direct file paths required
{
  "polldataPath": "C:/tf2autobot/files/bot1/polldata.json",
  "pricelistPath": "C:/tf2autobot/files/bot1/pricelist.json",
  "steamId": "76561198012345678"
}
```

### Version Updates

Configuration version is tracked for future migrations:

```json
{
  "_version": "2.0.0",
  "_migrated": "2024-01-01T00:00:00Z"
}
```

## Best Practices

### Security

- Store sensitive values in environment variables
- Use strong database passwords
- Limit file permissions on configuration files
- Regularly rotate API keys

### Performance

- Tune database connection pool size based on usage
- Adjust rate limiting based on API quotas
- Monitor memory usage with large bot configurations
- Use caching for frequently accessed data

### Maintenance

- Keep configuration files under version control
- Document custom pricing rules
- Regular backups of configuration
- Test configuration changes in development first

## Troubleshooting Configuration

### Common Issues

**Invalid JSON Syntax**

```bash
# Validate JSON syntax
node -e "console.log(JSON.parse(require('fs').readFileSync('pricerConfig.json')))"
```

**Missing Required Fields**

```bash
# Run configuration validation
npm run validate-config
```

**Path Issues**

```bash
# Check if paths exist
ls -la /path/to/tf2autobot
ls -la /path/to/tf2autobot/files/bot1
```

**Database Connection**

```bash
# Test database connection
psql -U autopricer -d tf2autopricer -h localhost -c "SELECT 1;"
```

## Next Steps

- **[Installation Guide](INSTALLATION.md)** - Setup instructions
- **[Multi-Bot Setup](MULTI-BOT.md)** - Managing multiple bots
- **[Troubleshooting](TROUBLESHOOTING.md)** - Common issues and solutions
