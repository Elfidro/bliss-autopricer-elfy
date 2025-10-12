const fs = require('fs');
const { clearInterval, setInterval } = require('timers');
const ReconnectingWebSocket = require('reconnecting-websocket');
const ws = require('ws');
const { WebSocket } = require('ws');

let insertQueue = [];
let insertTimer = null;
const INSERT_BATCH_INTERVAL = 10000; // ms

// Connection health monitoring
let lastMessageTime = Date.now();
let messageCount = 0;
let healthCheckInterval = null;
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const MESSAGE_TIMEOUT = 120000; // 2 minutes without messages triggers reconnect

function logWebSocketEvent(logFile, message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`);
}

function initBptfWebSocket({
  getAllowedItemNames,
  allowAllItems,
  schemaManager,
  Methods,
  insertListingsBatch,
  deleteRemovedListing,
  excludedSteamIds,
  excludedListingDescriptions,
  blockedAttributes,
  logFile,
  onListingUpdate,
  config,
}) {
  // Enhanced reconnection options
  const reconnectOptions = {
    WebSocket: ws,
    headers: {
      'batch-test': true,
    },
    // More aggressive reconnection settings
    connectionTimeout: 5000, // 5 seconds
    maxRetries: Infinity,
    maxReconnectionDelay: 30000, // Max 30 seconds between reconnects
    minReconnectionDelay: 1000, // Min 1 second between reconnects
    reconnectionDelayGrowFactor: 1.3, // Exponential back-off factor
    minUptime: 5000, // Connection must be up for 5 seconds to be considered stable
    debug: false,
  };

  // Determine websocket URL based on relay configuration
  let websocketUrl;
  if (config?.websocketRelay?.enabled) {
    const { protocol = 'ws', host = 'localhost', port = 7789 } = config.websocketRelay;
    websocketUrl = `${protocol}://${host}:${port}/relay`;
    console.log(`[WebSocket] Using relay server: ${websocketUrl}`);
    console.log(`[WebSocket] Relay config: ${JSON.stringify(config.websocketRelay, null, 2)}`);
  } else {
    websocketUrl = 'wss://ws.backpack.tf/events/';
    console.log('[WebSocket] Using direct backpack.tf connection');
  }

  console.log(`[WebSocket] Attempting to connect to: ${websocketUrl}`);
  const rws = new ReconnectingWebSocket(websocketUrl, undefined, reconnectOptions);

  // Health monitoring function
  function startHealthMonitoring() {
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
    }

    healthCheckInterval = setInterval(() => {
      const timeSinceLastMessage = Date.now() - lastMessageTime;

      if (timeSinceLastMessage > MESSAGE_TIMEOUT) {
        const msg = `[WebSocket] No messages received for ${Math.round(timeSinceLastMessage / 1000)}s, forcing reconnect`;
        console.warn(msg);
        logWebSocketEvent(logFile, msg);

        // Force reconnection by closing the connection
        if (rws.readyState === WebSocket.OPEN) {
          rws.reconnect();
        }
      } else {
        // Log periodic health status
        const msg = `[WebSocket] Health check: ${messageCount} messages received, last message ${Math.round(timeSinceLastMessage / 1000)}s ago`;
        logWebSocketEvent(logFile, msg);
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  function stopHealthMonitoring() {
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
      healthCheckInterval = null;
    }
  }

  async function flushInsertQueue() {
    if (insertQueue.length === 0) {
      return;
    }
    try {
      await insertListingsBatch(insertQueue);
    } catch (err) {
      console.error('[WebSocket] Batch insert error:', err);
    }
    insertQueue = [];
    insertTimer = null;
  }

  function queueInsertListing(...args) {
    insertQueue.push(args);
    if (!insertTimer) {
      insertTimer = setTimeout(flushInsertQueue, INSERT_BATCH_INTERVAL);
    }
  }

  function handleEvent(e) {
    if (!e.payload || !e.payload.item || !e.payload.item.name) {
      // Optionally log ignored events for debugging:
      console.log('[WebSocket] Ignored event:', e);
      return;
    }
    if (allowAllItems() || getAllowedItemNames().has(e.payload.item.name)) {
      let response_item = e.payload.item;
      let spells = e.payload.item.spells;
      let steamid = e.payload.steamid;
      let intent = e.payload.intent;
      switch (e.event) {
        case 'listing-update': {
          //          console.log('[WebSocket] Received a socket listing update for : ' + response_item.name);

          let currencies = e.payload.currencies;
          let listingDetails = e.payload.details;
          let listingItemObject = e.payload.item;

          if (!e.payload.userAgent) {
            return;
          }
          if (!Methods.validateObject(currencies)) {
            return;
          }
          if (spells && Array.isArray(spells) && spells.length > 0) {
            console.log(
              `[WebSocket] Ignored listing update for item with spells, as they are not supported. ${response_item.name} has spells: ${spells.map((spell) => spell.name).join(', ')}`
            );
            return;
          }

          if (
            listingItemObject.attributes &&
            listingItemObject.attributes.some((attribute) => {
              return (
                typeof attribute === 'object' &&
                attribute.float_value &&
                Object.values(blockedAttributes)
                  .map(String)
                  .includes(String(attribute.float_value)) &&
                !Object.keys(blockedAttributes).some((key) => response_item.name.includes(key))
              );
            })
          ) {
            return;
          }

          currencies = Methods.createCurrencyObject(currencies);

          if (!excludedSteamIds.some((id) => steamid === id)) {
            if (
              listingDetails &&
              !excludedListingDescriptions.some((detail) =>
                new RegExp(`\\b${detail}\\b`, 'i').test(
                  listingDetails.normalize('NFKD').toLowerCase().trim()
                )
              )
            ) {
              try {
                var sku = schemaManager.schema.getSkuFromName(response_item.name);
                if (sku === null || sku === undefined) {
                  throw new Error(
                    `| UPDATING PRICES |: Couldn't price ${response_item.name}. Issue with retrieving this items defindex.`
                  );
                }
                queueInsertListing(response_item, sku, currencies, intent, steamid);
                onListingUpdate(sku);
              } catch (e) {
                console.log(e);
                console.log("Couldn't create a price for " + response_item.name);
              }
            }
          }
          break;
        }
        case 'listing-delete': {
          //          console.log('[WebSocket] Received a socket listing delete for : ' + response_item.name);

          try {
            deleteRemovedListing(steamid, response_item.name, intent);
          } catch {
            return;
          }
          break;
        }
      }
    }
  }

  // eslint-disable-next-line spellcheck/spell-checker
  // eslint-disable-next-line no-unused-vars
  rws.addEventListener('open', (event) => {
    const msg = '[WebSocket] Connected to bptf socket.';
    console.log(msg);
    logWebSocketEvent(logFile, msg);

    // Reset health monitoring
    lastMessageTime = Date.now();
    messageCount = 0;
    startHealthMonitoring();
  });

  rws.addEventListener('close', (event) => {
    const msg = `[WebSocket] bptf Socket connection closed. Code: ${event.code}, Reason: ${event.reason || 'No reason provided'}, Clean: ${event.wasClean}`;
    console.warn(msg);
    logWebSocketEvent(logFile, msg);

    // Stop health monitoring when connection closes
    stopHealthMonitoring();
  });

  rws.addEventListener('error', (event) => {
    const errorDetails = {
      message: event.message || 'No message',
      error: event.error || 'No error object',
      type: event.type || 'Unknown type',
      target: event.target ? event.target.url : 'No target URL',
    };
    const msg = `[WebSocket] bptf Socket encountered an error: ${JSON.stringify(errorDetails, null, 2)}`;
    console.error(msg);
    logWebSocketEvent(logFile, msg);
  });

  rws.addEventListener('message', (event) => {
    // Update message tracking for health monitoring
    lastMessageTime = Date.now();
    messageCount++;

    var json = JSON.parse(event.data);
    if (json instanceof Array) {
      let updateCount = 0;
      let deleteCount = 0;
      json.forEach((ev) => {
        if (ev.event === 'listing-update') {
          updateCount++;
        } else if (ev.event === 'listing-delete') {
          deleteCount++;
        }
      });
      console.log(
        `[WebSocket] Received batch: ${json.length} events (${updateCount} updates, ${deleteCount} deletions)`
      );
      json.forEach(handleEvent);
    } else {
      console.log('[WebSocket] Received single bptf event');
      handleEvent(json);
    }
  });

  return {
    websocket: rws,
    close: () => {
      stopHealthMonitoring();
      rws.close();
    },
    getStats: () => ({
      messageCount,
      lastMessageTime,
      timeSinceLastMessage: Date.now() - lastMessageTime,
      isConnected: rws.readyState === WebSocket.OPEN,
    }),
  };
}

module.exports = { initBptfWebSocket };
