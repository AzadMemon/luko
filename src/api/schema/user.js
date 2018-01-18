let mongoose = require('mongoose');
let Schema = mongoose.Schema;

let userSchema = new Schema({
  fbUserId:  String,
  firstName: String,
  lastName: String,
  timezone: String,
  gender: String,
  locale: String
});

let User = mongoose.model('User', userSchema);

module.exports = User;
