let mongoose = require('mongoose');
let Schema = mongoose.Schema;

let productUserSchema = new Schema({
  createdAt: {type: Date, Default: Date.now},
  modifiedAt: Date,
  userId:  Schema.Types.ObjectId,
  productId: Schema.Types.ObjectId,
  thresholdPrice: [{
    amount: Number,
    formattedAmount: String,
    currencyCode: String
  }],
  initialPrice: {
    amount: Number,
    formattedAmount: String,
    currencyCode: String
  },
  isTracking: {type: Boolean, default: true},
  lastNotified: Date,
  isBeingUpdated: {type: Boolean, default: false}
});

let ProductUser = mongoose.model('ProductUser', productUserSchema);

module.exports = ProductUser;
