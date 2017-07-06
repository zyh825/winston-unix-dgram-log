'use strict';

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
  this.producer = options.produce || {};
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

  var syslogMsg = JSON.stringify(Object.assign({
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
      _this.queue.push(syslogMsg);
    }
    _this.emit('logged');
    _this.inFlight--;
  };

  var onCongestion = function onCongestion() {
    onError(new Error('Congestion Error'));
  };

  this.connect(function (err) {
    if (err) {
      _this.queue.push(syslogMsg);
      return callback(err);
    }
    var buffer = new Buffer(syslogMsg);
    if (_this.congested) {
      _this.queue.push(syslogMsg);
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

UnixDgramLog.prototype.connect = function connect(callback) {
  var _this3 = this;

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

  this.socket.on('connect', function () {
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
