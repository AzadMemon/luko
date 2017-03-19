import config from './../../config'

const Bot = require('messenger-bot');

var bot = new Bot({
  token: config.pageAccessToken,
  verify: config.fbVerifyToken,
  app_secret: config.appSecret
});

module.exports = bot;


