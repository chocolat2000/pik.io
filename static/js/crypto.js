'use strict';
var scrypt 	= scrypt_module_factory(134217728);
var nacl 	= nacl_factory.instantiate();

var incNonce = function(nonce) {
	var nnonce = nonce;
	var i = nnonce.length-1;
	nnonce[i] += 2;
	if(nnonce[i] < 2) {
		do {
			--i;
			nnonce[i] = nnonce[i] + 1;
		}
		while ((i > 0) && (nnonce[i] === 0));
	}
	return nnonce;
};

var decNonce = function(nonce) {
	var i = nonce.length-1;
	nonce[i] -= 2;
	if(nonce[i] >= 254) {
		do {
			--i;
			nonce[i] = nonce[i] - 1;
		}
		while ((i > 0) && (nonce[i] === 255 ));
	}
}

var joinUser = function(username,password) {
	var keypair = nacl.crypto_box_keypair();
	var nonce = nacl.crypto_box_random_nonce();
	var salt = nacl.random_bytes(16);

	var k = scrypt.crypto_scrypt(scrypt.encode_utf8(password), salt, 65536, 8, 1, 32);

	var n = nacl.crypto_secretbox_random_nonce();
	var sk = nacl.crypto_secretbox(keypair.boxSk,n,k);

	var retVal = null;

	$.ajax({
		url: '/login/'+username,
		type: 'POST',
		contentType: 'application/json',
		async: false,
		data: JSON.stringify({
			salt: nacl.to_hex(salt),
			nonce: nacl.to_hex(n),
			pk: nacl.to_hex(keypair.boxPk),
			sk: nacl.to_hex(sk)
		})
	})
	.done(function(data) {
		if(data.hasOwnProperty('res')) {
			var sessionPk = nacl.from_hex(data.res.session.pk);
			sessionPk = nacl.crypto_sign_open(sessionPk,nacl.from_hex(data.res.server.signPk));
			var sessionKey = nacl.crypto_box_precompute(sessionPk,keypair.boxSk);
			retVal = {
				pk: keypair.boxPk,
				sk: keypair.boxSk,
				sessionKey: sessionKey,
				k: k,
				p: {}
			};
		}

	});
	return retVal;
};

var loginUser = function(username,password) {
	var retVal = null;
	$.ajax({
		url: '/login/'+username,
		type: 'GET',
		async: false
	})
	.done(function(data) {
		if(data.hasOwnProperty('res')) {
			var nonce = nacl.from_hex(data.res.user.nonce);
			var salt = nacl.from_hex(data.res.user.salt);
			var pk = nacl.from_hex(data.res.user.pk);
			var sk = nacl.from_hex(data.res.user.sk);
			var sessionPk = nacl.from_hex(data.res.session.pk);
			var p = data.res.user.p || null;
			if(p && p.hasOwnProperty('nonce') && p.hasOwnProperty('data')) {
				p.nonce = nacl.from_hex(p.nonce);
				p.data = nacl.from_hex(p.data);
			}
			var k = scrypt.crypto_scrypt(scrypt.encode_utf8(password), salt, 65536, 8, 1, 32);
			try {
				sk = nacl.crypto_secretbox_open(sk,nonce,k);
				sessionPk = nacl.crypto_sign_open(sessionPk,nacl.from_hex(data.res.server.signPk));
				var sessionKey = nacl.crypto_box_precompute(sessionPk,sk);
				if(p) {
					p = nacl.decode_utf8(nacl.crypto_secretbox_open(p.data,p.nonce,k));
				}
				retVal = {
					pk: pk,
					sk: sk,
					//signSk: signSk,
					sessionKey: sessionKey,
					k: k,
					p: JSON.parse(p)
				};
			}
			catch(err) {
				console.log(err.message);
			}

		}
	});
	return retVal;

};

var updateUser = function(fullname) {
	var retVal = null;
	var nonce = nacl.crypto_box_random_nonce();
	var p = {
		nonce: nacl.to_hex(nonce)
	};
	var	data = JSON.stringify({fullname: fullname});
	data = nacl.crypto_secretbox(nacl.encode_utf8(data),nonce,PMail.k);
	p.data = nacl.to_hex(data);
	sendRequest('update', {p:p})
	.then(function(data) {

	});
}

var decodeMail = function(mails) {
	if(!PMail.sk) return;
	mails.forEach(function(mail) {
		var nonce = nacl.from_hex(mail.nonce);
		var pk = nacl.from_hex(mail.pk);
		var body = nacl.from_hex(mail.body);
		try {
			var message = nacl.crypto_box_open(body,nonce,pk,PMail.sk);
			var d_mail = JSON.parse(nacl.decode_utf8(message));
			mail.subject = d_mail.subject || 'No subject';
			if(d_mail.html) {
				mail.body = ($(document.createElement('div')).append($.parseHTML(d_mail.html))).html();
			}
			else {
				mail.body = (d_mail.text) || '';
			}

			if(d_mail.from && d_mail.from.length > 0) {
				mail.from = d_mail.from;
			}
			if(d_mail.to && d_mail.to.length > 0) {
				mail.to = d_mail.to;
			}
			if(d_mail.headers && d_mail.headers.date) {
				mail.date = d_mail.headers.date;
			}
			mail.visible = true;
			delete mail.pk;
			delete mail.nonce;
			delete mail.username;

			PMail.searchindex.add({
				id:		mail.id,
				subject:mail.subject || '',
				body:	mail.body || '',
				from:	mail.from? PMail.recipentListToString(mail.from) || '' : '',
				to:		mail.to? PMail.recipentListToString(mail.to) || '' : '',
				date:	mail.date || ''
			});
		}
		catch(err) {
			console.log('error decode:',mail.id,err);
		}
	});
};

var newMail = function(mail) {
	var deferred = $.Deferred();
	if(!mail || !mail.to || !PMail.signSk) deferred.reject();
	var to = new Array();
	var mails = new Array();
	var fullPMail = new RegExp('^(.+)@'+PMail.domain+'$','i');
	var isMail = new RegExp('^(.+)@(.+)$','i');

	for(var i = 0; i<mail.to.length; i++) {
		if(isMail.exec(mail.to[i].address)) {
			var fullTest = fullPMail.exec(mail.to[i].address);
			if(fullTest) {
				to.push(fullTest[1]);
			}
			else {
				mails.push({
					body:mail
				})
			}
		}
		else {
			to.push(mail.to[i].address);
		}
	}
	sendRequest('users', {users:to})
	.then(function(response) {
		var users = response.users;
		var message = nacl.encode_utf8(JSON.stringify(mail));
		to.push('me');
		for(var i=0; i<to.length; i++) {
			var user = to[i];
			if(users[user] || user === 'me') {
				var sessionKeys = nacl.crypto_box_keypair();
				var nonce = nacl.crypto_box_random_nonce();
				var pk = users[user] ? nacl.from_hex(users[user].pk) : PMail.pk;
				mails.push({
					username:user,
					pk:nacl.to_hex(sessionKeys.boxPk),
					nonce:nacl.to_hex(nonce),
					body:nacl.to_hex(nacl.crypto_box(message,nonce,pk,sessionKeys.boxSk)),
				});
			}
		}
		sendRequest('send',{mails:mails})
		.then(function(response) {
			if(response.message === 'OK')
				deferred.resolve();
			else
				deferred.reject();
		},function(err) {
			deferred.reject();
		});
	}, function(err) {
		deferred.reject();
	});
	return deferred;
};

var sendRequest = function(type, request) {
	var deferred = $.Deferred();
	request.req = type;
	var req = encodeRequest(request);
	$.ajax({
		url: '/',
		type: 'POST',
		contentType: 'application/json',
		data: JSON.stringify(req)
	}).then(function(data) {
		deferred.notify("Response received");
		try {
			var decoded = decodeResponse(data, req.nonce);
		}
		catch (err) {
			deferred.fail("Cannot decode response");
		}
		if(decoded) {
			deferred.resolve(decoded);
		}
		else {
			deferred.fail("Cannot decode response");
		}
	}, function(err) {
		deferred.fail();
	})
	return deferred;
}

var encodeRequest = function(req) {
	if(!PMail.sessionKey) return;
	var nonce = nacl.crypto_box_random_nonce();
	var request = nacl.encode_utf8(JSON.stringify(req));
	return {
		req: nacl.to_hex(nacl.crypto_box_precomputed(request,nonce,PMail.sessionKey)),
		nonce: nacl.to_hex(nonce)
	};
};

var decodeResponse = function(res, nonce) {
	if(!res.hasOwnProperty('res')) return null;
	var nonce = incNonce(nacl.from_hex(nonce));
	try {
		var decoded = nacl.decode_utf8(nacl.crypto_box_open_precomputed(nacl.from_hex(res.res),nonce,PMail.sessionKey));
	}
	catch (err) {
		throw "Decode Error";
	}
	return JSON.parse(decoded);
}
