import _ from 'lodash';
import async from 'async';
import getUrls from 'get-urls';
import amazonAsin from 'amazon-asin';

import User from './schema/user';
import Product from './schema/product';
import ProductUser from './schema/productUser';

import bot from './../services/facebook/messengerbot';
import textMessage from './textMessage';
import amazon from './amazon';

let winston = require('winston');

bot.on('error', function (err) {
  winston.error(err.message);
});

bot.on('message', function (payload, reply, actions) {
  let senderId = payload.sender.id;
  let message = payload.message.text;

  if (getUrls(message).size > 0) {
    return trackProduct(senderId, message);
  } else if (!isNaN(parseFloat(message))) {
    return updateProductUserThreshold(senderId, message);
  } else if (message.toLowerCase() === 'get started') {
    textMessage.send(senderId, textMessage.introMessage);
  } else if (message.toLowerCase() === 'help') {
    textMessage.send(senderId, textMessage.helpMessage);
  } else {
    return textMessage.send(senderId, textMessage.genericErrorMessage);
  }
});

bot.on('postback', function (payload, reply, actions) {
  let senderId = payload.sender.id;
  let metadataPayload = payload.postback.payload;// TODO:Find a better name for this

  if (metadataPayload.includes('StopTracking:::')) {
    let info = metadataPayload.split(":::");
    let asin = info[1];
    let url = info[2];
    stopTracking(senderId, asin, url);
  } else if (metadataPayload.includes('UpdatePrice:::')) {
    let info = metadataPayload.split(":::");
    let asin = info[1];
    let url = info[2];
    tagProductUserForPriceUpdate(senderId, asin, url)
  } else if (metadataPayload === 'PRODUCT_MANAGE_PAYLOAD') {
    displayTrackedProducts(senderId, 0);
  } else if (metadataPayload.search(/PRODUCT_MANAGE_PAYLOAD:::\d+/g) !== -1) {
    let offset = parseInt(metadataPayload.substring(25, metadataPayload.length));
    displayTrackedProducts(senderId, offset);
  } else if (metadataPayload.toLowerCase() === 'get started') {
    createUser(senderId);
    textMessage.send(senderId, textMessage.introMessage);
  } else if (metadataPayload.toLowerCase() === 'help') {
    textMessage.send(senderId, textMessage.helpMessage);
  } else if (metadataPayload.toLowerCase() === 'addproduct') {
    textMessage.send(senderId, textMessage.addAProduct);
  }
});

function trackProduct(userId, message) {
  let asin;
  let url;

  async.waterfall([
    resolveUrl,
    resolveAsin,
    resolveProduct,
    validateProduct,
    upsertProduct,
    getUser,
    addTrackingRelationship
  ], finalCallback);

  function resolveUrl(waterfallNext) {
    let urls = getUrls(message);

    // Invalid url
    let isInvalidUrl = !urls || urls.size !== 1;
    if (isInvalidUrl) {
      winston.error("Invalid URL: " + message);
      return waterfallNext(textMessage.genericErrorMessage);
    }

    let amazonUrl = Array.from(urls)[0];
    if (!amazon.isSupportedCountry(amazonUrl)) {
      winston.info("Country Interest: " + amazonUrl);
      return waterfallNext(textMessage.unsupportedCountryErrorMessage);
    }

    return waterfallNext(null, amazonUrl);
  }

  function resolveAsin(amazonUrl, waterfallNext) {
    amazonAsin
      .asyncParseAsin(amazonUrl)
      .then(
        function (result) {
          if (!result.url || !result.ASIN) {
            return waterfallNext(textMessage.productNotFoundErrorMessage);
          }

          url = result.url;
          asin = result.ASIN;
          return waterfallNext(null, result.url, result.ASIN);
        },
        function (error) {
          winston.error("Error resolving asin: \n" + error);
          return waterfallNext(textMessage.productNotFoundErrorMessage);
        }
      );
  }

  function resolveProduct(amazonUrl, amazonAsin, waterfallNext) {
    let client = amazon.getClient(amazonUrl)

    amazon.getProduct(amazonAsin, client)
      .then(
        function (amazonResult) {
          if (!!_.get(amazonResult, 'result.ItemLookupResponse.Items.Request.Errors.Error')) {
            winston.error("Error getting product info from amazon.", {error: _.get(amazonResult, 'result.ItemLookupResponse.Items.Request.Errors.Error')});
            return waterfallNext(textMessage.productNotFoundErrorMessage);
          }

          return waterfallNext(null, amazonResult);
        },
        function (error) {
          winston.error("Unable to get product info from amazon.", {error: error});
          return waterfallNext(textMessage.productNotFoundErrorMessage);
        }
      );
  }

  function validateProduct(amazonResult, waterfallNext) {
    if (amazon.isUnSupportedProduct(amazonResult)) {
      winston.error("Unsupported product.", {url: url});
      return waterfallNext(textMessage.unSupportedProductErrorMessage);
    }

    return waterfallNext(null, amazonResult);
  }

  function upsertProduct(amazonResult, waterfallNext) {
    let store = amazon.getStore(url);
    let offersUrl = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.Offers.MoreOffersUrl');
    let currencyCode = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.CurrencyCode');
    let amount = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.Amount');
    let formattedAmount = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice.FormattedPrice');
    let largeImageUrl = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.LargeImage.URL');
    let mediumImageUrl = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.MediumImage.URL');
    let smallImageUrl = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.SmallImage.URL');
    let publisher = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.ItemAttributes.Publisher');
    let title = _.get(amazonResult, 'result.ItemLookupResponse.Items.Item.ItemAttributes.Title');
    // Items.Item.Offers.Offer.OfferListing.Price.Amount/CurrencyCode/FormattedPrice
    if (!formattedAmount || formattedAmount.toLowerCase() === "too low to display") {
      return waterfallNext(textMessage.unSupportedProductErrorMessage);
    }

    Product.findOneAndUpdate(
      {
        store: store,
        asin: asin
      },
      {
        link: offersUrl,
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
        publisher: publisher || "",
        modifiedAt: Date.now()
      },
      {upsert: true, new: true},
      function (error, result) {
        if (error) {
          winston.error("Error while trying to upsert product during tracking.", {
            fbUserId: userId,
            store: store,
            asin: asin
          });
          return waterfallNext(textMessage.randomError);
        }

        waterfallNext(null, result);
      }
    );
  }

  function getUser(product, waterfallNext) {
    User.findOne(
      {fbUserId: userId},
      function (error, user) {
        if (error) {
          winston.error("Error while trying to find user.", {fbUserId: userId});
          return waterfallNext(textMessage.randomError);
        } else if (!user) {
          winston.error("Couldn't find user in database", {fbUserId: userId});
          return waterfallNext(textMessage.randomError);
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
        lastNotified: Date.now(),
        modifiedAt: Date.now()
      },
      {upsert: true, new: true},
      function (error, result) {
        if (error) {
          winston.error("Error while trying to add tracking relationship.", {productId: product._id, userId: user._id});
          return waterfallNext(textMessage.randomError);
        }

        waterfallNext(null, product.currentPrice.formattedAmount);
      }
    )
  }

  function finalCallback(errorText, alertPrice) {
    if (errorText) {
      return textMessage.send(userId, errorText);
    }

    bot.sendMessage(userId, {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Okay I'll let you know when the price drops below your Alert Price: " + alertPrice + ". " +
          "Click manage products to view the products you're tracking and adjust the Alert Price.",
          buttons: [
            {
              type: "postback",
              title: "Manage Products",
              payload: "PRODUCT_MANAGE_PAYLOAD"
            }
          ]
        }
      }
    }, "RESPONSE");
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
        locale: profile.locale,
        modifiedAt: Date.now()
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
      return winston.error(error);
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
        function (error, user) {
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
        function (error, productUsers) {
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
        function (error, products) {
          if (error) {
            return waterfallNext(error);
          }

          // Note that because we can't include: {skip: skip, limit: 10}, as part of the query, we're doing the following.
          return waterfallNext(null, products, productUsers);
        });
  }

  function formatResponse(products, productUsers, waterfallNext) {
    let firstXProducts = _.slice(products, skip, skip + 9);
    let carouselElements = _.map(firstXProducts, function (product, index) {
      let pU = productUsers[index + skip];
      return {
        title: product.title,
        subtitle: product.publisher
        + "\nCurrent Price: " + product.currentPrice.formattedAmount
        + "\nAlert Price: " + pU.thresholdPrice[pU.thresholdPrice.length - 1].formattedAmount,
        item_url: product.link,
        image_url: product.imageUrl.large || product.imageUrl.medium || product.imageUrl.small,
        buttons: [
          {
            type: "web_url",
            title: "View Product",
            url: product.link
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
      return winston.error(error);
    }

    if (carouselElements.length === 0) {
      return textMessage.send(userId, "You're currently not tracking any products! To track a product, simply paste an amazon product link here and I’ll message you when the price drops.")
    }

    bot.sendMessage(userId, {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: carouselElements
        }
      }
    }, "RESPONSE");
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
        function (error, product) {
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
          isTracking: false,
          modifiedAt: Date.now()
        },
        function (error, result) {
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
        function (error, user) {
          if (error) {
            return waterfallNext(error);
          }

          return waterfallNext(null, user);
        });
  }

  function setAllFlaggedProductUsersToFalse(user, waterfallNext) {
    ProductUser
      .update(
        {userId: user._id, isBeingUpdated: true},
        {isBeingUpdated: false, modifiedAt: Date.now()},
        {multi: true},
        function (error, raw) {
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
          userId: user._id,
          isTracking: true
        },
        {
          isBeingUpdated: true,
          modifiedAt: Date.now()
        },
        function (error, result) {
          if (error) {
            return waterfallNext(error);
          }

          if (!result) {
            textMessage.send(userId, "It seems like you might be trying to update the Alert Price. To update the alert price, click on Update Alert Price of any product you're tracking.");
            return waterfallNext("Tried to update alert price when isTracking is set to false");
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
    ensureProductBeingUpdatedIsMostRecentlyModified,
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

  function ensureProductBeingUpdatedIsMostRecentlyModified(user, waterfallNext) {
    ProductUser
      .find(
        {
          userId: user._id,
          isTracking: true
        },
        {},
        {
          sort: {modifiedAt: -1},
          limit: 1
        },
        function (error, result) {
          if (error) {
            return waterfallNext(error);
          }

          if (result.length < 1 || !result[0].isBeingUpdated) {
            textMessage.send(userId, "It seems like you might be trying to update the Alert Price. To update the alert price, click on Update Alert Price of any product you're tracking.");
            return waterfallNext("Tried to update alert price when most recently modified ProductUser was not in 'isBeingUpdated' state or was not being tracked.");
          }

          return waterfallNext(null, user, result[0]);
        });
  }

  function updatePriceThreshold(user, productUser, waterfallNext) {
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
              amount: parseFloat(message) * 100,
              formattedAmount: "$ " + String(parseFloat(message).toFixed(2)),
              currencyCode: productUser.thresholdPrice[0].currencyCode
            }
          },
          modifiedAt: Date.now()
        },
        function (error) {
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

    return textMessage.send(userId, "Great, I've updated the alert price of that product for you.");
  }
}
