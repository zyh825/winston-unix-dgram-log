# WINSTON-UNIX-DGRAM-LOG

unix-dgram plugin for winston logger

## INSTALL

`npm i winston-unix-dgram-log`

## HOW TO USE

```javascript 
  // example
  transports.push(
    new winston.transports.UnixDgramLog({
      path: env.LOG_AGENT_SOCK_PATH,
      producer: {
        app_id: 'activity-plat',
        instance_id: `${os.hostname()}_${process.pid}`
      },
      prefix: () => `${env.LOG_ID}${moment().valueOf()}`
    })
  );
```

