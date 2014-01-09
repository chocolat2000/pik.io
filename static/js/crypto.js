var scrypt 	= scrypt_module_factory(134217728);
var nacl 	= nacl_factory.instantiate();

var incNonce = function(nonce) {
	var i = nonce.length-1;
	nonce[i] += 2;
	if(nonce[i] < 2) {
		do {
			--i;
			nonce[i] += 1;
		}
		while ((i > 0) && (nonce[i] < 1));
	}
};

var joinUser = function(username,password) {
	var keypair = nacl.crypto_box_keypair();
	var nonce = nacl.crypto_box_random_nonce();
	var salt = nacl.random_bytes(16);

	var k = scrypt.crypto_scrypt(scrypt.encode_utf8(password), salt, 65536, 8, 1, 32);

	var n = nacl.crypto_secretbox_random_nonce();
	var c = nacl.crypto_secretbox(keypair.boxSk,n,k);

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
			sk: nacl.to_hex(c)
		})
	})
	.done(function(data) {
		if(data.status === 'OK' && data.serverPk) {
			retVal = {
				serverPk: nacl.from_hex(data.serverPk),
				pk: keypair.boxPk,
				sk: keypair.boxSk,
				sessionNonce: nacl.fom_hex(data.sessionNonce)
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
		if(data.status === 'OK' && data.res) {
			var nonce = nacl.from_hex(data.res.user.nonce);
			var salt = nacl.from_hex(data.res.user.salt);
			var pk = nacl.from_hex(data.res.user.pk);
			var sk = nacl.from_hex(data.res.user.sk);
			var sessionNonce = nacl.from_hex(data.res.session.sessNonce);
			var sessionPk = nacl.from_hex(data.res.session.pk);
			var sNonce = nacl.from_hex(data.res.session.nonce);
			var k = scrypt.crypto_scrypt(scrypt.encode_utf8(password), salt, 65536, 8, 1, 32);
			try {
				sk = nacl.crypto_secretbox_open(sk,nonce,k);
				var sessionKey = nacl.crypto_box_precompute(sessionPk,sk);
				sessionNonce = nacl.crypto_box_open_precomputed(sessionNonce,sNonce,sessionKey);
				retVal = {
					sk: sk,
					sessionNonce: sessionNonce,
					sessionKey: sessionKey
				};
			}
			catch(err) {
				console.log(err.message);
			}

		}
	});
	return retVal;

};

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
			//if(d_mail.html) {
			//	mail.body = d_mail.html.split(/(<body[^>]*>|<\/body>)/ig)[2];
			//}
			//else {
				mail.body = d_mail.text || '';
			//}

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

var decodeResponse = function(res) {
	if(!res.hasOwnProperty('res')) return null;
	var nonce = PMail.sessionNonce;
	incNonce(PMail.sessionNonce); 
	return JSON.parse(nacl.decode_utf8(nacl.crypto_box_open_precomputed(nacl.from_hex(res.res),nonce,PMail.sessionKey)));
}

var newMail = function(mail) {
	var deferred = $.Deferred();
	if(!mail || !mail.to || !PMail.sk) deferred.reject();
	var to = new Array();
	for(var i = 0; i<mail.to.length; i++) {
		to.push(mail.to[i].address);
	}
	$.ajax({
		url: '/users',
		type: 'GET',
		async: false,
		data: {
			req:encodeRequest({users:to})
		}
	})
	.then(function(data) {
		var users = decodeResponse(data).users;
		var message = nacl.encode_utf8(JSON.stringify(mail));
		var mails = new Array();
		for(var i=0; i<to.length; i++) {
			var user = to[i];
			if(users[user]) {
				var sessionKeys = nacl.crypto_box_keypair_from_seed(nacl.random_bytes(64));
				var nonce = nacl.crypto_box_random_nonce();
				var pk = nacl.from_hex(users[user].pk);
				mails.push({
					username:user,
					pk:nacl.to_hex(sessionKeys.boxPk),
					nonce:nacl.to_hex(nonce),
					body:nacl.to_hex(nacl.crypto_box(message,nonce,pk,sessionKeys.boxSk))
				});
			}
		}
		$.ajax({
			url: '/send',
			type: 'POST',
			contentType: 'application/json',
			async: false,
			data: JSON.stringify({req:encodeRequest({mails:mails})})
		})
		.done(function(data) {
			deferred.resolve();
		})
		.fail(function(err) {
			deferred.reject();
		});
	});
	return deferred;
};

var encodeRequest = function(req) {
	if(!PMail.sessionKey || !PMail.sessionNonce) return;
	var nonce = PMail.sessionNonce;
	incNonce(PMail.sessionNonce);
	var request = nacl.encode_utf8(JSON.stringify(req));
	return nacl.to_hex(nacl.crypto_box_precomputed(request,nonce,PMail.sessionKey));
};