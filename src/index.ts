import * as fs from 'fs'
import * as moment from 'moment'
import * as unix from 'unix-dgram'
import * as util from 'util'
import * as winston from 'winston'

export interface UnixDgramLogOptions {
  path: string
  producer: any
  prefix: () => string | string
}

function UnixDgramLog(options: UnixDgramLogOptions) {
  winston.Transport.call(this, options)

  // Extract options
  this.path = options.path

  if (!fs.existsSync(this.path)) {
    throw new Error('Unable to locate the socket communication socket module.')
  }

  // Setup connection state
  this.connected = false
  this.congested = false
  this.retries = 0
  this.queue = []
  this.inFlight = 0

  // Setup log producer
  this.producer = options.producer || {}
  this.prefix = options.prefix

  // Setup socket
  this.socket = null

  this.isObject = (obj: any) => {
    return Object.prototype.toString.call(obj) === '[object Object]'
  }
}

util.inherits(UnixDgramLog, winston.Transport)
;(winston.transports as any).UnixDgramLog = UnixDgramLog

UnixDgramLog.prototype.name = 'unix_dgram_log'

UnixDgramLog.prototype.log = function log(
  level: winston.CLILoggingLevel,
  msg: string,
  meta: any,
  callback: winston.LogCallback,
) {
  let obj = {
    time: moment().toISOString(),
    level: level.toUpperCase(),
    ...this.producer,
  }

  // log custom field info
  if (this.isObject(meta) && Object.keys(meta).length > 0) {
    obj = Object.assign({}, obj, ...meta)
  } else {
    obj.log = msg
  }

  let syslogMsg = JSON.stringify(obj)

  if (typeof this.prefix === 'string') {
    syslogMsg = `${this.prefix}${syslogMsg}`
  } else if (typeof this.prefix === 'function') {
    syslogMsg = `${this.prefix()}${syslogMsg}`
  }

  const onFinish = (logErr?: string | Error) => {
    if (logErr) {
      this.queue.push(syslogMsg)
    }
    this.emit('logged')
    this.inFlight -= 1
  }

  const onCongestion = () => {
    onFinish(new Error('Congestion Error'))
  }

  this.connect((err: Error) => {
    if (err) {
      this.queue.push(syslogMsg)
      return callback(err)
    }
    const buffer = Buffer.from(syslogMsg)
    if (this.congested) {
      this.queue.push(syslogMsg)
    } else {
      this.socket.once('congestion', onCongestion)
      this.socket.once('error', onFinish)
      this.socket.send(buffer, () => {
        this.socket.removeListener('congestion', onCongestion)
        this.socket.removeListener('error', onFinish)
        onFinish()
      })
    }
    return true
  })

  return true
}

UnixDgramLog.prototype.flushQueue = function flushQueue() {
  let sentMsgs = 0
  this.queue.forEach((msg: string) => {
    const buffer = Buffer.from(msg)
    if (!this.congested) {
      this.socket.send(buffer, () => {
        sentMsgs += 1
      })
    }
  })
  this.queue.splice(0, sentMsgs)
}

UnixDgramLog.prototype.connect = function connect(callback: any) {
  if (this.socket) {
    return !this.socket.readyState || this.socket.readyState === 'open'
      ? callback(null)
      : callback(true)
  }

  this.socket = unix.createSocket('unix_dgram')
  this.socket.on('error', (err: any) => {
    if (err.syscall === 'connect') {
      this.socket.close()
      this.socket = null
      callback(err)
    }
    if (err.syscall === 'send') {
      this.socket.close()
      this.socket = null
    }

    this.emit('error', err)
  })

  this.socket.on('connect', () => {
    this.socket.on('congestion', () => {
      this.congested = true
    })

    this.socket.on('writable', () => {
      this.congested = false
      this.flushQueue()
    })

    this.flushQueue()
    callback()
  })

  this.socket.connect(this.path)

  return this.socket
}

module.exports = UnixDgramLog
export default UnixDgramLog
