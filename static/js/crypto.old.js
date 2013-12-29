$(function() {
	

	var scrypt = scrypt_module_factory(134217728);
	var nacl = nacl_factory.instantiate();

	var senderKeypair = nacl.crypto_box_keypair();
	var recipientKeypair = nacl.crypto_box_keypair();
	var nonce = nacl.crypto_box_random_nonce();

	$('#privkey').val(nacl.to_hex(senderKeypair.boxSk));
	$('#pubkey').val(nacl.to_hex(senderKeypair.boxPk));

	$('#password').keypress(function(event) {
		if (event.keyCode === 13) {
			var k = scrypt.crypto_scrypt(nacl.encode_utf8($('#password').val()),
												nacl.random_bytes(16),
												65536, 8, 1, 32);
			//console.log(nacl.to_hex(k));
			$('#generatedk').val(nacl.to_hex(k));

			var packet = nacl.crypto_box(nacl.encode_utf8($('#cleartext').val()), nonce, recipientKeypair.boxPk, senderKeypair.boxSk);
			var n = nacl.crypto_secretbox_random_nonce();
			try {
				var c = nacl.crypto_secretbox(recipientKeypair.boxSk,n,k);
			}
			catch(err) {
				console.log(err);
			}
			
			var m = nacl.crypto_secretbox_open(c,n,k);
			console.log(m);
			console.log(recipientKeypair.boxSk);

			try {
				var decoded = nacl.crypto_box_open(packet, nonce, senderKeypair.boxPk, m);
			}
			catch(err) {
				console.log(err);
			}

			$('#encryptedmessage').val(nacl.to_hex(packet));
			$('#decryptedmessage').val(nacl.decode_utf8(decoded));



		}
	});
	console.log('Ready !');
});