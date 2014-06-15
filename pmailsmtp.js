'use strict';
var mongoose     = require('mongoose');
var nacl 		 = require('js-nacl').instantiate();
var simplesmtp   = require('simplesmtp');
var mailparser 	 = require('mailparser').MailParser;
//var tools 		= require('./pmail-tools');

var domains = ['pik.io'];
var smtp = simplesmtp.createServer({
    localAddress: '127.0.0.1',
	name: 'front1.pik.io',
	SMTPBanner: 'hello boy !',
	ignoreTLS: true,
	disableDNSValidation: true
});

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
    username : String,
    folder : String,
    sign : String,
    nonce : String,
    pk : String,
    body : String
});

var User = mongoose.model('users', usersSchema);
var Mail = mongoose.model('mails', mailsSchema);

mongoose.connect('mongodb://localhost/pmail');

smtp.listen(2525, function(err) {
	if(err)
		console.log(err);
});

smtp.on('validateSender ', function(connection, email, done){
	done();
});

smtp.on('startData', function(connection) {
	connection.parser = new mailparser();
	//connection.parser.connection = connection;
	connection.parser.on('end',endParser);
});

smtp.on('data', function(connection, chunk){
	connection.parser.write(chunk);
});

smtp.on('dataReady', function(connection, callback){
	callback(null, 'thanks!');
	connection.parser.end();
});

var endParser = function(mail) {
	var usernames = [];
	for(var key in mail.to) {
		var _to = (mail.to[key].address || '').split('@');
		if(_to.length === 2 && (domains.indexOf(_to[1])>-1)) {
			usernames.push(_to[0]);
		}
	}
	if(usernames.length === 0)
		return;
    User.find({username : {$in : usernames}}, 'pk username', function(err, results) {
		for(var recipient in results) {
			if(results[recipient].pk) {
				var userPk = nacl.from_hex(results[recipient].pk);
				var sessionKeys = nacl.crypto_box_keypair();
				var message = nacl.encode_utf8(JSON.stringify(mail));
				var nonce = nacl.crypto_box_random_nonce();
				var m_encrypted = nacl.crypto_box(message,nonce,userPk,sessionKeys.boxSk);
                (new Mail(
                    {
						username: results[recipient].username,
						pk: nacl.to_hex(sessionKeys.boxPk),
						nonce: nacl.to_hex(nonce),
						body: nacl.to_hex(m_encrypted),
						folder: 'inbox'
					}))
                .save(function(err) {
                    if(err) {
                        console.log(err);
                    }
                });

			}
		}
	});
}
