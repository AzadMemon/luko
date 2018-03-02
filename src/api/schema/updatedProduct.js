let mongoose = require('mongoose');
let Schema = mongoose.Schema;

let updatedProductSchema = new Schema({
  productId: Schema.Types.ObjectId
});

let UpdatedProduct = mongoose.model('UpdatedProduct', updatedProductSchema);

module.exports = UpdatedProduct;
