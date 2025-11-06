const EventEmitter = require('events');
const { getBaseConfigManager } = require('./baseConfigManager');

class EmitQueue extends EventEmitter {
  constructor(socketIO, intervalMs = null) {
    super();
    this.queue = [];
    this.socketIO = socketIO;
    
    // Use provided interval or get from config
    if (intervalMs === null) {
      const config = getBaseConfigManager().getConfig();
      this.intervalMs = config.emitQueueInterval || 20;
    } else {
      this.intervalMs = intervalMs;
    }
    
    this.running = false;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this._process();
  }

  stop() {
    this.running = false;
  }

  enqueue(item) {
    this.queue.push(item);
  }

  _process() {
    if (!this.running) {
      return;
    }
    if (this.queue.length > 0) {
      const item = this.queue.shift();
      this.socketIO.emit('price', item);
      this.emit('emitted', item);
    }
    setTimeout(() => this._process(), this.intervalMs);
  }
}

module.exports = EmitQueue;
