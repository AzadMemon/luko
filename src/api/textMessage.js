// TODO: Think of reorganizing this. Static strings in their own class. bot.sendMessage doesn't need a wrapper class imo
const bot = require('./../services/facebook/messengerbot');
const winston = require('winston');

const genericErrorMessage = "Sorry I didn't quite understand that! I only speak in Amazon Links. " +
  "Can you try pasting that Amazon link again?";
const unsupportedCountryErrorMessage = "I’m sorry, but I currently only work with Amazon's Canada and U.S. stores. I’ve noted that you’re interested and " +
  "I’ll be sure to notify you when I've learnt how to work with stores in that area!";
const productNotFoundErrorMessage = "I’m sorry, I couldn’t find that product, are you sure your link is correct?";
const kindleEbookNotSupportedErrorMessage = "Sorry, but at this time, Amazon doesn't let me track Kindle books. Try pasting a different product link!";
const introMessage = "Hey! I’m Luko, a price tracking bot for Amazon products. " +
  "Have a product you’re interested in but you aren’t willing to pay? " +
  "No PROBLEM! Simply paste the product link here and I’ll message you if the price drops.";
const unSupportedProductErrorMessage = "Sorry, but at this time, Amazon doesn't let me track that product.";

function send(recipientId, text) {
  bot.sendMessage(recipientId, {
    text: text
  }, function(error, resp) {
    if (error) {
      winston.error(error);
    }
  });
}

function sendTemplate(recipientId, content) {
  // NOTE: In this case, if it's outside the 24 hour window, the new messenger API has a new flag (look at luko doc)

}

module.exports = {
  genericErrorMessage: genericErrorMessage,
  unsupportedCountryErrorMessage: unsupportedCountryErrorMessage,
  productNotFoundErrorMessage: productNotFoundErrorMessage,
  kindleEbookNotSupportedErrorMessage: kindleEbookNotSupportedErrorMessage,
  unSupportedProductErrorMessage: unSupportedProductErrorMessage,
  introMessage: introMessage,
  send: send
};
