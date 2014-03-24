'use strict';
var nacl 		= require('js-nacl').instantiate();
var scrypt 		= require('scrypt');
var couchbase	= require('couchbase');
var simplesmtp	= require('simplesmtp');
var mailcomposer = require('mailcomposer').MailComposer;
var domains 	= ['pik.io'];

var usersdb = new couchbase.Connection({host: 'localhost:8091', bucket: 'users'});
var mailsdb = new couchbase.Connection({host: 'localhost:8091', bucket: 'mails'});
var inboxes = mailsdb.view('inboxes','by_username');

scrypt.kdf.config.saltEncoding 		= 'hex';
scrypt.kdf.config.keyEncoding		= 'hex';
scrypt.kdf.config.outputEncoding 	= 'hex';
scrypt.kdf.config.defaultSaltSize 	= 32;
scrypt.kdf.config.outputLength 		= 32;

var mailPool = simplesmtp.createClientPool(587, 'localhost', {
	auth : {
		user: 'pikio',
		pass: 'pikio'
	}
});

module.exports.randomSession = function(size) {
	return nacl.to_hex(nacl.random_bytes(size));
};

module.exports.loadUser = function(username,password,callback) {
	pMailUser(username,password,false, function(err,result) {
		callback(err,result);
	});
};

module.exports.newUser = function(username,password,callback) {
	pMailUser(username,password,true, function(err,result) {
		callback(err,result);
	});
};


module.exports.getMails = function(user,params,callback) {
	var limit = params.limit || 20;
	var folder = params.folder || 'inbox';
	var firstElem = params.firstElem || 0;
	var username = user.username;
	var userSk = new Uint8Array(user.sk);

	inboxes.query(
		{limit:limit,key:[username,folder],descending:true,skip:firstElem},
		function(err, results) {
			if(err) {
				callback(err,{});
				return;
			}
			var keys = new Array();
			for(var id in results) {
				keys.push(results[id].id);
			}
			if(keys.length > 0) {
				mailsdb.getMulti(keys, {}, function(err, results) {
					if(err) {
						callback(err,{});
					}
					else {
						var result = new Array();
						for(var id in results) {
							if(results[id].value) {
								var mail = decodeMail(results[id].value,userSk);
								if(mail) {
									mail = JSON.parse(nacl.decode_utf8(mail));
									mail.id = id;
									result.push(mail);
								}
							}
						}
						callback(null,result);
					}
				});
			}
			else {
				callback(null,[]);
			}
		}
	);
};

module.exports.deleteMail = function(mailid, callback) {
	mailsdb.get(mailid, {},function(err, result) {
		if(err) {
			console.log(err);
			callback(err);
			return;
		}
		result.value.folder = 'trash';
		mailsdb.set(mailid,result.value,function(err, result) {
			if(err) {
				console.log(err);
				callback(err);
				return;
			}
			callback(null);
		});
	});
};

module.exports.updateUser = function(meta, callback) {
	usersdb.get(this.username, function(err,result) {
		if(err) {
			callback(err);
			return;
		}
		this.meta = encodeUserMeta(meta,this.password);
		result.value.meta = this.meta;
		usersdb.set(req.session.username, result.value, function(err, result) {
			if(err) {
				callback(err);
				return;
			}
			callback(null);
		});
	});
};

module.exports.sendMail = function(user,mail,callback) {

	mail.date = new Date();

	var recipentPk = new Uint8Array(user.pk);
	var message = nacl.encode_utf8(JSON.stringify(mail));

	var mailId = (+new Date).toString(36)+'-pmailInt';
	var encoded = encodeMail(message,recipentPk);
	mailsdb.set(mailId,{
		username:user.username,
		body:encoded.body,
		nonce:encoded.nonce,
		pk:encoded.pk,
		folder:'sent'
	},function(err, results) {
			if(err) {
				callback(err,{});
				return;
			}

			mail.id = mailId;
			callback(null,mail);
		}
	);

	var pMailTo = new Array();
	var extTo = new Array();
	var fullPMail = new RegExp('^(.+)@('+domains.join('|')+')$','i');
	var isMail = new RegExp('^(.+)@(.+)$','i');

	for(var i = 0; i<mail.to.length; i++) {
		if(isMail.exec(mail.to[i].address)) {
			var fullTest = fullPMail.exec(mail.to[i].address);
			if(fullTest) {
				pMailTo.push(fullTest[1]);
			}
			else {
				extTo.push(mail.to[i].address);
			}
		}
		else {
			pMailTo.push(mail.to[i].address);
		}
	}

	usersdb.getMulti(pMailTo, {}, function(err, results) {
		for(var user in results) {
			if(results[user].hasOwnProperty('value') && results[user].value.hasOwnProperty('pk')) {
				var mailId = (+new Date).toString(36)+'-pmailInt';
				var encoded = encodeMail(message,nacl.from_hex(results[user].value.pk));
				mailsdb.set(mailId, {
						username:user,
						body:encoded.body,
						nonce:encoded.nonce,
						pk:encoded.pk,
						folder:'inbox'
					}, function(err, results) {
					if(err) {
						console.log(err);
					}
				});
			}
		}
	});

	var extMail = new mailcomposer();
	extMail.setMessageOption(mail);

	mailPool.sendMail(extMail,function(err,message) {
		if(err) {
			console.log(err);
			console.log(message);
		}
	});
};


var decodeMail = function(mail,recipentSk) {
	var nonce = nacl.from_hex(mail.nonce);
	var senderPk = nacl.from_hex(mail.pk);
	var decoded = null;

	try {
		decoded = nacl.crypto_box_open(nacl.from_hex(mail.body),nonce,senderPk,recipentSk);
	}
	catch(err) {
		console.log(err);
		decoded = null;
	}

	return decoded;
};

var encodeMail = function(mail,recipentPk) {
	var nonce = nacl.crypto_box_random_nonce();
	var box = nacl.crypto_box_keypair();
	var encoded = null;

	try {
		encoded = {
			nonce : nacl.to_hex(nonce),
			pk : nacl.to_hex(box.boxPk),
			body : nacl.to_hex(nacl.crypto_box(mail,nonce,recipentPk,box.boxSk))
		};
	}
	catch(err) {
		console.log(err);
		encoded = null;
	}

	return encoded;
};

var decodeUserMeta = function(meta,password) {
	var nonce = nacl.from_hex(meta.nonce);
	return JSON.parse(nacl.decode_utf8(
		nacl.crypto_secretbox_open(
			nacl.from_hex(meta.value),
			nonce,
			password)
		)
	);
};

var encodeUserMeta = function(meta,password) {
	var nonce = nacl.crypto_secretbox_random_nonce();
	return {
		nonce : nacl.to_hex(nonce),
		value : nacl.to_hex(
			nacl.crypto_secretbox(
				nacl.encode_utf8(JSON.stringify(meta)),
				nonce,
				password)
			)
	}
};

var pMailUser = function(username,password,isNew,callback) {
	if(isNew) {
		var user = newUser(password);
			
		if(!user) {
			callback('error',{});
		}
		else {
			var result = {
				sk : user.box.boxSk,
				pk : user.box.boxPk,
				password : user.password,
				username : username,
				meta : {}
			};
			delete user.box;
			delete user.password;
			usersdb.set(username, user, function(err, result) {
				callback(null,result);
			});

		}
	}
	else {
		loadUser(username,password, function(err,user) {
			if(err) {
				callback(err,{});
			}
			else {
				callback(null, {
					sk : user.sk,
					pk : user.pk,
					password : user.password,
					username : username,
					meta : {}
				});
			}
		});
	}
};

var newUser = function(password) {
	var res = null;
	try {
		var pass = scrypt.kdf(password,{'N':65536, 'r':8, 'p': 1});
		var keypair = nacl.crypto_box_keypair();
		var nonce = nacl.crypto_secretbox_random_nonce();
		var p = nacl.from_hex(pass.hash);

		res = {
			nonce : nacl.to_hex(nonce),
			pk : nacl.to_hex(keypair.boxPk),
			sk : nacl.to_hex(nacl.crypto_secretbox(keypair.boxSk,nonce,p)),
			salt : pass.salt,
			box : keypair,
			password : p
		};
	}
	catch(err) {
		console.log(err);
		res = null;
	}
	return res;
};

var loadUser = function(username, password, callback) {
	var user = null;
	var _password = password;
	usersdb.get(username, function(err,result) {
		if(err) {
			callback(err,{});
		}
		else {

			try {
				var passHash = scrypt.kdf(_password,{'N':65536, 'r':8, 'p': 1},scrypt.kdf.config.outputLength,result.value.salt);
				var nonce = nacl.from_hex(result.value.nonce);
				var password = nacl.from_hex(passHash.hash);
				user = {
					pk : nacl.from_hex(result.value.pk),
					sk : nacl.crypto_secretbox_open(nacl.from_hex(result.value.sk),nonce,nacl.from_hex(passHash.hash)),
					password : password
				};
				callback(null,user);
			}
			catch (err) {
				console.log(99,err);
				callback('Bad password',{});
			}
		}

	});



}


