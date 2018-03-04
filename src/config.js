/* eslint-disable no-unused-vars */
import path from 'path'
import _ from 'lodash'

/* istanbul ignore next */
const requireProcessEnv = (name) => {
  if (!process.env[name]) {
    throw new Error('You must set the ' + name + ' environment variable')
  }
  return process.env[name]
}

/* istanbul ignore next */
if (process.env.NODE_ENV !== 'production') {
  const dotenv = require('dotenv-safe')
  dotenv.load({
    path: path.join(__dirname, '../.env'),
    sample: path.join(__dirname, '../.env.example')
  })
}

const config = {
  all: {
    env: process.env.NODE_ENV || 'development',
    root: path.join(__dirname, '..'),
    port: process.env.PORT || 3000,
    ip: process.env.IP || '0.0.0.0',
    fbVerifyToken: requireProcessEnv('FB_VERIFY_TOKEN'),
    pageAccessToken: requireProcessEnv('FB_PAGE_ACCESS_TOKEN'),
    appSecret: requireProcessEnv('FB_APP_SECRET'),
    awsTagUS: requireProcessEnv('AWS_TAG_US'),
    awsTagCA: requireProcessEnv('AWS_TAG_CA'),
    awsAccessKeyId: requireProcessEnv('AWS_ACCESS_KEY'),
    awsSecretAccessKey: requireProcessEnv('AWS_SECRET_KEY'),
    mongo: {
      options: {
        db: {
          safe: true
        }
      }
    }
  },
  test: {
    mongo: {
      uri: 'mongodb://localhost/luko-test',
      options: {
        debug: false,
        server: {
          socketOptions: {
            keepAlive: 120
          }
        }
      }
    }
  },
  development: {
    mongo: {
      // uri: 'mongodb://heroku_8zll3gv5:cchqli8qkev1nvooc5fkmk2si@ds021172.mlab.com:21172/heroku_8zll3gv5',
      uri: 'mongodb://localhost/luko-dev',
      options: {
        keepAlive: 120,
        loggerLevel: 'info',
        autoReconnect: true,
        reconnectTries: Number.MAX_VALUE,
        useMongoClient: true
      }
    }
  },
  production: {
    ip: process.env.IP || undefined,
    port: process.env.PORT || 3000,
    mongo: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost/luko',
      options: {
        server: {
          socketOptions: {
            keepAlive: 120
          }
        }
      }
    }
  }
}

module.exports = _.merge(config.all, config[config.all.env])
export default module.exports
