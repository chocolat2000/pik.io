$(function() {
	var scrypt = scrypt_module_factory(134217728);
	var rsa = new JSEncrypt({default_key_size: 2048});
	var pubkey;
	var privkey;
	rsa.setPrivateKey('-----BEGIN RSA PRIVATE KEY-----\n\
MIIEogIBAAKCAQBuFTvJJoE9JWQS5iw+bnaae/KpE9QyCzjE/1RgeDhrh9N9ks9b\n\
qXLNbxwuAaaMTZOAS69Xjkn3mwKzZbO0yBbldvdZ/jOqlVvqOASA1ThISvi6SaI3\n\
jbKHNEP2TMg9JMUOeQExCWgGHUd23bqX3sMGrcyxdDY7QNxcWqe6HeApUjJX/f1S\n\
wKi0XmAidt2DH9biwjvb71glS0UIepLkVT93OfftiHRrge1hY7ZqFV3FQOu5Zfy9\n\
rSs0sCFm+lNAoc2AYyinCTMuj6CjUtDY+IHfA2gLNVR39Suc66Hl7Yq4Ihz+dgcw\n\
nQGwPVax2yW2+1sBLkuzc+f/wscEzNVsG2SvAgMBAAECggEAKlCvMptCgqak2T7x\n\
Mu5zWN7cYHHm13XI1LDxVkPgLDWB7ntIiguQvbdANc8cnkITuPVe6WEgvbUwTJWD\n\
hrKDWqFoY4d7hM71DguKb5uGjwOCqNk1KfWl8qL8nOjW7+n6dZ29/4OGIROQLPj+\n\
iPJwNVkJngz168D68+VFJB3n1PnoX7Hz2+kQzUnkIY9nI1dBpoMwo1IDYgYBWb2M\n\
Pg02z5S0HGWNVRcjj0FJ6MMtRZR6ik/OjHi598+wyb3cK5TgsC96362qxUy29SMa\n\
VRh66hy+AxzSEBVqIUMj0ezcvK+l1ODFgXGwMwt6ub/rdU9daKhWRlCXc+Jki4s9\n\
p49KwQKBgQDKUWGMF1ii0chZqyiCJt9BOBIQ5J6N5F1HDFn1XH6DjJAxcOUHNOQx\n\
7b9zShMh8mCWClWuREkM2/sSvtl1CIdQ1ZmaoOI31+7mYV9yRgSjhp3ivYROaDeN\n\
bnJdf3W3GftDxW4l8v+jyXLm7uhfk3m2PkKIl6Vk2Xbhi59LZ/K6LQKBgQCLSraV\n\
WVq5UkJGvF8YwFfycqBS5bqRoX6qAlErWt4VIWu1kPIFnadRijFMXzR+j01FB9CP\n\
36sbAgd8Jb5wswMHyzj64zCMvwRFf41EeeKNbgZSfsPpuIQJv8baVto1PPV5+sXD\n\
I4bpmcQzD9O/VogJz8nfacfeZi0UuiKiIfGvywKBgGBPiV5FJt6revKkte3vT0we\n\
wwrjqk7lrTnLOW/CDj/VRDclBQH/Pbo+8WqSkrUQSsZiORNyUkwa1FTCIYbC/peO\n\
d0bS252133YwWF1v03l89eAgU8F3fyqGr06vBHybk69ZZuwN14BCv74LcPc+nywQ\n\
S1/2wLdXhm4sJzKgUz4pAoGAJNdwD3SA0H93VCpCpNNK769txD9K53XlgKX4PhVc\n\
pA4g5PcfbGjUdnasr1yHD+prL5Tvjv5DzXLt8+IvyrMuXANeYM1ya+eiA5fHD5OF\n\
Xo75URyCSPEqy0FUIS/Tqz0iWE8Bu6lL58Fp6W+IPBVxCddRt6vM14AC8HaC7os3\n\
150CgYEAjVSkbp2gD3kJ8j4jBYtEPq1rtcTWWdd0gryGPfuStHIk5o2EN6JU3+8B\n\
d5BYiHUhEif7UZ3Uz87bvar0mjnKoyE7QpGmAVeEGzeCwldswkUXpuI5h+kQriVd\n\
KV9hbyrWXPh9ZzQTQGMnQJWAOOo7U9OuLuIhr1Umb0sNnwMV898=\n\
-----END RSA PRIVATE KEY-----');

	$('#privkey').val(rsa.getPrivateKey());
	$('#pubkey').val(rsa.getPublicKey());

	$('#password').keypress(function(event) {
		if (event.keyCode === 13) {
			$('#generatedaeskey').val('');
			$('#encryptedaeskey').val('');
			$('#deencryptedaeskey').val('');
			var keyBytes = scrypt.crypto_scrypt(scrypt.encode_utf8($('#password').val()),
												CryptoJS.lib.WordArray.random(16),
												65536, 8, 1, 512);
			//console.log(key);
			$('#generatedaeskey').val(scrypt.to_hex(keyBytes));
			//var iv  = CryptoJS.lib.WordArray.random(16);
			//var encryptedprivatekey = CryptoJS.AES.encrypt(rsa.getPrivateKey(), keyBytes, {iv:iv});
			//console.log(rsa.getPrivateKey());
			//console.log(decrypted);

			var sessionKey = scrypt.crypto_scrypt(CryptoJS.lib.WordArray.random(16),
												CryptoJS.lib.WordArray.random(16),
												65536, 8, 1, 512);
			var sessioniv  = CryptoJS.lib.WordArray.random(16);
			var encryptedmessage = CryptoJS.AES.encrypt($('#cleartext').val(), sessionKey, {iv:sessioniv});
			$('#encryptedmessage').val(encryptedmessage.ciphertext.toString(CryptoJS.enc.Base64));
			var rsaEnc = new JSEncrypt();
			rsaEnc.setPublicKey($('#pubkey').val());
			console.log(scrypt.to_hex(sessionKey));
			var encryptedsessionkey = rsaEnc.encrypt(scrypt.to_hex(sessionKey));

			var deencryptedsessionkey = rsa.decrypt(encryptedsessionkey);
			console.log(deencryptedsessionkey);

			var decryptedmessage = CryptoJS.AES.decrypt(encryptedmessage, CryptoJS.enc.Hex.parse(deencryptedsessionkey), {iv:sessionKey.iv});

			$('#deencryptedmessage').val(decryptedmessage.toString(CryptoJS.enc.Utf8));

		}
	});
	console.log('Ready !');
});