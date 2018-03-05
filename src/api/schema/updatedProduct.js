let mongoose = require('mongoose');
let Schema = mongoose.Schema;

let updatedProductSchema = new Schema({
  createdAt: {type: Date, Default: Date.now},
  modifiedAt: Date,
  productId: Schema.Types.ObjectId,
  batchId: Number
});

let UpdatedProduct = mongoose.model('UpdatedProduct', updatedProductSchema);

module.exports = UpdatedProduct;
