const http = require('http');
const express = require('express');
const socketIO = require('socket.io');
const { getBaseConfigManager } = require('../modules/baseConfigManager');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(
  express.urlencoded({
    extended: true,
  })
);

const config = getBaseConfigManager().getConfig();

// Log every request with its status. tf2autobot reports only "status code 404"
// with no indication of what it asked for, which makes a mismatch between the
// URL it builds and the routes mounted here impossible to diagnose from its
// side. Disable with apiRequestLogging: false.
if (config.apiRequestLogging !== false) {
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      console.log(
        `[API] ${req.method} ${req.originalUrl} -> ${res.statusCode} ` +
          `(${Date.now() - started}ms, from ${req.socket.remoteAddress})`
      );
    });
    next();
  });
}

// API routes.
const items_endpoint = require('./routes/api/items.js');
const { router: websocketStatus } = require('./routes/websocket-status.js');
const { router: schemaStatus, setSchemaManager } = require('./routes/schema-status.js');

app.use('/items', items_endpoint);
app.use('/websocket-status', websocketStatus);
app.use('/schema-status', schemaStatus);

const port = config.pricerPort || 3456;

const listen = () => {
  server.listen(port, () => {
    console.log(`API and Socket.IO server started on port ${port}`);
  });

  io.on('connection', (socket) => {
    console.log(`A new client connected. Socket ID: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`Client disconnected. Socket ID: ${socket.id}`);
    });
  });
};

module.exports = {
  listen: listen,
  socketIO: io,
  setSchemaManager: setSchemaManager,
};
