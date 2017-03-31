import {Router} from 'express'
import config from './../config'
import _ from 'lodash'
import async from 'async'

const User = require('./schema/user');
const Product = require('./schema/product');
const ProductUser = require('./schema/productUser');
const request = require('request');
const {OperationHelper} = require('apac');
const getUrls = require('get-urls');
const nodeUrl = require('url');
const bot = require('./../services/facebook/messengerbot');
const router = new Router();
const client_ca = new OperationHelper({
  awsId: config.awsAccessKeyId,
  awsSecret: config.awsSecretAccessKey,
  assocId: config.awsTagCA,
  maxRequestsPerSecond: 1,
  locale: 'CA'
});
const client_us = new OperationHelper({
  awsId: config.awsAccessKeyId,
  awsSecret: config.awsSecretAccessKey,
  assocId: config.awsTagUS,
  maxRequestsPerSecond: 1,
  locale: 'US'
});

router.get('/*', (req, res) => {
  return bot._verify(req, res)
})

router.post('/sendPriceDrop', (req, res) => {
  sendPriceDropNotification(req.body.userId, req.body.productId, res);
});

router.post('/*', (req, res) => {
  bot._handleMessage(req.body)
  res.end(JSON.stringify({status: 'ok'}))
})

bot.on('error', (err) => {
  console.log(err.message)
})

bot.on('message', function (payload, reply, actions) {
  var senderId = payload.sender.id;
  var messageText = payload.message.text;

  var urls = getUrls(messageText);
  if (urls.size) {
    if (urls.size > 1) {
      // TODO: Maybe iterate over links to service all links?
      return sendErrorTextMessage(senderId);
    }

    var amazonUrl = Array.from(urls)[0];
    var amazonASIN = extractASIN(amazonUrl);

    if (!amazonASIN) {
      return sendErrorTextMessage(senderId);
    }

    var client = getClientByUrl(amazonUrl)

    if (!client) {
      return sendWrongCountryTextMessage(senderId);
    }

    return getAmazonProduct(amazonASIN, client)
      .then(function (results) {
        if (_.get(results, 'result.ItemLookupResponse.Items.Request.Errors.Error')) {
          return sendIllFormedTextMessage(senderId);
        }

        sendConfirmTrackMessage(senderId, results);
      }).catch(function (error) {
        sendErrorTextMessage(senderId);
      });
  }

  if (messageText) {
    switch (messageText) {
      case 'Manage My Products':
      // TODO: send something
      case 'Help':
      // TODO: send something
      case 'Add a Product':
      // TODO: send something
      default:
        return sendErrorTextMessage(senderId);
    }
  }

  sendErrorTextMessage(senderId);
});

bot.on('postback', (payload, reply, actions) => {
  var senderId = payload.sender.id;
  var payload = payload.postback.payload;

  if (payload.includes('Track')) {
    var info = payload.split(":::");
    var asin = info[1];
    var url = info[2];

    trackProduct(senderId, asin, url);
  } else if (payload == 'Get Started') {
    createUser(senderId);
    sendIntroMessage(senderId);
  } else if (payload == 'Manage My Products') {
    // TODO: Return something
  } else if (payload == 'Add a Product') {
    // TODO: Return something
  } else if (payload == 'Help') {
    // TODO: Return something
  }
})

function sendIntroMessage(recipientId) {
  sendTextMessage(
    recipientId,
    "Hey! I’m Luko, a price tracking bot for Amazon products. " +
    "Have a product you’re interested in but you aren’t willing to pay? " +
    "No PROBLEM! Simply paste the product link here and I’ll message you if the price drops."
  );
}

function sendWrongCountryTextMessage(recipientId) {
  sendTextMessage(
    recipientId,
    "I’m sorry, but I currently only work with Amazon's Canada and U.S. stores. I’ve noted that you’re interested and " +
    "I’ll be sure to notify you when I've learnt how to work with stores in that area!"
  )
}

function sendIllFormedTextMessage(reply) {
  sendTextMessage(
    reply,
    "I’m sorry, I couldn’t find that product, are you sure your link is correct?"
  );
}

function sendErrorTextMessage(recipientId) {
  sendTextMessage(
    recipientId,
    "Sorry I didn't quite understand that! I only speak in Amazon Links. " +
    "Can you try pasting that Amazon link again?"
  );
}

function kindleEbookNotSupportedMessage(recipientId) {
  sendTextMessage(
    recipientId,
    "Sorry, but at this time, Amazon doesn't let me track Kindle books. Try pasting a different product link!"
  );
}

function sendTextMessage(recipientId, messageText) {
  bot.sendMessage(recipientId, {text: messageText});
}

function sendConfirmTrackMessage(recipientId, results) {
  var detailPageUrl = _.get(results, 'result.ItemLookupResponse.Items.Item.DetailPageURL');
  var lowestNewPrice = _.get(results, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.FormattedPrice');
  var largeImageUrl = _.get(results, 'result.ItemLookupResponse.Items.Item.LargeImage.URL');
  var mediumImageUrl = _.get(results, 'result.ItemLookupResponse.Items.Item.MediumImage.URL');
  var smallImageUrl = _.get(results, 'result.ItemLookupResponse.Items.Item.SmallImage.URL');
  var publisher = _.get(results, 'result.ItemLookupResponse.Items.Item.ItemAttributes.Publisher');
  var title = _.get(results, 'result.ItemLookupResponse.Items.Item.ItemAttributes.Title');
  var format = _.get(results, 'result.ItemLookupResponse.Items.Item.ItemAttributes.Format');

  if (format && format.toLowerCase() == 'kindle ebook') {
    return kindleEbookNotSupportedMessage(recipientId);
  }

  bot.sendMessage(recipientId, {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        elements: [{
          title: title,
          subtitle: publisher + ' - ' + lowestNewPrice,
          item_url: detailPageUrl,
          image_url: largeImageUrl || mediumImageUrl || smallImageUrl,
          buttons: [{
            type: "web_url",
            url: detailPageUrl,
            title: "View Product"
          }, {
            type: "postback",
            title: "Track",
            payload: "Track:::" + _.get(results, 'result.ItemLookupResponse.Items.Item.ASIN') + ":::" + detailPageUrl
          }]
        }]
      }
    }
  });
}

function trackProduct(userId, asin, url) {
  async.waterfall([
    retrieveProduct,
    getProduct,
    getUser,
    addTrackingRelationship
  ], finalCallback);

  function retrieveProduct(waterfallNext) {
    var client = getClientByUrl(url);

    getAmazonProduct(asin, client)
      .then(function (amazonResult) {
        if (_.get(amazonResult, 'result.ItemLookupResponse.Items.Request.Errors.Error')) {
          return waterfallNext(new Error('Amazon returned an error'));
        }

        waterfallNext(null, amazonResult);
      })
      .catch(function (error) {
        waterfallNext(error);
      });
  }

  function getProduct(amazonResult, waterfallNext) {
    var store = getStoreByUrl(url);
    var detailPageUrl = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.DetailPageURL');
    var currencyCode = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.CurrencyCode');
    var amount = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.Amount');
    var formattedAmount = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.FormattedPrice');
    var largeImageUrl = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.LargeImage.URL');
    var mediumImageUrl = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.MediumImage.URL');
    var smallImageUrl = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.SmallImage.URL');
    var publisher = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.ItemAttributes.Publisher');
    var title = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.ItemAttributes.Title');

    Product.findOneAndUpdate(
      {
        store: getStoreByUrl(url),
        asin: asin
      },
      {
        link: detailPageUrl,
        asin: asin,
        currentPrice: {
          amount: amount,
          formattedAmount: formattedAmount,
          currencyCode: currencyCode
        },
        $push: {
          priceHistory: {
            date: Date.now(),
            amount: amount,
            formattedAmount: formattedAmount,
            currencyCode: currencyCode
          }
        },
        store: store,
        imageUrl: largeImageUrl || mediumImageUrl || smallImageUrl,
        title: title,
        seller: publisher
      },
      {upsert: true, new: true},
      waterfallNext
    );
  }

  function getUser(product, waterfallNext) {
    User.findOne(
      {fbUserId: userId},
      function (error, user) {
        if (error) {
          return waterfallNext(error);
        } else if (!user) {
          return waterfallNext(new Error("Couldn't find user in database"));
        }

        waterfallNext(null, user, product);
      });
  }

  function addTrackingRelationship(user, product, waterfallNext) {
    ProductUser.findOneAndUpdate(
      {
        productId: product._id,
        userId: user._id
      },
      {
        productId: product._id,
        userId: user._id,
        thresholdPrice: {
          amount: product.currentPrice.amount,
          formattedAmount: product.currentPrice.formattedAmount,
          currencyCode: product.currentPrice.currencyCode
        },
        isTracking: true,
        lastNotified: Date.now()
      },
      {upsert: true, new: true},
      waterfallNext
    )
  }

  function finalCallback(error, result) {
    if (error) {
      console.log(error);
      return sendTextMessage(userId, "Ooops, something went wrong with my magical amazon commmunication skills. Try again in a bit!");
    }

    return sendTextMessage(userId, "Great, I’ll let you know when the price drops. Remember you can always just paste a link for the next product you want to track!");
  }
}

function createUser(userId) {
  async.waterfall([
    getProfile,
    findOrCreateUser
  ], finalCallback);

  function getProfile(waterfallNext) {
    bot.getProfile(userId, function (error, profile) {
      if (error) {
        return waterfallNext(error);
      }

      waterfallNext(null, profile);
    })
  }

  function findOrCreateUser(profile, waterfallNext) {
    User.findOne(
      {fbUserId: userId},
      {
        fbUserId: userId,
        firstName: profile.first_name,
        lastName: profile.last_name,
        timezone: profile.timezone,
        gender: profile.gender,
        locale: profile.locale
      },
      {upsert: true, new: true},
      function (error, result) {
        if (error) {
          return waterfallNext(error);
        }

        waterfallNext(null, result);
      });
  }

  function finalCallback(error) {
    if (error) {
      console.log(error);
    }
  }
}

function sendPriceDropNotification(userId, productId, res) {
  async([
    getProduct,
    sendNotification
  ]);

  function getProduct(waterfallNext) {
    Product.findById(productId, function(error, result) {
      if (error) {
        return waterfallNext(error);
      }

      if (!result) {
        return waterfallNext(new Error("Product not found when attempting to notify user of price drop."));
      }

      waterfallNext(null, result);
    });
  }

  function sendNotification(product, waterfallNext) {
    sendTextMessage(userId, "Hey, the price for one of your products dropped!");
    bot.sendMessage(userId, {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: product.title,
            subtitle: product.seller + ' - ' + product.currentPrice.formattedAmount,
            item_url: product.link,
            image_url:  product.imageUrl,
            buttons: [
              {
                type: "web_url",
                url: product.link,
                title: "Purchase Product"
              },
              {
                type: "postback",
                title: "Notify me when price drops below " + prodcut.currentPrice.formattedAmount,
                payload: "UpdateThreshold:::" + product._id + ":::" + JSON.stringify(product.currentPrice)
              },
              {
                type: "postback",
                title: "Stop Tracking",
                payload: "StopTracking:::" + product._id
              }
            ]
          }]
        }
      }
    });

    return waterfallNext(null);
  }

  function finalCallback(error) {
    if (error) {
      console.log(error);
    }

    res.end(JSON.stringify({status: 'ok'}))
  }
}

function getClientByUrl(url) {
  if (url.includes('amazon.com')) {
    return client_us;
  } else if (url.includes('amazon.ca')) {
    return client_ca;
  }
}

function getStoreByUrl(url) {
  if (url.includes('amazon.com')) {
    return 'amazon.com'
  } else if (url.includes('amazon.ca')) {
    return 'amazon.ca'
  }
}

function getAmazonProduct(asin, client) {
  return client.execute('ItemLookup', {
    IdType: 'ASIN',
    ItemId: asin,
    ResponseGroup: 'Images, ItemAttributes, OfferFull'
  })
}

function extractASIN(url) {
  var parsedUrl = nodeUrl.parse(decodeURIComponent(url));

  if (parsedUrl != null && parsedUrl.hostname != null && parsedUrl.hostname.includes("amazon")) {
    var paths = parsedUrl.pathname.split('/');
    var index = _.indexOf(paths, 'product') == -1 ? _.indexOf(paths, 'dp') : _.indexOf(paths, 'product');

    return index != -1 ? paths[index + 1] : '';
  }

  return '';
}

export default router
