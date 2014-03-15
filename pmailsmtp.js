'use strict';
var couchbase	= require('couchbase');
var nacl 		= require('js-nacl').instantiate();
var simplesmtp	= require('simplesmtp');
var mailparser 	= require('mailparser').MailParser;

var domains = ['pik.io'];
var smtp = simplesmtp.createServer({
	name: 'front1.pik.io',
	SMTPBanner: 'hello boy !',
	ignoreTLS: true,
	disableDNSValidation: true
});

var usersdb =  new couchbase.Connection({host: 'localhost:8091', bucket: 'users'});
var mailsdb =  new couchbase.Connection({host: 'localhost:8091', bucket: 'mails'});

nacl.from_hex = function (s) {
	var result = new Uint8Array(s.length / 2);
	for (var i = 0; i < s.length / 2; i++) {
		 result[i] = parseInt(s.substr(2*i,2),16);
	}
	return result;
};


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
		if(_to.length === 2) {
			usernames.push(_to[0]);
		}
	}
	if(usernames.length === 0)
		return;
	usersdb.getMulti(usernames, null, function(err,results) {
		var mails = new Object();
		for(var username in results) {
			if(results.hasOwnProperty(username) && results[username].value && results[username].value.pk) {
				var userPk = nacl.from_hex(results[username].value.pk);
				var sessionKeys = nacl.crypto_box_keypair();
				var message = nacl.encode_utf8(JSON.stringify(mail));
				var nonce = nacl.crypto_box_random_nonce();
				var m_encrypted = nacl.crypto_box(message,nonce,userPk,sessionKeys.boxSk);
				mails[(+new Date).toString(36)+'-pmailExt'] = {
					value:{
						username: username,
						pk: nacl.to_hex(sessionKeys.boxPk),
						nonce: nacl.to_hex(nonce),
						body: nacl.to_hex(m_encrypted),
						folder: 'inbox'
					}
				}
			}
		}
		mailsdb.setMulti(mails, {},
			function(err, result) {
				if(err) {
					console.log(err);
				}
		});
	});
}
