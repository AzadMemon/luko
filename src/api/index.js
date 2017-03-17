import {Router} from 'express'
import config from './../config'
import _ from 'lodash'

const request = require('request');
const {OperationHelper} = require('apac');
const getUrls = require('get-urls');
const url = require('url');

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

router.get('/webhook', function (req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === config.fbVerifyToken) {
    console.log("Validating webhook")
    res.status(200).send(req.query['hub.challenge'])
  } else {
    console.error("Failed validation. Make sure the validation tokens match.")
    res.sendStatus(403)
  }
})

router.post('/webhook', function (req, res) {
  var data = req.body;

  if (data.object === 'page') {
    data.entry.forEach(function (entry) {
      var pageID = entry.id;
      var timeOfEvent = entry.time;

      entry.messaging.forEach(function (event) {
        if (event.message) {
          receivedMessage(event);
        } else if (event.postback) {
          receivedPostback(event);
        } else {
          console.log("Webhook received unknown event: ", event);
        }

        // TODO: Track when a user has read the message and when the message has been delivered
      });
    });

    res.sendStatus(200);
  }
})


function receivedMessage(event) {
  var senderID = event.sender.id;
  var message = event.message;
  var messageText = message.text;

  var links = getUrls(messageText);
  if (links.size) {
    if (links.size > 1) {
      // TODO: Maybe iterate over links to service all links?
      return sendErrorTextMessage(senderID);
    }

    var amazonLink = Array.from(links)[0];
    var amazonASIN = extractASIN(amazonLink);

    if (!amazonASIN) {
      return sendErrorTextMessage(senderID);
    }

    var client;
    if (amazonLink.includes('amazon.com')) {
      client = client_us;
    } else if (amazonLink.includes('amazon.ca')) {
      client = client_ca;
    } else {
      return sendWrongCountryTextMessage(senderID);
    }

    return client.execute('ItemLookup', {
      IdType: 'ASIN',
      ItemId: amazonASIN,
      ResponseGroup: 'Images, ItemAttributes, Offers'
    }).then(function(results) {
      if (_.get(results, 'result.ItemLookupResponse.Items.Request.Errors.Error')) {
        return sendIllFormedTextMessage(senderID);
      }

      sendConfirmTrackMessage(senderID, results);
    }).catch(function(error) {
      sendErrorTextMessage(senderID);
    });
  }

  if (messageText) {
    switch (messageText) {
      case 'Get Started':
        return sendIntroMessage(senderID);
      case 'Manage My Products':
        return sendCarouselMessage(senderID);
      default:
        return sendErrorTextMessage(senderID);
    }
  }

  sendErrorTextMessage(senderID);
}

function sendIntroMessage() {
  sendTextMessage(
    senderID,
    "Hey! I’m Luko, a price tracking bot for Amazon products. " +
    "Have a product you’re interested in but you aren’t willing to pay? " +
    "No PROBLEM! Simply paste the product link here and I’ll message you if the price drops."
  );
}

function sendWrongCountryTextMessage(recipientID) {
  sendTextMessage(
    recipientID,
    "I’m sorry, but I currently only work with Amazon's Canada and U.S. stores. I’ve noted that you’re interested and " +
    "I’ll be sure to notify you when I've learnt how to work with stores in that area!"
  )
}

function sendIllFormedTextMessage(recipientID) {
  sendTextMessage(
    recipientID,
    "I’m sorry, I couldn’t find that product, are you sure your link is correct?"
  );
}
function sendErrorTextMessage(recipientID) {
  sendTextMessage(
    recipientID,
    "Sorry I didn't quite understand that! I only speak in Amazon Links. " +
    "Can you try pasting that Amazon link again?"
  );
}

function extractASIN(link) {
  var parsedUrl = url.parse(decodeURIComponent(link));

  if (parsedUrl != null && parsedUrl.hostname != null && parsedUrl.hostname.includes("amazon")) {
    var paths = parsedUrl.pathname.split('/');
    var index = _.indexOf(paths, 'product') == -1 ? _.indexOf(paths, 'dp') : _.indexOf(paths, 'product');

    return index != -1 ? paths[index + 1] : '';
  }

  return '';
}


function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " +
    "at %d", senderID, recipientID, payload, timeOfPostback);

  sendTextMessage(senderID, "Postback called");
}


function sendConfirmTrackMessage(recipientID, results) {
  var detailPageUrl = _.get(results, 'result.ItemLookupResponse.Items.Item.DetailPageURL');
  var lowestNewPrice = _.get(results, 'result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice');
  var largeImage = _.get(results, 'result.ItemLookupResponse.Items.Item.LargeImage');
  var itemAttributes = _.get(results, 'result.ItemLookupResponse.Items.Item.ItemAttributes');


  var messageData = {
    recipient: {
      id: recipientID
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: itemAttributes.Title,
            subtitle: itemAttributes.Publisher + ' - ' + lowestNewPrice.FormattedPrice + ' ' + lowestNewPrice.CurrencyCode,
            item_url: detailPageUrl,
            image_url: largeImage.URL,
            buttons: [{
              type: "web_url",
              url: detailPageUrl,
              title: "View Product"
            }, {
              type: "postback",
              title: "Track",
              payload: JSON.stringify({
                cta: 'track',
                asin: _.get(results, 'result.ItemLookupResponse.Items.Item.ASIN')
              })
            }]
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

function trackPackage(userID, asin) {
  // var detailPageUrl = results.result.ItemLookupResponse.Items.Item.DetailPageURL;
  // var lowestNewPrice = results.result.ItemLookupResponse.Items.Item.OfferSummary.LowestNewPrice;
  // var lowestUsedPrice = results.result.ItemLookupResponse.Items.Item.OfferSummary.LowestUsedPrice;
  // var largeImage = results.result.ItemLookupResponse.Items.Item.LargeImage;
  // var mediumImage = results.result.ItemLookupResponse.Items.Item.MediumImage;
  // var smallImage = results.result.ItemLookupResponse.Items.Item.SmallImage;
  // var itemAttributes = results.result.ItemLookupResponse.Items.Item.ItemAttributes;
}

function sendTextMessage(recipientID, messageText) {
  var messageData = {
    recipient: {
      id: recipientID
    },
    message: {
      text: messageText
    }
  };

  callSendAPI(messageData);
}

function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: config.pageAccessToken },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      console.log("Successfully sent generic message with id %s to recipient %s",
        messageId, recipientId);
    } else {
      console.error("Unable to send message.");
      console.error(response);
      console.error(error);
    }
  });
}

export default router
