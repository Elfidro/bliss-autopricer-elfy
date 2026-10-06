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
| `sellAnchor.enabled` | boolean | `true` | Cap the sell price relative to the buy price (see below) |
| `sellAnchor.minBids` | number | `3` | Only cap when at least this many bids back the buy price |
| `sellAnchor.maxAboveBuyPct` | number | `0.6` | Sell may be at most this fraction above the buy (0.6 = 60%) |
| `sellAnchor.maxAboveBuyMetal` | number | `0.66` | Flat allowance in ref over the buy, so cheap items keep a weapon-or-two spread |
| `sellAnchor.maxAboveBaselinePct` | number | `0.25` | The cap is at least this fraction over the bptf community sell, when there is one |
| `sellOnly.maxAskWithoutBidsMetal` | number | `1` | With no bids at all, an item is priced from the ask alone (buy 0.05) only when the ask is at most this many ref |
| `marketModel.supportPct` | number | `0.05` | A bid is supported when enough bids sit within this fraction of it |
| `marketModel.supportMetal` | number | `0.11` | ...or within this many ref, whichever is wider (one scrap: on cheap items 5% is less than one price step) |
| `marketModel.minSupport` | number | `2` | How many bids (itself included) must sit within `supportPct` of a bid to support it |
| `marketModel.askProximityPct` | number | `0.1` | A bid within this fraction under the market ask is supported on its own (the two sides agree) |
| `marketModel.lockedNextAskMaxPct` | number | `0.25` | In a locked market, the next ask up is the sell only when it is at most this fraction above the best bid |
| `marketModel.lockedClusterMin` | number | `2` | In a locked market with at least this many asks at or under the best bid, sell with that cluster (its highest ask) and buy at the best bid under it |
| `marketModel.lockTolerancePct` | number | `0.05` | Bids up to this fraction over the ask are a locked market; higher ones are dropped as painted/spelled variants |
| `baselineCheck.skipWhenListingsAtLeast.buy` / `.sell` | number | `5` / `3` | With at least this many bids and asks the bptf baseline check is skipped |
| `baselineCheck.skipWhenListingsAtLeast.total` | number | `5` | The baseline check is also skipped with 2+ bids, an ask, at least this many listings in all, and the ask within `maxAskToBidRatio` of the bid |
| `historyAnchor.enabled` | boolean | `true` | Limit bids and buy rises against the median of our own recent prices |
| `historyAnchor.windowHours` | number | `24` | How far back the median of `price_history` reaches |
| `historyAnchor.minRows` | number | `8` | A SKU needs at least this many `price_history` rows in the window to have an anchor |
| `historyAnchor.maxBidAbovePct` / `maxBidAboveMetal` | number | `0.5` / `0.33` | Bids above anchor sell × (1 + pct), or anchor sell + metal if larger, are ignored |
| `historyAnchor.maxBuyRisePct` / `maxBuyRiseMetal` | number | `0.25` / `0.33` | The buy may be at most anchor buy × (1 + pct), or anchor buy + metal if larger (rounded down to a weapon) |
| `historyAnchor.longWindowHours` | number | `168` | Window of the long median published in `files/anchors.json` (not used for pricing) |
| `historyAnchor.longMinRows` | number | `96` | A SKU needs at least this many rows in the long window to have a long median (a day of cycles) |
| `historyAnchor.minBuyOfSellPct` | number | `0.5` | A buy anchor under this share of the sell anchor came from a sell-only placeholder, not bids: no buy ramp for it |
| `historyAnchor.maxSellDropPct` / `maxSellDropMetal` | number | `0.25` / `0.33` | The sell may be at least anchor sell × (1 − pct), or anchor sell − metal if lower (rounded up to a weapon), and never at or under the buy |
| `historyAnchor.tightMarketPct` | number | `0.25` | No sell floor when the market ask is within this fraction of the best bid, or the book is locked (the bids prove the price) |

How the market is read (`modules/marketPrice.js`): the buy price is the best *supported* bid - the highest bid that another bid within `supportPct` backs, or that sits within `askProximityPct` under the ask - so a lone bid far above the pack is not copied and a crowd of lowballers does not drag the buy down. When the best bid meets the lowest ask (a locked market) the sell is the first ask above the best bid when it is at most `lockedNextAskMaxPct` above the bid, otherwise the best bid plus `minSellMargin` / `minSellMarginPercent` - unless `lockedClusterMin` or more sellers already sit at or under the best bid, in which case that cluster is the market: the sell is its highest ask and the buy the best bid under it. Whatever the path, the sell is never left under a real bid (the highest bid within the lock ceiling, even one the history anchor keeps out of our buy): it is lifted one weapon over it, since anyone could buy ours and flip it into that bid. Items that did not price in a cycle (baseline rejection, swing hold, error) are still checked against the live market: a sell under the best bid is raised and a buy over the market sell is lowered (`modules/priceGuard.js`).

`historyAnchor` (`modules/historyAnchor.js`) defends against pumped markets: someone buys out the honest asks, leaving only junk asks far above the real price, and walks the bids up a few percent per cycle - too slowly for the swing guard. Each cycle reads the median buy and sell of the last `windowHours` of `price_history` per SKU. Bids far above the median sell are dropped, a lone bid near a junk ask no longer counts as supported, and the buy may rise at most `maxBuyRisePct` (min `maxBuyRiseMetal`) over the median buy. The mirror attack - fake cheap asks pulling our sell down so the lister can buy our stock - is stopped by the sell floor: the sell may fall at most `maxSellDropPct` (min `maxSellDropMetal`) under the median sell, never to or under the buy, and the floor is skipped on the sell-only, placeholder and locked-margin paths (those sells are derived from the bids). So the anchor limits the buy upward and the sell downward; a wrong-low buy anchor costs missed purchases while the price catches up (a 3 -> 18 ref move takes about 8 days at 25% a day) and a wrong-high sell anchor costs a few days of slower sales, and neither is ever reinforced. An implausible anchor is skipped: no buy ramp when the buy anchor is under `minBuyOfSellPct` of the sell anchor (a sell-only placeholder history; the bids stay bounded by 1.5x the sell anchor), no sell floor when the sell anchor is under the buy anchor, and no sell floor on a tight or locked book (ask within `tightMarketPct` of the bid), where the bids prove the price. Each cycle logs one `[ANCHOR]` summary line.

### Files shared with other apps

The pricer and pricelist-ui exchange state through files under `files/` (all gitignored runtime state):

| File | Written by | Contents |
| ---- | ---------- | -------- |
| `files/pricelist.json` | pricer | The market prices, one entry per SKU |
| `files/price-policy.json` | pricelist-ui | Stock-aware adjustments the pricer applies when emitting (`modules/pricePolicy.js`) |
| `files/anchors.json` | pricer, every cycle | The `historyAnchor` medians of our own prices, for pricelist-ui's inflow guard |

`files/anchors.json` is written atomically (temp file + rename) right after the anchors are loaded, and not at all when the anchor is off or the query fails:

```json
{
  "updatedAt": "2026-10-03T12:00:00.000Z",
  "windowHours": 24,
  "longWindowHours": 168,
  "keyMetal": 60.11,
  "anchors": {
    "31516;6": { "buy": 3.4, "sell": 3.5, "n": 96, "longBuy": 3.33, "longSell": 3.44, "longN": 640 }
  }
}
```

Numbers are rounded to 2 dp; `buy`/`sell` are null when the SKU has fewer than `minRows` rows in the last `windowHours`, `longBuy`/`longSell` when it has fewer than `longMinRows` in the last `longWindowHours`. SKUs with neither are left out.

`sellAnchor` stops the pricer copying an ask side made of bots parked at an absurd price: with enough bids, the sell is capped at the highest of buy × (1 + `maxAboveBuyPct`), buy + `maxAboveBuyMetal` and the bptf community sell × (1 + `maxAboveBaselinePct`), rounded down to a whole weapon. `sellOnly.maxAskWithoutBidsMetal` keeps an item that momentarily has no bids on its last price instead of pricing it 0.05 / ask; the no-bid rule is meant for junk that trades at a weapon or two.

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
