'use strict';
var nacl 		= require('js-nacl').instantiate();
var scrypt 		= require('scrypt');
var couchbase	= require('couchbase');
var serverKeys 	= {};
var domains = ['pik.io'];


var usersdb = new couchbase.Connection({host: 'localhost:8091', bucket: 'users'});
var mailsdb = new couchbase.Connection({host: 'localhost:8091', bucket: 'mails'});
var inboxes = mailsdb.view('inboxes','by_username');


require('fs').readFile('pmail.json',{encoding:'utf-8',flag:'r'},function(err,data) {
	try {
		if(err) throw err;
		serverKeys = JSON.parse(data);
		serverKeys.signPkUint8 = nacl.from_hex(serverKeys.signPk);
		serverKeys.signSkUint8 = nacl.from_hex(serverKeys.signSk);
	}
	catch (err) {
		console.log(err);
		serverKeys = null;
	}
});

scrypt.kdf.config.saltEncoding 		= 'hex';
scrypt.kdf.config.keyEncoding		= 'hex';
scrypt.kdf.config.outputEncoding 	= 'hex';
scrypt.kdf.config.defaultSaltSize 	= 32;
scrypt.kdf.config.outputLength 		= 32;

var incNonce = function(nonce) {
	var nnonce = nonce;
	var i = nnonce.length-1;
	nnonce[i] += 2;
	if(nnonce[i] < 2) {
		do {
			--i;
			nnonce[i] += 1;
		}
		while ((i > 0) && (nnonce[i] < 1));
	}
	return nnonce;
};

var randomSession = function(size) {
	return nacl.to_hex(nacl.random_bytes(size));
}

var decodeRequest = function(req) {
	if (!req.session.key ||	!req.body.hasOwnProperty('req') || !req.body.hasOwnProperty('nonce'))
			return null;
	var request = nacl.from_hex(req.body.req);
	var nonce = nacl.from_hex(req.body.nonce);
	try {
		return JSON.parse(nacl.decode_utf8(nacl.crypto_box_open_precomputed(request,nonce,req.session.key)));
	}
	catch (err) {
		return null;
	}
}

var encodeResponse = function(req,res) {
	if(!req.session.key) return {res:'Failed'};
	var response = nacl.encode_utf8(JSON.stringify(res));
	var nonce = incNonce(nacl.from_hex(req.body.nonce));
	try {
		return {res:nacl.to_hex(nacl.crypto_box_precomputed(response,nonce,req.session.key))};
	}
	catch(err) {
		return {res:'Failed'};
	}
	
}

var decodeMail = function(mail,userSk) {
	var nonce = nacl.from_hex(mail.nonce);
	var pk = nacl.from_hex(mail.pk);
	var body = nacl.from_hex(mail.body);
	try {
		body = nacl.crypto_box_open(body,nonce,pk,userSk);
	}
	catch(err) {
		body = null;
	}
	return body
}

/*
var newConnection = function(req,user) {
	var sessionKeys = nacl.crypto_box_keypair();
	//req.session.nonce = nacl.crypto_secretbox_random_nonce();
	req.session.key = nacl.crypto_box_precompute(nacl.from_hex(user.pk),sessionKeys.boxSk);
	//var nonce = nacl.crypto_box_random_nonce();
	//var sessNonce = nacl.crypto_box_precomputed(req.session.nonce,nonce,req.session.key);
	return {
		user: user,
		session: {
			//nonce: nacl.to_hex(nonce),
			pk: nacl.to_hex(nacl.crypto_sign(sessionKeys.boxPk,serverKeys.signSkUint8))
			//sessNonce: nacl.to_hex(sessNonce)
		},
		server : {
			signPk: serverKeys.signPk
		}
	}
}
*/

var encodeMail = function(mail,recipientPk) {
	var mailKeys = nacl.crypto_box_keypair();
	var nonce = nacl.crypto_box_random_nonce();
	var encoded = mail;
	try {
		encoded.nonce = nacl.to_hex(nonce);
		encoded.pk = nacl.to_hex(mailKeys.boxPk);
		encoded.body = nacl.to_hex(
				nacl.crypto_box(mail.body,nonce,recipientPk,mailKeys.boxSk)
			);
	}
	catch(err) {
		encoded = null;
	}

	return encoded;
}

var skFromUser = function(password,user) {
	var res = null;
	try {
		var passHash = scrypt.kdf(password,{'N':65536, 'r':8, 'p': 1},scrypt.kdf.config.outputLength,user.salt);
		var nonce = nacl.from_hex(user.nonce);
		var p = nacl.from_hex(passHash.hash);
		res = {};
		res.pk = nacl.from_hex(user.pk);
		res.sk = nacl.crypto_secretbox_open(nacl.from_hex(user.sk),nonce,nacl.from_hex(passHash.hash));
		res.p = p;
	}
	catch(err) {
		console.log(err);
		res = null;
	}
	return res;
}

var newUser = function(password) {
	var res = null;
	try {
		res = scrypt.kdf(password,{'N':65536, 'r':8, 'p': 1});
		var keypair = nacl.crypto_box_keypair();
		var nonce = nacl.crypto_secretbox_random_nonce();
		var p = nacl.from_hex(res.hash);
		delete res.hash;

		res.nonce = nacl.to_hex(nonce);
		res.pk = nacl.to_hex(keypair.boxPk);
		res.sk = nacl.to_hex(nacl.crypto_secretbox(keypair.boxSk,nonce,p));
		res.box = keypair;
		res.p = p;
	}
	catch(err) {
		console.log(err);
		res = null;
	}
	return res;
}

var decodeUserMeta = function(meta,password) {
	var nonce = nacl.from_hex(meta.nonce);
	return JSON.parse(nacl.decode_utf8(
		nacl.crypto_secretbox_open(
			nacl.from_hex(meta.value),
			nonce,
			password)
		)
	);
}

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
}

var getMails = function(params, callback) {
	var limit = params.limit || 20;
	var folder = params.folder || 'inbox';
	var firstElem = params.firstElem || 0;
	var session = params.session;

	inboxes.query(
		{limit:limit,key:[session.username,folder],descending:true,skip:firstElem},
		function(err, results) {
			var keys = new Array();
			for(var id in results) {
				keys.push(results[id].id);
			}
			mailsdb.getMulti(keys, {}, function(err, results) {
				var result = new Array();
				for(var id in results) {
					if(results[id].value) {
						var mail = decodeMail(results[id].value,session.sk);
						mail = JSON.parse(nacl.decode_utf8(mail));
						mail.id = id;
						result.push(mail);
					}
				}
				callback(result);
			});
	});
}

var deleteMail = function(mailid, callback) {
	mailsdb.get(mailid, {},function(err, result) {
		if(err) {
			console.log(err);
			callback({status: 'NOK'});
			return;
		}
		result.value.folder = 'trash';
		mailsdb.set(mailid,result.value,function(err, result) {
			if(err) {
				console.log(err);
				callback({status: 'NOK'});
				return;
			}
			callback({status: 'OK'});
		});
	});
}

var sendpMail = function(mail, to, senderPk, folder, callback) {

	var _mail = mail;
	_mail.date = new Date();

	var message = nacl.encode_utf8(JSON.stringify(_mail));

	usersdb.getMulti(to, {}, function(err, results) {
		for(var user in results) {
			if(results[user].hasOwnProperty('value')) {
				var encoded = encodeMail({
						username:user,
						body:message,
						folder:folder
					},senderPk);
				var mailId = (+new Date).toString(36)+'-pmailInt';
				mailsdb.set(mailId, encoded, function(err, results) {
					if(err) {
						console.log(err);
					}
					else {
						_mail.id = mailId;
						callback(_mail);
					}
				});
			}
		}
	});
}


module.exports = {
	decodeRequest: decodeRequest,
	encodeResponse: encodeResponse,
	decodeMail: decodeMail,
	encodeMail: encodeMail,
	skFromUser: skFromUser,
	decodeUserMeta: decodeUserMeta,
	encodeUserMeta: encodeUserMeta,
	newUser: newUser,
	getMails: getMails,
	deleteMail: deleteMail,
	randomSession: randomSession,
	sendpMail: sendpMail,
}
