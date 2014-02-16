var nacl 		= require('js-nacl').instantiate();


nacl.from_hex = function (s) {
	var result = new Uint8Array(s.length / 2);
	for (var i = 0; i < s.length / 2; i++) {
		 result[i] = parseInt(s.substr(2*i,2),16);
	}
	return result;
};

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

var randomSession = function(size) {
	return nacl.to_hex(nacl.random_bytes(size));
}

var decodeRequest = function(req) {
	if(!req.session.key || !(req.query.hasOwnProperty('req') || req.body.hasOwnProperty('req'))) return null;
	var request = nacl.from_hex(req.query.req || req.body.req);
	var nonce = req.session.nonce;
	incNonce(req.session.nonce);
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
	var nonce = req.session.nonce;
	incNonce(req.session.nonce);
	try {
		return {res:nacl.to_hex(nacl.crypto_box_precomputed(response,nonce,req.session.key))};
	}
	catch(err) {
		return {res:'Failed'};
	}
	
}

var decodeMail = function(mail,pk) {
	var nonce = nacl.from_hex(mail.nonce);
	var n_key = nacl.from_hex(mail.key);
	var body = nacl.from_hex(mail.body);
	try {
		var d_key = nacl.decode_utf8(nacl.crypto_box_open(n_key,nonce,pk,serverSk)).split(':');
		var key = nacl.from_hex(d_key[0]);
		var n = nacl.from_hex(d_key[1]);
		var message = nacl.crypto_secretbox_open(body,n,key);
		return JSON.parse(nacl.decode_utf8(message));

	}
	catch(err) {
		return null;
	}
}

var newConnection = function(req,user) {
	var sessionKeys = nacl.crypto_box_keypair_from_seed(nacl.random_bytes(64));
	req.session.nonce = nacl.crypto_secretbox_random_nonce();
	req.session.key = nacl.crypto_box_precompute(nacl.from_hex(user.pk),sessionKeys.boxSk);
	var nonce = nacl.crypto_box_random_nonce();
	var sessNonce = nacl.crypto_box_precomputed(req.session.nonce,nonce,req.session.key);
	return {
		user: user,
		session: {
			nonce: nacl.to_hex(nonce),
			pk: nacl.to_hex(sessionKeys.boxPk),
			sessNonce: nacl.to_hex(sessNonce)
		}
	}
}

var newUser = function(user) {

}

module.exports = {
	decodeRequest: decodeRequest,
	encodeResponse: encodeResponse,
	decodeMail: decodeMail,
	newConnection: newConnection,
	newUser: newUser,
	randomSession: randomSession,
	nacl: nacl
}
