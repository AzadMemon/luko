import _ from 'lodash';
import async from 'async';
import getUrls from 'get-urls';

import User from './schema/user';
import Product from './schema/product';
import ProductUser from './schema/productUser';

import bot from './../services/facebook/messengerbot';
import textMessage from './textMessage';
import amazon from './amazon';

bot.on('error', (err) => {
  winston.error(err.message)
})

bot.on('message', function (payload, reply, actions) {
  let senderId = payload.sender.id;
  let message = payload.message.text;

  if (getUrls(message).size > 0) {
    return parseProductUrl(senderId, message);
  } else if (message === 'Get Started') {
    createUser(senderId);
    textMessage.send(senderId, textMessage.introMessage);
  } else if (!isNaN(parseFloat(message))) {
    return updateProductUserThreshold(senderId, message);
  } else {
    return textMessage.send(senderId, textMessage.genericErrorMessage);
  }
});

bot.on('postback', (payload, reply, actions) => {
  let senderId = payload.sender.id;
  let metadataPayload = payload.postback.payload;// TODO:F
  // Better name for this?

  if (metadataPayload.includes('Track:::')) {
    let info = metadataPayload.split(":::");
    let asin = info[1];
    let url = info[2];
    trackProduct(senderId, asin, url);
  } else if (metadataPayload.includes('StopTracking:::')) {
    let info = metadataPayload.split(":::");
    let asin = info[1];
    let url = info[2];
    stopTracking(senderId, asin, url);
  } else if (metadataPayload.includes('UpdatePrice:::')) {
    let info = metadataPayload.split(":::");
    let asin = info[1];
    let url = info[2];
    tagProductUserForPriceUpdate(senderId, asin, url)
  } else if (metadataPayload === 'Get Started') {
    createUser(senderId);
    textMessage.send(senderId, textMessage.introMessage);
  } else if (metadataPayload === 'PRODUCT_MANAGE_PAYLOAD') {
    displayTrackedProducts(senderId, 0);
  } else if (metadataPayload.search('PRODUCT_MANAGE_PAYLOAD:::\d+')){
    let offset = metadataPayload.substring(25, metadataPayload.length);
    displayTrackedProducts(senderId, offset);
  } else if (metadataPayload === 'Help') {
    textMessage.send(senderId, textMessage.introMessage);
  }
});

function parseProductUrl(userId, message) {
  async.waterfall([
    resolveUrl,
    resolveAsin,
    resolveProduct,
    validateProduct,
    sendConfirmCorrectProduct,
  ], finalCallback);

  function resolveUrl(waterfallNext) {
    let urls = getUrls(message);

    // Invalid url
    let isInvalidUrl = !urls || urls.size !== 1;
    if (isInvalidUrl) {
      return waterfallNext(textMessage.genericErrorMessage);
    }

    let amazonUrl = Array.from(urls)[0];
    if (!amazon.isSupportedCountry(amazonUrl)) {
      return waterfallNext(textMessage.unsupportedCountryErrorMessage);
    }

    return waterfallNext(null, amazonUrl);
  }

  function resolveAsin(amazonUrl, waterfallNext) {
    let amazonAsin = amazon.extractAsin(amazonUrl);
    if (!amazonAsin) {
      return waterfallNext(textMessage.productNotFoundErrorMessage);
    }
    return waterfallNext(null, amazonUrl, amazonAsin);
  }

  function resolveProduct(amazonUrl, amazonAsin, waterfallNext) {
    let client = amazon.getClient(amazonUrl)

    amazon.getProduct(amazonAsin, client)
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

  function validateProduct(productResults, waterfallNext) {
    if (amazon.isUnSupportedProduct(productResults)) {
      return waterfallNext(textMessage.unSupportedProductErrorMessage);
    }

    return waterfallNext(null, productResults);
  }

  function sendConfirmCorrectProduct(productResults, waterfallNext) {
    let detailPageUrl = _.get(productResults, 'result.ItemLookupResponse.Items.Item.DetailPageURL');
    let lowestNewPrice = _.get(productResults, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.FormattedPrice');
    let largeImageUrl = _.get(productResults, 'result.ItemLookupResponse.Items.Item.LargeImage.URL');
    let mediumImageUrl = _.get(productResults, 'result.ItemLookupResponse.Items.Item.MediumImage.URL');
    let smallImageUrl = _.get(productResults, 'result.ItemLookupResponse.Items.Item.SmallImage.URL');
    let publisher = _.get(productResults, 'result.ItemLookupResponse.Items.Item.ItemAttributes.Publisher');
    let title = _.get(productResults, 'result.ItemLookupResponse.Items.Item.ItemAttributes.Title');

    bot.sendMessage(userId, {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: title,
            subtitle: publisher + ' - ' + lowestNewPrice,
            item_url: detailPageUrl,
            image_url: largeImageUrl || mediumImageUrl || smallImageUrl,
            buttons: [
              {
                type: "web_url",
                url: detailPageUrl,
                title: "View Product"
              },
              {
                type: "postback",
                title: "Track",
                payload: "Track:::" + _.get(productResults, 'result.ItemLookupResponse.Items.Item.ASIN') + ":::" + detailPageUrl
              }
            ]
          }]
        }
      }
    });

    return waterfallNext();
  }

  function finalCallback(errorMsg) {
    if (!!errorMsg) {
      return textMessage.send(userId, errorMsg);
    }
  }
}

function trackProduct(userId, asin, url) {
  let store;
  let detailPageUrl;
  let currencyCode;
  let amount;
  let formattedAmount;
  let largeImageUrl;
  let mediumImageUrl;
  let smallImageUrl;
  let publisher;
  let title;
  let lowestNewPrice;

  async.waterfall([
    resolveProduct,
    upsertProduct,
    getUser,
    addTrackingRelationship
  ], finalCallback);

  function resolveProduct(waterfallNext) {
    let client = amazon.getClient(url);

    amazon.getProduct(asin, client)
      .then(function (results) {
        // TODO: What does an error response actually look like (According to Amazon Docs)
        if (_.get(results, 'result.ItemLookupResponse.Items.Request.Errors.Error')) {
          return waterfallNext(new Error('Amazon returned an error'));
        }

        waterfallNext(null, results);
      })
      .catch(function (error) {
        waterfallNext(error);
      });
  }

  function upsertProduct(amazonResult, waterfallNext) {
    store = amazon.getStore(url);
    detailPageUrl = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.DetailPageURL');
    currencyCode = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.CurrencyCode');
    amount = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.Amount');
    formattedAmount = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.FormattedPrice');
    largeImageUrl = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.LargeImage.URL');
    mediumImageUrl = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.MediumImage.URL');
    smallImageUrl = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.SmallImage.URL');
    publisher = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.ItemAttributes.Publisher');
    title = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.ItemAttributes.Title');
    lowestNewPrice = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.FormattedPrice');

    Product.findOneAndUpdate(
      {
        store: store,
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
        imageUrl: {
          large: largeImageUrl,
          medium: mediumImageUrl,
          small: smallImageUrl
        },
        title: title,
        publisher: publisher
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
        thresholdPrice: [{
          amount: product.currentPrice.amount,
          formattedAmount: product.currentPrice.formattedAmount,
          currencyCode: product.currentPrice.currencyCode
        }],
        isTracking: true,
        lastNotified: Date.now()
      },
      {upsert: true, new: true},
      waterfallNext
    )
  }

  function finalCallback(error, result) {
    if (error) {
      winston.error(error);
      return textMessage.send(userId, "Ooops, something went wrong with my magical amazon communication skills. Try again in a bit!");
    }

    textMessage.send(userId, "Great, I’ll let you know when the price drops!");
    bot.sendMessage(userId, {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: title,
            subtitle: publisher + ' - ' + lowestNewPrice,
            item_url: detailPageUrl,
            image_url: largeImageUrl || mediumImageUrl || smallImageUrl,
            buttons: [
              {
                type: "postback",
                title: "Update Price",
                payload: "UpdatePrice:::" + asin + ":::" + detailPageUrl
              },
              {
                type: "postback",
                title: "Stop Tracking",
                payload: "StopTracking:::" + asin + ":::" + detailPageUrl
              }
            ]
          }]
        }
      }
    });
  }
}

function createUser(userId) {
  async.waterfall([
    getProfile,
    upsertUser
  ], finalCallback);

  function getProfile(waterfallNext) {
    bot.getProfile(userId, function (error, profile) {
      if (error) {
        return waterfallNext(error);
      }

      return waterfallNext(null, profile);
    })
  }

  function upsertUser(profile, waterfallNext) {
    User.findOneAndUpdate(
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

        return waterfallNext(null, result);
      });
  }

  function finalCallback(error) {
    if (error) {
      winston.error("Important: " + error);
    }
  }
}

function displayTrackedProducts(userId, skip) {
  async.waterfall([
    findUser,
    findProductUser,
    findProducts,
    formatResponse
  ], finalCallback);

  function findUser(waterfallNext) {
    User
      .findOne(
        {fbUserId: userId},
        function(error, user) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext(null, user);
        });
  }

  function findProductUser(user, waterfallNext) {
    ProductUser
      .find(
        {userId: user._id, isTracking: true},
        function(error, productUsers) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext(null, productUsers);
        });
  }

  function findProducts(productUsers, waterfallNext) {
    let productIds = _.map(productUsers, pU => pU.productId);

    Product
      .find(
        {_id: {$in: productIds}},
        function(error, products) {
          if (error) {
            return waterfallNext(error);
          }

          // Note that because we can't include: {skip: skip, limit: 10}, as part of the query, we're doing the following.
          return waterfallNext(null, products);
        });
  }

  function formatResponse(products, waterfallNext) {
    let firstXProducts = _.slice(products, skip, skip + 9);
    let carouselElements = _.map(firstXProducts, function(product) {
      return {
        title: product.title,
        subtitle: product.publisher + ' - ' + product.currentPrice.formattedAmount,
        item_url: product.link,
        image_url: product.imageUrl.large || product.imageUrl.medium || product.imageUrl.small,
        buttons: [
          {
            type: "postback",
            title: "Update Price",
            payload: "UpdatePrice:::" + product.asin + ":::" + product.link
          },
          {
            type: "postback",
            title: "Stop Tracking",
            payload: "StopTracking:::" + product.asin + ":::" + product.link
          }
        ]
      };
    });

    if (products.length > skip + 9) {
      let viewed = skip + 9;
      let viewMore = {
        title: 'View More',
        subtitle: 'Click here to view more...',
        buttons: [
          {
            type: "postback",
            title: "View More",
            payload: "PRODUCT_MANAGE_PAYLOAD:::" + viewed
          }
        ]
      };

      carouselElements.push(viewMore);
    }

    waterfallNext(null, carouselElements);
  }

  function finalCallback(error, carouselElements) {
    if (error) {
      winston.error(error);
      return;
    }

    bot.sendMessage(userId, {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: carouselElements
        }
      }
    });
  }
}

function stopTracking(userId, asin, url) {
  async.waterfall([
    findProduct,
    findUser,
    disableProductUser
  ], finalCallback);

  function findProduct(waterfallNext) {
    let store = amazon.getStore(url);

    Product
      .findOne(
        {
          store: store,
          asin: asin
        },
        function(error, product) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext(null, product);
        });
  }

  function findUser(product, waterfallNext) {
    User
      .findOne(
        {fbUserId: userId},
        function (error, user) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext(null, product, user);
        })
  }

  function disableProductUser(product, user, watefallNext) {
    ProductUser
      .update(
        {
          productId: product._id,
          userId: user._id
        },
        {
          isTracking: false
        },
        function(error, result) {
          if (error) {
            return watefallNext(error);
          }

          return watefallNext(null, result);
        });
  }

  function finalCallback(error, result) {
    if (error) {
      return winston.error(error);
    }

    textMessage.send(userId, "Okay, I stopped tracking that product!");
  }
}

function tagProductUserForPriceUpdate(userId, asin, url) {
  let store = amazon.getStore(url);

  async.waterfall([
    getUser,
    setAllFlaggedProductUsersToFalse,
    getProduct,
    flagProductUser
  ], finalCallback);


  function getUser(waterfallNext) {
    User
      .findOne(
        {fbUserId: userId},
        function(error, user) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext(null, user);
        });
  }

  function setAllFlaggedProductUsersToFalse(user, waterfallNext) {
    ProductUser
      .update(
        { userId: user._id }, { isBeingUpdated: false }, { multi: true }, function (error, raw) {
        if (error) {
          return waterfallNext(error);
        }

        return waterfallNext(null, user);
      });
  }

  function getProduct(user, waterfallNext) {
    Product
      .findOne(
        {
          store: store,
          asin: asin
        },
        function (error, product) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext(null, user, product);
        });
  }

  function flagProductUser(user, product, waterfallNext) {
    ProductUser
      .findOneAndUpdate(
        {
          productId: product._id,
          userId: user._id
        },
        {
          isBeingUpdated: true
        },
        function (error) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext(null);
        });
  }

  function finalCallback(error) {
    if (error) {
      return winston.error(error);
    }

    textMessage.send(userId, "Okay, what price do you want to update this product to? Hint: enter only a number.");
  }
}

function updateProductUserThreshold(userId, message) {
  async.waterfall([
    findUser,
    updatePriceThreshold
  ], finalCallback);

  function findUser(waterfallNext) {
    User
      .findOne(
        {fbUserId: userId},
        function (error, user) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext(null, user);
        });
  }

  function updatePriceThreshold(user, waterfallNext) {
    ProductUser
      .findOneAndUpdate(
        {
          isBeingUpdated: true,
          userId: user._id
        },
        {
          isBeingUpdated: false,
          $push: {
            thresholdPrice: {
              amount: parseFloat(message)*100
            }
          }
        },
        function(error) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext();
        });
  }

  function finalCallback(error) {
    if (error) {
      return winston.error(error);
    }

    return textMessage.send(userId, "Great, I've updated the price threshold of that product for you");
  }
}
