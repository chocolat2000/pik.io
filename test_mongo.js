var mongoose     = require('mongoose');

mongoose.connect('mongodb://localhost/pmail');

var usersSchema = new mongoose.Schema ({
    username : String,
    boxnonce : String,
    signnonce : String,
    pk : String,
    sk : String,
    signpk : String,
    signsk : String,
    salt : String,
    meta : {
        nonce : String,
        value : String
    }
});
var mailsSchema = new mongoose.Schema ({
    nonce : String,
    pk : String,
    body : String
});

var User = mongoose.model('Users', usersSchema);
var Mail = mongoose.model('Mails', mailsSchema);

var newUser = new User({
    username : "mee",
    boxnonce : "aaa",
    signnonce : "bbb",
    pk : "ccc",
    sk : "ddd",
    signpk : "eee",
    signsk : "fff",
    salt : "ggg",
    meta : {
        nonce : "hhh",
        value : "iii"
    }
});

newUser.save();