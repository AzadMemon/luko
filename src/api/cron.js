import async from 'async';
import Product from './schema/product';
import ProductUser from './schema/productUser';
import User from './schema/user';
import UpdatedProduct from './schema/updatedProduct';
import bot from './../services/facebook/messengerbot';
import textMessage from './textMessage';
import amazon from "./amazon";

function periodicUpdate(res, req) {
  let batchId = 1; // TODO: change this to timestamp
  console.log("Started cron job");

  async.waterfall([
    forEachProduct,
    forEachUpdatedProduct
  ], finalCallback);

  function forEachProduct(waterfallNext) {
    const productCursor = Product
      .find({})
      .cursor();

    productCursor
      .eachAsync(doc => {
        updatedProductPrice(doc)
      })
      .then(() => {
        waterfallNext();
      });
  }

  function forEachUpdatedProduct(waterfallNext) {
    const updatedProductCursor = UpdatedProduct
      .find({batchId: batchId})
      .cursor();

    updatedProductCursor
      .eachAsync(doc => {
        forEachProductUser(doc._id);
      })
      .then(() => {
        waterfallNext();
      });
  }

  function finalCallback() {
    winston.log("Finished cron job");
  }

  function forEachProductUser(productId) {
    // TODO: Return a promise that's resolved in the finalCallback

    const productUserCursor = ProductUser
      .find({productId: productId})
      .cursor();

    productUserCursor
      .eachAsync(doc => {
        notifyUser(doc);
      })
      .then(() => {

      });
  }
}

function updatedProductPrice(product) {
  // TODO: Return a promise that's resolved in the finalCallback
  async.waterfall([
    getAmazonProductInfo,
    updateProductPriceInfo,
    addToAlertList
  ], finalCallback);

  function getAmazonProductInfo(waterfallNext) {
    let client = amazon.getClient(product.link);

    amazon.getProduct(product.asin, client)
      .then(function (product) {
        // TODO: the error format changed
        if (!!_.get(product, 'result.ItemLookupResponse.Items.Request.Errors.Error')) {
          return waterfallNext(textMessage.productNotFoundErrorMessage);
        }

        return waterfallNext(null, product);
      }).catch(function () {
      return waterfallNext(textMessage.productNotFoundErrorMessage);
    });
  }

  function updateProductPriceInfo(productResults, waterfallNext) {
    let currencyCode = _.get(productResults, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.CurrencyCode');
    let amount = _.get(productResults, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.Amount');
    let formattedAmount = _.get(productResults, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.FormattedPrice');

    Product
      .update(
        {_id: product._id},
        {
          currentPrice: {
            amount: amount,
            formattedAmount: formattedAmount,
            currencyCode: currencyCode,
            date: Date.now()
          },
          $push : {
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
    if (product.currentPrice.amount < oldAmount) {
      UpdatedProduct
        .upsert(
          {productId: product._id},
          {productId: product._id},
          function (error) {
            if (error) {
              return waterfallNext(error);
            }

            return waterfallNext();
          });
    } else {
      return waterfallNext();
    }
  }

  function finalCallback(error) {
    if (error) {
      return winston.error(error);
    }
  }
}

function notifyUser(productUser) {
  // TODO: Return a promise that's resolved in the finalCallback

  async.waterfall([
    getProduct,
    getUser,
    sendAlert
  ], finalCallback);

  function getProduct(waterfallNext) {
    Product
      .find(
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
      .find(
        { userId: productUser.userId},
        function (error, user) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext(null, product, user);
        });
  }

  function sendAlert(product, user, waterfallNext) {
    textMessage.send(user.fbUserId, "Hey, the price for one of your products dropped!");
    bot.sendMessage(user.fbUserId, {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: product.title,
            subtitle: product.publisher + ' - ' + product.currentPrice.formattedAmount,
            item_url: product.link,
            image_url: product.imageUrl,
            buttons: [
              {
                type: "web_url",
                url: product.link,
                title: "Purchase Product"
              },
              {
                type: "postback",
                title: "Notify me when price drops below " + product.currentPrice.formattedAmount,
                payload: "UpdatePriceGiven:::" + product.asin + ":::" + JSON.stringify(product.currentPrice)
              },
              {
                type: "postback",
                title: "Stop Tracking",
                payload: "StopTracking:::" + product.asin + ":::" + product.link
              },
              {
                type: "postback",
                title: "Pause Notifications",
                payload: "PauseNotifications:::" + product.asin + ":::" + product.link
              }
            ]
          }]
        }
      }
    });

    waterfallNext();
  }

  function finalCallback(error) {
    if (error) {
      return winston.error(error);
    }
  }
}

module.exports = {
  periodicUpdate: periodicUpdate
}
