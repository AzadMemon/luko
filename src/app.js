import https from 'https'
import fs from 'fs'
import { env, mongo, port, ip } from './config'
import mongoose from './services/mongoose'
import express from './services/express'
import api from './api/index'
let winston = require('winston');

let https_options = {
  key: fs.readFileSync('./privkey.pem'),
  cert: fs.readFileSync('./fullchain.pem')
};

const app = express(api);
const server = https.createServer(https_options, app);

mongoose.connect(mongo.uri, mongo.options);

setImmediate(() => {
  server.listen(port, ip, () => {
    winston.info('Express server listening on http://%s:%d, in %s mode', ip, port, env)
  });
});
