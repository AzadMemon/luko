let mongoose = require('mongoose');
let Schema = mongoose.Schema;

let productSchema = new Schema({
  link: String,
  asin: String,
  currentPrice: {
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
  store: String,
  imageUrl: {
    large: String,
    medium: String,
    small: String
  },
  title: String,
  publisher: String
});

let Product = mongoose.model('Product', productSchema);

module.exports = Product;
