'use strict';

var _extends = Object.assign || function (target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i];

    for (var key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        target[key] = source[key];
      }
    }
  }

  return target;
};

var unix = require('unix-dgram');
var util = require('util');
var winston = require('winston');
var moment = require('moment');

var levels = Object.keys({
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  crit: 5,
  alert: 6,
  emerg: 7
});

var noop = function noop() {};

var MAX_CACHED_LOGS = 10000;

var UnixDgramLog = function UnixDgramLog() {
  var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

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
  var _this = this;

  if (!~levels.indexOf(level)) {
    return callback(new Error('Cannot log unknown syslog level: ' + level));
  }

  var syslogMsg = JSON.stringify(_extends({
    time: moment().toISOString(),
    level: level.toUpperCase(),
    log: msg
  }, this.producer));

  if (typeof this.prefix === 'string') {
    syslogMsg = '' + this.prefix + syslogMsg;
  } else if (typeof this.prefix === 'function') {
    syslogMsg = '' + this.prefix() + syslogMsg;
  }

  var onError = function onError(logErr) {
    if (logErr) {
      _this.cacheLog(syslogMsg);
    }
    _this.emit('logged');
    _this.inFlight--;
  };

  var onCongestion = function onCongestion() {
    onError(new Error('Congestion Error'));
  };

  this.connect(function (err) {
    if (err) {
      _this.cacheLog(syslogMsg);
      return callback(err);
    }
    var buffer = new Buffer(syslogMsg);
    if (_this.congested) {
      _this.cacheLog(syslogMsg);
    } else {
      _this.socket.once('congestion', onCongestion);
      _this.socket.once('error', onError);
      _this.socket.send(buffer, function () {
        _this.socket.removeListener('congestion', onCongestion);
        _this.socket.removeListener('error', onError);
        onError();
      });
    }
  });
};

UnixDgramLog.prototype.cacheLog = function cacheLog(syslogMsg) {
  // maintain a queue to avoid losing logs when connection fails
  if (this.queue.length > MAX_CACHED_LOGS) {
    this.queue.shift();
  }
  this.queue.push(syslogMsg);
};

UnixDgramLog.prototype.close = function close() {
  var self = this;
  var max = 6;
  var attempt = 0;
  (function _close() {
    if (attempt >= max || self.queue.length === 0 && self.inFlight <= 0) {
      if (self.socket) {
        self.socket.close();
      }
      self.emit('closed', self.socket);
    } else {
      attempt++;
      setTimeout(_close, 200 * attempt);
    }
  })();
};

UnixDgramLog.prototype.flushQueue = function flushQueue() {
  var _this2 = this;

  var sentMsgs = 0;
  this.queue.forEach(function (msg) {
    var buffer = new Buffer(msg);
    if (!_this2.congested) {
      _this2.socket.send(buffer, function () {
        return ++sentMsgs;
      });
    }
  });
  this.queue.splice(0, sentMsgs);
};

UnixDgramLog.prototype.connect = function connect() {
  var _this3 = this;

  var callback = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : noop;

  if (this.socket) {
    return !this.socket.readyState || this.socket.readyState === 'open' ? callback(null) : callback(true);
  }

  this.socket = unix.createSocket('unix_dgram');

  this.socket.on('error', function (err) {
    if (err.syscall === 'connect') {
      _this3.socket.close();
      _this3.socket = null;
      callback(err);
    }

    if (err.syscall === 'send') {
      _this3.socket.close();
      _this3.socket = null;
    }

    _this3.emit('error', err);
  });

  this.socket.on('close', function () {
    // Attempt to reconnect on lost connection(s), progressively
    // increasing the amount of time between each try.
    var interval = Math.pow(2, _this3.retries);
    _this3.congested = false;
    setTimeout(function () {
      _this3.retries++;
      _this3.connect();
    }, interval * 1000);
  });

  this.socket.on('connect', function () {
    _this3.retries = 0;
    _this3.congested = true;

    _this3.socket.on('congestion', function () {
      _this3.congested = true;
    });

    _this3.socket.on('writable', function () {
      _this3.congested = false;
      _this3.flushQueue();
    });

    _this3.flushQueue();
    callback();
  });

  this.socket.connect(this.path);
};

module.exports = UnixDgramLog;
