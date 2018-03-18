import async from 'async';
import Product from './schema/product';
import ProductUser from './schema/productUser';
import User from './schema/user';
import UpdatedProduct from './schema/updatedProduct';
import bot from './../services/facebook/messengerbot';
import textMessage from './textMessage';
import amazon from "./amazon";
let winston = require('winston');
let Q = require('q');
import _ from 'lodash';

let WINSTON_CRON = "CRON_JOB: ";

function periodicUpdate(req, res) {
  let batchId = Date.now();
  winston.info(WINSTON_CRON + "Started cron job");

  if (req.body.key !== process.env.CRON_SECRET_KEY) {
    winson.error(WINSTON_CRON + "Key doesn't match");
    return res.send("Done with error");
  }

  async.waterfall([
    forEachProduct,
    forEachUpdatedProduct,
    cleanUpUpdatedProductCollection,
  ], finalCallback);

  function forEachProduct(waterfallNext) {
    const productCursor = Product
      .find({})
      .cursor();

    productCursor
      .eachAsync(doc => updatedProductPrice(doc, batchId))
      .then(() => waterfallNext());
  }

  function forEachUpdatedProduct(waterfallNext) {
    const updatedProductCursor = UpdatedProduct
      .find({batchId: batchId})
      .cursor();

    updatedProductCursor
      .eachAsync(doc => forEachProductUser(doc.productId))
      .then(() => waterfallNext());
  }

  function forEachProductUser(productId) {
    winston.info(WINSTON_CRON + "Iterating over each updated product's productUser");
    let deferred = Q.defer();

    const productUserCursor = ProductUser
      .find({productId: productId})
      .cursor();

    productUserCursor
      .eachAsync(doc => notifyUser(doc))
      .then(() => deferred.resolve());

    return deferred.promise;
  }

  function cleanUpUpdatedProductCollection(waterfallNext) {
    UpdatedProduct
      .deleteMany(
        {batchId: batchId},
        function (error, response) {
          if (error) {
            winston.error(error);
          }

          return waterfallNext();
        }
      );
  }

  function finalCallback() {
    winston.info(WINSTON_CRON + "Finished cron job");
    res.send("Done.");
  }
}

function updatedProductPrice(product, batchId) {
  winston.info(WINSTON_CRON + "Updating product price");
  let deferred = Q.defer();

  async.waterfall([
    getAmazonProductInfo,
    updateProductPriceInfo,
    addToAlertList
  ], finalCallback);

  function getAmazonProductInfo(waterfallNext) {
    let client = amazon.getClient(product.link);

    amazon
      .getProduct(product.asin, client)
      .then(function (productResult) {
        if (!!_.get(productResult, 'result.ItemLookupResponse.Items.Request.Errors.Error')) {
          return waterfallNext(textMessage.productNotFoundErrorMessage);
        }

        return waterfallNext(null, productResult);
      })
      .catch(function () {
        return waterfallNext(textMessage.productNotFoundErrorMessage);
      });
  }

  function updateProductPriceInfo(productResult, waterfallNext) {
    let currencyCode = _.get(productResult, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.CurrencyCode');
    let amount = _.get(productResult, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.Amount');
    let formattedAmount = _.get(productResult, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.FormattedPrice');

    if (!formattedAmount || formattedAmount.toLowerCase() === "too low to display") {
      return waterfallNext("Too low to display: " + product.asin);
    }

    Product
      .findOneAndUpdate(
        {_id: product._id},
        {
          modifiedAt: Date.now(),
          currentPrice: {
            amount: amount,
            formattedAmount: formattedAmount,
            currencyCode: currencyCode,
            date: Date.now()
          },
          $push: {
            priceHistory: {
              amount: product.currentPrice.amount,
              formattedAmount: product.currentPrice.formattedAmount,
              currencyCode: product.currentPrice.currencyCode,
              date: product.currentPrice.date
            }
          }
        },
        {
          new: true
        },
        function (error, result) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext(null, result, product.currentPrice.amount);
        });
  }

  function addToAlertList(product, oldAmount, waterfallNext) {
    if (product.currentPrice.amount >= oldAmount) {
      return waterfallNext();
    }

    UpdatedProduct
      .update(
        {
          productId: product._id
        },
        {
          productId: product._id,
          batchId: batchId,
          modifiedAt: Date.now()
        },
        {upsert: true},
        function (error) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext();
        });
  }

  function finalCallback(error) {
    if (error) {
      winston.error(WINSTON_CRON + error);
    }

    deferred.resolve();
  }

  return deferred.promise;
}

function notifyUser(productUser) {
  let deferred = Q.defer();

  async.waterfall([
    getProduct,
    getUser,
    sendAlert
  ], finalCallback);

  function getProduct(waterfallNext) {
    Product
      .findOne(
        {_id: productUser.productId},
        function (error, product) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext(null, product);
        });
  }

  function getUser(product, waterfallNext) {
    User
      .findOne(
        {_id: productUser.userId},
        function (error, user) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext(null, product, user);
        });
  }

  function sendAlert(product, user, waterfallNext) {
    if (productUser.thresholdPrice[productUser.thresholdPrice.length - 1].amount <= product.currentPrice.amount) {
      return waterfallNext();
    }

    bot.sendMessage(
      user.fbUserId,
      {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [{
              title: "PRICE DROP ALERT - " + product.title,
              subtitle: product.publisher +
              "\nCurrent Price: " + product.currentPrice.formattedAmount +
              "\nAlert Price: " + productUser.thresholdPrice[productUser.thresholdPrice.length - 1].formattedAmount,
              item_url: product.link,
              image_url: product.imageUrl.large || product.imageUrl.medium || product.imageUrl.small,
              buttons: [
                {
                  type: "web_url",
                  url: product.link,
                  title: "Purchase Product"
                },
                {
                  type: "postback",
                  title: "Update Alert Price",
                  payload: "UpdatePrice:::" + product.asin + ":::" + product.link
                },
                {
                  type: "postback",
                  title: "Stop Tracking",
                  payload: "StopTracking:::" + product.asin + ":::" + product.link
                }
              ]
            }]
          }
        }
      },
      "MESSAGE_TAG",
      "NON_PROMOTIONAL_SUBSCRIPTION",
      function(error, resp) {
        if (error) {
          winston.error(error);
        }
      });

    waterfallNext();
  }

  function finalCallback(error) {
    if (error) {
      winston.error(WINSTON_CRON + error);
    }

    deferred.resolve();
  }

  return deferred.promise;
}

module.exports = {
  periodicUpdate: periodicUpdate
}
