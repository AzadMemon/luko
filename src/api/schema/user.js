var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var userSchema = new Schema({
  fbUserId:  String,
  name: String,
  country: String
});

var User = mongoose.model('User', userSchema);

module.exports = User;
