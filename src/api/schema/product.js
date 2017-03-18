var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var productSchema = new Schema({
  link: String,
  asin: String,
  currentPrice: {
    amount: Number,
    formattedAmount: String,
    currencyCode: String
  },
  startPrice: {
    amount: Number,
    formattedAmount: String,
    currencyCode: String
  },
  priceHistory: [{
    date: {type: Date, Default: Date.now},
    amount: Number,
    formattedAmount: String,
    currencyCode: String
  }],
  imageUrl: String,
  title: String,
  seller: String
});

var Product = mongoose.model('Product', productSchema);

module.exports = Product;
