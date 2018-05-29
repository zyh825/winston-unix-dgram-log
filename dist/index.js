"use strict";
var __assign = (this && this.__assign) || Object.assign || function(t) {
    for (var s, i = 1, n = arguments.length; i < n; i++) {
        s = arguments[i];
        for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
            t[p] = s[p];
    }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var moment = require("moment");
var unix = require("unix-dgram");
var util = require("util");
var winston = require("winston");
function UnixDgramLog(options) {
    winston.Transport.call(this, options);
    this.path = options.path;
    if (!fs.existsSync(this.path)) {
        throw new Error('Unable to locate the socket communication socket module.');
    }
    this.connected = false;
    this.congested = false;
    this.retries = 0;
    this.queue = [];
    this.inFlight = 0;
    this.producer = options.producer || {};
    this.prefix = options.prefix;
    this.socket = null;
    this.isObject = function (obj) {
        return Object.prototype.toString.call(obj) === '[object Object]';
    };
}
util.inherits(UnixDgramLog, winston.Transport);
winston.transports.UnixDgramLog = UnixDgramLog;
UnixDgramLog.prototype.name = 'unix_dgram_log';
UnixDgramLog.prototype.log = function log(level, msg, meta, callback) {
    var _this = this;
    var obj = __assign({ time: moment().toISOString(), level: level.toUpperCase() }, this.producer);
    if (this.isObject(meta) && Object.keys(meta).length > 0) {
        obj = Object.assign.apply(Object, [{}, obj].concat(meta));
    }
    else {
        obj.log = msg;
    }
    var syslogMsg = JSON.stringify(obj);
    if (typeof this.prefix === 'string') {
        syslogMsg = "" + this.prefix + syslogMsg;
    }
    else if (typeof this.prefix === 'function') {
        syslogMsg = "" + this.prefix() + syslogMsg;
    }
    var onFinish = function (logErr) {
        if (logErr) {
            _this.queue.push(syslogMsg);
        }
        _this.emit('logged');
        _this.inFlight -= 1;
    };
    var onCongestion = function () {
        onFinish(new Error('Congestion Error'));
    };
    this.connect(function (err) {
        if (err) {
            _this.queue.push(syslogMsg);
            return callback(err);
        }
        var buffer = Buffer.from(syslogMsg);
        if (_this.congested) {
            _this.queue.push(syslogMsg);
        }
        else {
            _this.socket.once('congestion', onCongestion);
            _this.socket.once('error', onFinish);
            _this.socket.send(buffer, function () {
                _this.socket.removeListener('congestion', onCongestion);
                _this.socket.removeListener('error', onFinish);
                onFinish();
            });
        }
        return true;
    });
    return true;
};
UnixDgramLog.prototype.flushQueue = function flushQueue() {
    var _this = this;
    var sentMsgs = 0;
    this.queue.forEach(function (msg) {
        var buffer = Buffer.from(msg);
        if (!_this.congested) {
            _this.socket.send(buffer, function () {
                sentMsgs += 1;
            });
        }
    });
    this.queue.splice(0, sentMsgs);
};
UnixDgramLog.prototype.connect = function connect(callback) {
    var _this = this;
    if (this.socket) {
        return !this.socket.readyState || this.socket.readyState === 'open'
            ? callback(null)
            : callback(true);
    }
    this.socket = unix.createSocket('unix_dgram');
    this.socket.on('error', function (err) {
        if (err.syscall === 'connect') {
            _this.socket.close();
            _this.socket = null;
            callback(err);
        }
        if (err.syscall === 'send') {
            _this.socket.close();
            _this.socket = null;
        }
        _this.emit('error', err);
    });
    this.socket.on('connect', function () {
        _this.socket.on('congestion', function () {
            _this.congested = true;
        });
        _this.socket.on('writable', function () {
            _this.congested = false;
            _this.flushQueue();
        });
        _this.flushQueue();
        callback();
    });
    this.socket.connect(this.path);
    return this.socket;
};
module.exports = UnixDgramLog;
exports.default = UnixDgramLog;
//# sourceMappingURL=index.js.map