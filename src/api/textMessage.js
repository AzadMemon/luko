const bot = require('./../services/facebook/messengerbot');
const winston = require('winston');

const genericErrorMessage = "Sorry I didn't quite understand that! I only speak in Amazon Links. " +
  "Can you paste that Amazon product link again?";
const unsupportedCountryErrorMessage = "I’m sorry, but I currently only work with Amazon's Canada and U.S. stores. I’ve noted that you’re interested and " +
  "I’ll be sure to notify you when I've learnt how to work with stores in that area!";
const productNotFoundErrorMessage = "I’m sorry, I couldn’t find that product. Can you paste the link again?";
const kindleEbookNotSupportedErrorMessage = "Sorry, but at this time, Amazon doesn't let me track Kindle books. Try pasting a different product link!";
const introMessage = "Hey, I'm Luko! I can track the price of your Amazon products and notify you " +
  "when the price drops. Paste your Amazon product link(s) here and I'll do the rest. You can always type 'help' for more info.";
const unSupportedProductErrorMessage = "Sorry, but at this time, Amazon doesn't let me track that product. Try passing a different product link!";
const addAProduct = "To add a product, paste your Amazon product link(s) here.";
const randomError = "Ooops, something went wrong with my magical amazon communication skills. Try again in a bit!";
const helpMessage = "To add a product, paste your Amazon product link(s) here. You can always " +
  "access the menu for more options by clicking the \u2630 icon beside the text-bar.";

function send(recipientId, text) {
  bot.sendMessage(recipientId, { text: text }, "RESPONSE", null, function(error, resp) {
    if (error) {
      winston.error(error);
    }
  });
}

module.exports = {
  genericErrorMessage: genericErrorMessage,
  unsupportedCountryErrorMessage: unsupportedCountryErrorMessage,
  productNotFoundErrorMessage: productNotFoundErrorMessage,
  kindleEbookNotSupportedErrorMessage: kindleEbookNotSupportedErrorMessage,
  unSupportedProductErrorMessage: unSupportedProductErrorMessage,
  introMessage: introMessage,
  addAProduct: addAProduct,
  randomError: randomError,
  helpMessage: helpMessage,
  send: send
};
