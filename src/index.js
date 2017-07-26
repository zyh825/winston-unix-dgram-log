const unix = require('unix-dgram');
const util = require('util');
const winston = require('winston');
const moment = require('moment');

const levels = Object.keys({
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  crit: 5,
  alert: 6,
  emerg: 7
});

const UnixDgramLog = function UnixDgramLog(options = {}) {
  winston.Transport.call(this, options);

  // Extract options
  this.path = options.path;

  if (!this.path) {
    throw new Error('`options.path` is required on unix dgram sockets.');
  }

  // Setup connection state
  this.connected = false;
  this.congested = false;
  this.retries = 0;
  this.queue = [];
  this.inFlight = 0;

  // Setup log producer
  this.producer = options.producer || {};
  this.prefix = options.prefix;
  // Setup socket
  this.socket = null;
};

util.inherits(UnixDgramLog, winston.Transport);

winston.transports.UnixDgramLog = UnixDgramLog;

UnixDgramLog.prototype.name = 'unix_dgram_log';

UnixDgramLog.prototype.log = function log(level, msg, meta, callback) {
  if (!~levels.indexOf(level)) {
    return callback(new Error(`Cannot log unknown syslog level: ${level}`));
  }

  let syslogMsg = JSON.stringify({
    time: moment().toISOString(),
    level: level.toUpperCase(),
    log: msg,
    ...this.producer
  });

  if (typeof this.prefix === 'string') {
    syslogMsg = `${this.prefix}${syslogMsg}`;
  } else if (typeof this.prefix === 'function') {
    syslogMsg = `${this.prefix()}${syslogMsg}`;
  }

  const onFinish = logErr => {
    if (logErr) {
      this.queue.push(syslogMsg);
    }
    this.emit('logged');
    this.inFlight--;
  };

  const onCongestion = () => {
    onFinish(new Error('Congestion Error'));
  };

  this.connect(err => {
    if (err) {
      this.queue.push(syslogMsg);
      return callback(err);
    }
    const buffer = new Buffer(syslogMsg);
    if (this.congested) {
      this.queue.push(syslogMsg);
    } else {
      this.socket.once('congestion', onCongestion);
      this.socket.once('error', onFinish);
      this.socket.send(buffer, () => {
        this.socket.removeListener('congestion', onCongestion);
        this.socket.removeListener('error', onFinish);
        onFinish();
      });
    }
  });
};

UnixDgramLog.prototype.flushQueue = function flushQueue() {
  let sentMsgs = 0;
  this.queue.forEach(msg => {
    const buffer = new Buffer(msg);
    if (!this.congested) {
      this.socket.send(buffer, () => ++sentMsgs);
    }
  });
  this.queue.splice(0, sentMsgs);
};

UnixDgramLog.prototype.connect = function connect(callback) {
  if (this.socket) {
    return !this.socket.readyState || this.socket.readyState === 'open'
      ? callback(null)
      : callback(true);
  }

  this.socket = unix.createSocket('unix_dgram');
  this.socket.on('error', err => {
    if (err.syscall === 'connect') {
      this.socket.close();
      this.socket = null;
      callback(err);
    }
    if (err.syscall === 'send') {
      this.socket.close();
      this.socket = null;
    }

    this.emit('error', err);
  });

  this.socket.on('connect', () => {
    this.socket.on('congestion', () => {
      this.congested = true;
    });

    this.socket.on('writable', () => {
      this.congested = false;
      this.flushQueue();
    });

    this.flushQueue();
    callback();
  });

  this.socket.connect(this.path);
};

module.exports = UnixDgramLog;
