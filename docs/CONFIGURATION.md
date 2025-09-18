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
      "tf2autobotPath": "/path/to/tf2autobot",
      "botDirectory": "files/main-bot",
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

| Option           | Type   | Required | Description                              |
| ---------------- | ------ | -------- | ---------------------------------------- |
| `name`           | string | Yes      | Display name for the bot                 |
| `tf2autobotPath` | string | Yes      | Absolute path to TF2Autobot installation |
| `botDirectory`   | string | Yes      | Relative path to bot's files directory   |
| `description`    | string | No       | Optional description of bot's purpose    |
| `tags`           | array  | No       | Tags for organizing bots                 |
| `group`          | string | No       | Group name for bot categorization        |

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

### Pricing Strategy

```json
{
  "pricingStrategy": {
    "scmFallback": true,
    "scmMarginBuy": 0.1,
    "scmMarginSell": 0.15,
    "bptfFallback": true,
    "outlierThreshold": 0.3,
    "minListings": 3,
    "maxAge": 86400,
    "unusualPricing": false,
    "aggressivePricing": false,
    "safetyMargins": true
  }
}
```

### Pricing Strategy Options

| Option              | Type    | Default | Description                                    |
| ------------------- | ------- | ------- | ---------------------------------------------- |
| `scmFallback`       | boolean | `true`  | Enable Steam Community Market fallback pricing |
| `scmMarginBuy`      | number  | `0.10`  | Buy margin for SCM prices (10% = 0.10)         |
| `scmMarginSell`     | number  | `0.15`  | Sell margin for SCM prices (15% = 0.15)        |
| `bptfFallback`      | boolean | `true`  | Enable backpack.tf fallback pricing            |
| `outlierThreshold`  | number  | `0.30`  | Threshold for filtering outlier listings       |
| `minListings`       | number  | `3`     | Minimum listings required for pricing          |
| `maxAge`            | number  | `86400` | Maximum age of listings to consider (seconds)  |
| `unusualPricing`    | boolean | `false` | Enable special unusual pricing logic           |
| `aggressivePricing` | boolean | `false` | Use more aggressive pricing strategy           |
| `safetyMargins`     | boolean | `true`  | Apply additional safety margins                |

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
- Each bot must have `name`, `tf2autobotPath`, and `botDirectory`
- Database configuration must include all connection details

### Path Validation

- `tf2autobotPath` must be absolute path
- `botDirectory` must be relative path
- Paths must exist and be accessible

### Type Validation

- Port numbers must be valid integers (1-65535)
- Margins must be numbers between 0 and 1
- Boolean values must be true/false

## Configuration Migration

### From Legacy Format

Old single-bot configuration is automatically migrated:

```json
// Old format (config.json)
{
  "tf2AutobotDir": "/path/to/bot",
  "botTradingDir": "files/bot1"
}

// New format (pricerConfig.json)
{
  "selectedBot": "migrated-bot",
  "bots": {
    "migrated-bot": {
      "name": "Migrated Bot",
      "tf2autobotPath": "/path/to/bot",
      "botDirectory": "files/bot1"
    }
  }
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
