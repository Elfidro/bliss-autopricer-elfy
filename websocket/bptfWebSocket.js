const fs = require('fs');
const { clearInterval, setInterval } = require('timers');
const ReconnectingWebSocket = require('reconnecting-websocket');
const ws = require('ws');
const { WebSocket } = require('ws');
const { startRelayServer } = require('./relayServer');

let insertQueue = [];
let insertTimer = null;
const INSERT_BATCH_INTERVAL = 10000; // ms
// Hard ceiling on the pending-insert buffer. If Postgres stalls, the socket
// keeps delivering listings regardless; without a cap the queue is the one
// thing here that can grow without bound.
const INSERT_QUEUE_MAX = 20000;
let insertQueueDropped = 0;

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

  // Re-broadcast the upstream feed so other processes on this host do not
  // need their own backpack.tf connection (bpft rejects a second one).
  const broadcastCfg = config?.websocketBroadcast || {};
  const relay =
    broadcastCfg.enabled === false
      ? { broadcast: () => 0, clientCount: () => 0, close: () => {} }
      : startRelayServer({
          host: broadcastCfg.host || '127.0.0.1',
          port: broadcastCfg.port || 7791,
        });

  console.log(`[WebSocket] Attempting to connect to: ${websocketUrl}`);
  const rws = new ReconnectingWebSocket(websocketUrl, undefined, reconnectOptions);

  // Rolled-up feed counters, printed once a minute (see the message handler).
  const BATCH_SUMMARY_INTERVAL = 60000;
  let lastBatchSummary = Date.now();
  let batchEventCount = 0;
  let batchUpdateCount = 0;
  let batchDeleteCount = 0;

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
      }
      // The healthy case is deliberately not written to websocket.log. It fired
      // every 30s forever and was the main reason that file grew without bound;
      // bptf-autopricer.js already prints the same status to the pm2 log.
    }, HEALTH_CHECK_INTERVAL);
  }

  function stopHealthMonitoring() {
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
      healthCheckInterval = null;
    }
  }

  async function flushInsertQueue() {
    // Detach the batch and clear the timer up front. The old version cleared
    // insertQueue *after* awaiting the insert, silently discarding every
    // listing that arrived during the write, and left insertTimer set for the
    // duration so nothing rescheduled a flush for them either.
    const batch = insertQueue;
    insertQueue = [];
    insertTimer = null;
    if (batch.length === 0) {
      return;
    }
    try {
      await insertListingsBatch(batch);
    } catch (err) {
      console.error('[WebSocket] Batch insert error:', err);
    }
    if (insertQueue.length > 0 && !insertTimer) {
      insertTimer = setTimeout(flushInsertQueue, INSERT_BATCH_INTERVAL);
    }
  }

  function queueInsertListing(...args) {
    if (insertQueue.length >= INSERT_QUEUE_MAX) {
      insertQueueDropped++;
      if (insertQueueDropped % 1000 === 1) {
        console.warn(
          `[WebSocket] Insert queue full (${INSERT_QUEUE_MAX}); dropped ${insertQueueDropped} listings so far. Is the database keeping up?`
        );
      }
      return;
    }
    insertQueue.push(args);
    if (!insertTimer) {
      insertTimer = setTimeout(flushInsertQueue, INSERT_BATCH_INTERVAL);
    }
  }

  // Precomputed once per connection rather than per listing. These were being
  // rebuilt inside the message handler: a RegExp per excluded description per
  // listing, and a fresh stringified array of every blocked attribute value per
  // attribute of every listing. At backpack.tf's event rate that was the single
  // largest source of short-lived garbage in the process.
  const excludedSteamIdSet = new Set(excludedSteamIds || []);
  const excludedDescriptionPatterns = (excludedListingDescriptions || []).map(
    (detail) => new RegExp(`\\b${detail}\\b`, 'i')
  );
  const blockedAttributeValues = new Set(Object.values(blockedAttributes || {}).map(String));
  const blockedAttributeNames = Object.keys(blockedAttributes || {});

  let ignoredEventCount = 0;

  function handleEvent(e) {
    if (!e.payload || !e.payload.item || !e.payload.item.name) {
      // Counted rather than logged: this fires on ordinary feed traffic and
      // console.log(e) serialised the whole event object every time.
      ignoredEventCount++;
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
                blockedAttributeValues.has(String(attribute.float_value)) &&
                !blockedAttributeNames.some((key) => response_item.name.includes(key))
              );
            })
          ) {
            return;
          }

          currencies = Methods.createCurrencyObject(currencies);

          if (!excludedSteamIdSet.has(steamid)) {
            // Normalised once, not once per excluded description.
            const normalisedDetails = listingDetails
              ? listingDetails.normalize('NFKD').toLowerCase().trim()
              : null;
            if (
              normalisedDetails &&
              !excludedDescriptionPatterns.some((pattern) => pattern.test(normalisedDetails))
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

    // Forward verbatim before any filtering — consumers have their own
    // criteria, and handleEvent below only keeps watchlist items.
    relay.broadcast(event.data);

    var json = JSON.parse(event.data);
    if (json instanceof Array) {
      // One pass instead of two, and the per-batch line is now a periodic
      // summary: at backpack.tf's event rate the old log wrote a line for every
      // frame, which is most of what fills the pm2 log on this droplet.
      for (const ev of json) {
        if (ev.event === 'listing-update') {
          batchUpdateCount++;
        } else if (ev.event === 'listing-delete') {
          batchDeleteCount++;
        }
        handleEvent(ev);
      }
      batchEventCount += json.length;
    } else {
      batchEventCount++;
      handleEvent(json);
    }

    if (Date.now() - lastBatchSummary >= BATCH_SUMMARY_INTERVAL) {
      console.log(
        `[WebSocket] ${batchEventCount} events in the last ${Math.round((Date.now() - lastBatchSummary) / 1000)}s ` +
          `(${batchUpdateCount} updates, ${batchDeleteCount} deletions, ${ignoredEventCount} ignored, ` +
          `${insertQueue.length} queued for insert)`
      );
      lastBatchSummary = Date.now();
      batchEventCount = 0;
      batchUpdateCount = 0;
      batchDeleteCount = 0;
      ignoredEventCount = 0;
    }
  });

  return {
    websocket: rws,
    close: () => {
      stopHealthMonitoring();
      relay.close();
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
