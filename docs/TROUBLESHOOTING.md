# 🔧 Troubleshooting Guide

Common issues and solutions for Bliss Autopricer.

## Quick Diagnostics

Run these commands to quickly identify issues:

```bash
# Check configuration
npm run validate-config

# Check Node.js version
node --version  # Should be 22.0.0+

# Check PostgreSQL connection
psql -U autopricer -d tf2autopricer -c "SELECT version();"

# Check web interface
curl -I http://localhost:3000
```

## Common Issues

### 🚨 403 Forbidden Errors

**Symptoms**: Getting 403 errors when fetching prices from backpack.tf

**Causes**:

- Invalid or missing backpack.tf API keys
- Expired API tokens
- Rate limiting

**Solutions**:

1. **Verify API Keys**:

   ```bash
   # Check if keys are set in bot config
   grep -E "(bptfAccessToken|bptfApiKey)" /path/to/bot/config.json
   ```

2. **Test API Keys**:

   ```bash
   # Test backpack.tf API access
   curl -H "Authorization: Token YOUR_ACCESS_TOKEN" \
        "https://backpack.tf/api/classifieds/search/v1?sku=5021;6"
   ```

3. **Regenerate Keys**:

   - Visit [backpack.tf/api/register](https://backpack.tf/api/register)
   - Generate new API key and access token
   - Update bot configuration

4. **Check Rate Limits**:
   - Reduce request frequency
   - Implement backoff strategies
   - Monitor API usage

### 🗄️ Database Connection Issues

**Symptoms**:

- "Connection refused" errors
- "Database does not exist" errors
- Authentication failures

**Solutions**:

1. **Check PostgreSQL Service**:

   ```bash
   # Windows
   net start postgresql-x64-16

   # Linux/macOS
   sudo systemctl status postgresql
   brew services list | grep postgresql
   ```

2. **Verify Database Exists**:

   ```bash
   psql -U postgres -c "\l" | grep tf2autopricer
   ```

3. **Test Connection**:

   ```bash
   psql -U autopricer -d tf2autopricer -h localhost
   ```

4. **Reset Database**:

   ```sql
   -- As postgres user
   DROP DATABASE IF EXISTS tf2autopricer;
   
   CREATE DATABASE tf2autopricer OWNER autopricer;
   ```

5. **Check Configuration**:
   ```json
   {
     "database": {
       "host": "localhost",
       "port": 5432,
       "database": "tf2autopricer",
       "user": "autopricer",
       "password": "your_password"
     }
   }
   ```

### 🔌 WebSocket Connection Problems

**Symptoms**:

- WebSocket disconnections
- "Connection refused" in browser
- Stale connection warnings

**Solutions**:

1. **Check WebSocket Status**:
   Visit: `http://localhost:3000/websocket-status`

2. **Restart Services**:

   ```bash
   # Restart autopricer
   npm run dev

   # If using PM2
   pm2 restart bliss-autopricer
   ```

3. **Firewall Issues**:

   ```bash
   # Check if port is open
   netstat -an | grep :3000

   # Test local connection
   telnet localhost 3000
   ```

4. **Browser Issues**:
   - Clear browser cache
   - Disable browser extensions
   - Try incognito mode
   - Check browser console for errors

### 🤖 Bot Configuration Issues

**Symptoms**:

- "No bot selected" errors
- Bot not found in interface
- Configuration not loading
- "File does not exist" errors

**Solutions**:

1. **Use the Bot Configuration GUI**:
   - Navigate to `http://localhost:3000` and click "Bot Configuration"
   - Click "Add New Bot"
   - Provide the **direct absolute paths** to your bot's files:
     - `polldata.json` path (e.g., `C:/tf2autobot/files/bot1/polldata.json`)
     - `pricelist.json` path (e.g., `C:/tf2autobot/files/bot1/pricelist.json`)
     - Bot's Steam ID (64-bit format)
   - Click "Add Bot"

2. **Verify File Paths**:

   ```powershell
   # Windows - Check if files exist
   Test-Path "C:\tf2autobot\files\bot1\polldata.json"
   Test-Path "C:\tf2autobot\files\bot1\pricelist.json"
   ```
   
   ```bash
   # Linux/macOS
   ls -la /path/to/tf2autobot/files/bot1/polldata.json
   ls -la /path/to/tf2autobot/files/bot1/pricelist.json
   ```

3. **Check Configuration Format**:

   ```bash
   # Validate JSON syntax
   node -e "console.log(JSON.parse(require('fs').readFileSync('pricerConfig.json')))"
   ```

4. **Manual Configuration** (if GUI doesn't work):
   ```json
   {
     "selectedBot": "main-bot",
     "bots": {
       "main-bot": {
         "name": "Main Bot",
         "polldataPath": "C:/tf2autobot/files/bot1/polldata.json",
         "pricelistPath": "C:/tf2autobot/files/bot1/pricelist.json",
         "steamId": "76561198012345678"
       }
     }
   }
   ```

### 📊 Price Data Issues

**Symptoms**:

- No prices being generated
- Outdated prices
- Missing items in pricelist
- Fallback pricing not working

**Solutions**:

1. **Check Item List**:

   ```bash
   # Verify item_list.json exists and is valid
   node -e "console.log(JSON.parse(require('fs').readFileSync('files/item_list.json')))"
   ```

2. **Enable PriceDB Fallback**:
   - Navigate to `http://localhost:3000/settings`
   - Check the "Use PriceDB.io Fallback" checkbox
   - This provides backup pricing when backpack.tf listings are insufficient
   - PriceDB is tried first, then Steam Community Market if item not found

3. **Check API Connectivity**:

   ```bash
   # Test backpack.tf API
   curl "https://backpack.tf/api/classifieds/search/v1?sku=5021;6"
   
   # Test PriceDB.io API
   curl "https://pricedb.io/api/item/5021;6"
   ```

4. **Review Logs**:

   ```bash
   # Check for pricing errors
   tail -f logs/autopricer.log | grep -i error
   ```

5. **Manual Price Update**:
   - Use web interface to manually add items via the dashboard
   - Check if specific items are causing issues
   - Verify item SKUs are correct format

### 🐛 Application Crashes

**Symptoms**:

- Process exits unexpectedly
- Out of memory errors
- Unhandled exceptions

**Solutions**:

1. **Check Logs**:

   ```bash
   # Check PM2 logs
   pm2 logs bliss-autopricer

   # Check system logs
   tail -f /var/log/syslog | grep autopricer
   ```

2. **Memory Issues**:

   ```bash
   # Increase Node.js memory limit
   node --max-old-space-size=2048 bptf-autopricer.js
   ```

3. **Dependency Issues**:

   ```bash
   # Reinstall dependencies
   rm -rf node_modules package-lock.json
   npm install
   ```

4. **Node.js Version**:
   ```bash
   # Ensure correct Node.js version
   node --version  # Should be 22.0.0+
   nvm use 22
   ```

## Advanced Debugging

### Enable Debug Logging

```bash
# Set environment variable
export LOG_LEVEL=debug

# Or in Windows
set LOG_LEVEL=debug

# Start with debug logging
npm run dev
```

### Database Query Debugging

```sql
-- Check recent prices
SELECT
  *
FROM
  tf2.prices
ORDER BY
  created_at DESC
LIMIT
  10;

-- Check key prices
SELECT
  *
FROM
  tf2.key_prices
ORDER BY
  created_at DESC
LIMIT
  10;

-- Check database size
SELECT
  pg_size_pretty (pg_database_size ('tf2autopricer'));
```

### Network Debugging

```bash
# Monitor network connections
netstat -an | grep :3000

# Check DNS resolution
nslookup backpack.tf

# Test API endpoints
curl -v https://backpack.tf/api/classifieds/search/v1?sku=5021;6
```

### Process Monitoring

```bash
# Monitor CPU/Memory usage
top -p $(pgrep -f bptf-autopricer)

# Check file descriptors
lsof -p $(pgrep -f bptf-autopricer)

# Monitor disk usage
df -h
```

## Performance Issues

### Slow Price Updates

**Causes**:

- Large item lists
- Network latency
- Database performance
- Rate limiting

**Solutions**:

1. **Optimize Database**:

   ```sql
   -- Add indexes
   CREATE INDEX IF NOT EXISTS idx_prices_sku ON tf2.prices (sku);
   
   CREATE INDEX IF NOT EXISTS idx_prices_created ON tf2.prices (created_at);
   
   -- Analyze tables
   ANALYZE tf2.prices;
   ```

2. **Batch Processing**:

   ```json
   {
     "batching": {
       "batchSize": 50,
       "batchDelay": 1000,
       "maxConcurrency": 5
     }
   }
   ```

3. **Caching**:
   ```json
   {
     "cache": {
       "enableCache": true,
       "ttl": 3600
     }
   }
   ```

### High Memory Usage

**Solutions**:

1. **Garbage Collection**:

   ```bash
   node --expose-gc --max-old-space-size=2048 bptf-autopricer.js
   ```

2. **Monitor Memory**:
   ```javascript
   // Add to code for monitoring
   setInterval(() => {
     const used = process.memoryUsage();
     console.log('Memory usage:', {
       rss: Math.round(used.rss / 1024 / 1024) + 'MB',
       heapUsed: Math.round(used.heapUsed / 1024 / 1024) + 'MB',
     });
   }, 60000);
   ```

## Error Codes Reference

### HTTP Status Codes

| Code | Meaning               | Common Causes                     |
| ---- | --------------------- | --------------------------------- |
| 403  | Forbidden             | Invalid API keys, rate limiting   |
| 404  | Not Found             | Missing endpoints, incorrect URLs |
| 500  | Internal Server Error | Application bugs, database issues |
| 502  | Bad Gateway           | Proxy issues, service unavailable |
| 503  | Service Unavailable   | Maintenance, overload             |

### Application Error Codes

| Code           | Description         | Solution                       |
| -------------- | ------------------- | ------------------------------ |
| `ECONNREFUSED` | Connection refused  | Check if service is running    |
| `ENOTFOUND`    | DNS lookup failed   | Check internet connection      |
| `EACCES`       | Permission denied   | Check file permissions         |
| `EMFILE`       | Too many open files | Increase file descriptor limit |

## Getting Help

### Before Asking for Help

1. **Check this troubleshooting guide**
2. **Run diagnostic commands**
3. **Check logs for error messages**
4. **Search existing GitHub issues**

### When Reporting Issues

Include this information:

```bash
# System information
uname -a
node --version
npm --version
psql --version

# Configuration (remove sensitive data)
cat pricerConfig.json

# Recent logs
tail -50 logs/autopricer.log

# Error details
# Include full error message and stack trace
```

### Support Channels

- **🐛 Bug Reports**: [GitHub Issues](https://github.com/OliverPerring/bliss-autopricer/issues)
- **💡 Feature Requests**: [GitHub Discussions](https://github.com/OliverPerring/bliss-autopricer/discussions)
- **📖 Documentation**: Check the [docs](../docs/) folder
- **💬 Community**: TF2 trading Discord servers

### Emergency Recovery

If the autopricer is completely broken:

1. **Stop all processes**:

   ```bash
   pm2 stop all
   pkill -f bptf-autopricer
   ```

2. **Backup configuration**:

   ```bash
   cp pricerConfig.json pricerConfig.json.backup
   cp -r files/ files.backup/
   ```

3. **Reset to clean state**:

   ```bash
   git stash
   git pull origin main
   npm install
   ```

4. **Restore configuration**:

   ```bash
   cp pricerConfig.json.backup pricerConfig.json
   npm run validate-config
   ```

5. **Restart services**:
   ```bash
   npm start
   ```

## Next Steps

- **[Installation Guide](INSTALLATION.md)** - Setup instructions
- **[Configuration Reference](CONFIGURATION.md)** - All configuration options
- **[API Documentation](API.md)** - REST API and WebSocket usage
