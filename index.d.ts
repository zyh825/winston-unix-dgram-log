declare module '@bilibili/winston-unix-dgram-log' {
  import winston = require('winston')
  interface IOptions {
    path: string
    producer?: object | Function
    prefix?: () => string | string
  }

  interface UnixDgramTransportInstance extends winston.TransportInstance {
    new (opts: IOptions): UnixDgramTransportInstance
  }

  module 'winston' {
    interface Transports {
      UnixDgramLog: UnixDgramTransportInstance
    }
    interface LeveledLogMethod {
      (msg: string, callback: LogCallback): winston.LoggerInstance
      (msg: string, meta: any, callback: LogCallback): winston.LoggerInstance
      (msg: string, ...meta: any[]): winston.LoggerInstance
      (msg: object): winston.LoggerInstance
    }
  }

  var UnixDgramLog: UnixDgramTransportInstance
  export = UnixDgramLog
}
