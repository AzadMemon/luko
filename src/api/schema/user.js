var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var userSchema = new Schema({
  fbUserId:  String,
  firstName: String,
  lastName: String,
  timezone: String,
  gender: String,
  locale: String
});

var User = mongoose.model('User', userSchema);

module.exports = User;
