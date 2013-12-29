var couchbase	= require('couchbase');
var nacl 		= require('js-nacl').instantiate();
var simplesmtp	= require('simplesmtp');
var mailparser 	= require('mailparser').MailParser;

var domains = ['pmail.io'];
var smtp = simplesmtp.createServer({
	name: require('os').hostname(),
	SMTPBanner: 'hello boy !',
	disableDNSValidation: true
});

var serverPk = [176, 198, 150, 232, 87, 89, 72, 75, 206, 71, 27, 189, 209, 72, 184, 102, 41, 157, 252, 208, 107, 67, 140, 223, 246, 177, 115, 176, 199, 254, 19, 84];
var serverSk = [245, 5, 43, 242, 114, 195, 121, 65, 175, 193, 64, 71, 138, 161, 128, 103, 104, 110, 174, 238, 223, 151, 165, 209, 242, 97, 109, 224, 189, 162, 88, 230];
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
	connection.parser.connection = connection;
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
	for(var key in this.connection.to) {
		var _to = (this.connection.to[key] || '').split('@');
		if(_to.length === 2) {
			usernames.push(_to[0]);
		}
	}

	usersdb.getMulti(usernames, null, function(err,results) {
		var mails = new Object();
		for(username in results) {
			if(results.hasOwnProperty(username) && results[username].value && results[username].value.pk) {
				var userPk = nacl.from_hex(results[username].value.pk);
				var sessionKeys = nacl.crypto_box_keypair_from_seed(nacl.random_bytes(64));
				var message = nacl.encode_utf8(JSON.stringify(mail));
				var nonce = nacl.crypto_box_random_nonce();
				var m_encrypted = nacl.crypto_box(message,nonce,userPk,sessionKeys.boxSk);
				mails[(+new Date).toString(36)+'-pmailExt'] = {value:{
					username: username,
					pk: nacl.to_hex(sessionKeys.boxPk),
					nonce: nacl.to_hex(nonce),
					body: nacl.to_hex(m_encrypted),
					folder: 'inbox'
				}}
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
