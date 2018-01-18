import async from 'async'

const Product = require('./schema/product');
const bot = require('./../services/facebook/messengerbot');

function sendPriceDropNotification(userId, productId, res) {
  async.waterfall([
    getProduct,
    sendNotification
  ], finalCallback);

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
    // TODO: need to set message type here because this won't be in the 24 hour window

    textMessage.sendTextMessage(userId, "Hey, the price for one of your products dropped!");
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

module.exports = {
  sendPriceDropNotification: sendPriceDropNotification
}
