// relayServer.js — re-broadcasts the backpack.tf event stream to local consumers.
//
// backpack.tf refuses multiple websocket connections from the same host, so any
// second process on this droplet (TradingToolsTF2) cannot open its own. This
// server lets the autopricer hold the single upstream connection and hand the
// raw frames to whoever else needs them.
//
// Frames are forwarded exactly as received. Filtering stays in the consumer:
// the autopricer only cares about watchlist items, TradingToolsTF2 only cares
// about cheap craft hats, and neither should have to know about the other.

const { WebSocketServer } = require('ws');

function startRelayServer({ host = '127.0.0.1', port = 7791, logger = console } = {}) {
  let wss = null;
  let clients = new Set();

  try {
    wss = new WebSocketServer({ host, port });
  } catch (err) {
    logger.error(`[Relay] Could not start relay server on ${host}:${port}: ${err.message}`);
    return createNoop();
  }

  wss.on('listening', () => {
    logger.log(`[Relay] Broadcasting backpack.tf events on ws://${host}:${port}`);
  });

  wss.on('connection', (socket, req) => {
    const who = req?.socket?.remoteAddress || 'unknown';
    clients.add(socket);
    logger.log(`[Relay] Consumer connected from ${who} (${clients.size} total)`);

    socket.on('close', () => {
      clients.delete(socket);
      logger.log(`[Relay] Consumer disconnected (${clients.size} remaining)`);
    });

    // A consumer erroring out must never take down the pricer.
    socket.on('error', (err) => {
      logger.error(`[Relay] Consumer socket error: ${err.message}`);
      clients.delete(socket);
    });
  });

  wss.on('error', (err) => {
    // EADDRINUSE most likely means a second autopricer instance. Log it and
    // carry on unrelayed rather than killing the pricing loop.
    logger.error(`[Relay] Server error, continuing without relay: ${err.message}`);
  });

  function broadcast(data) {
    if (clients.size === 0) {
      return 0;
    }
    let sent = 0;
    for (const socket of clients) {
      // 1 === WebSocket.OPEN
      if (socket.readyState !== 1) {
        continue;
      }
      try {
        socket.send(data);
        sent++;
      } catch (err) {
        logger.error(`[Relay] Failed to send to consumer: ${err.message}`);
        clients.delete(socket);
      }
    }
    return sent;
  }

  return {
    broadcast,
    clientCount: () => clients.size,
    close: () => {
      for (const socket of clients) {
        try {
          socket.close();
        } catch {
          /* already gone */
        }
      }
      clients.clear();
      if (wss) {
        wss.close();
      }
    },
  };
}

function createNoop() {
  return { broadcast: () => 0, clientCount: () => 0, close: () => {} };
}

module.exports = { startRelayServer };
