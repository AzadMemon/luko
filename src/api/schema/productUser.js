var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var productUserSchema = new Schema({
  userId:  String,
  productId: Schema.Types.ObjectId,
  thresholdPrice: {
    amount: Number,
    formattedAmount: String,
    currencyCode: String
  },
  isTracking: {type: Boolean, default: true},
  lastNotified: Date
});

var ProductUser = mongoose.model('ProductUser', productUserSchema);

module.exports = ProductUser;
