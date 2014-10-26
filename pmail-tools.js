'use strict';
var nacl 		 = require('js-nacl').instantiate();
var scrypt 		 = require('scrypt');
var mongoose     = require('mongoose');
var simplesmtp	 = require('simplesmtp');
var mailcomposer = require('mailcomposer').MailComposer;
var domains 	 = ['pik.io'];
var masterdomain = 0;

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

scrypt.kdf.config.saltEncoding 		= 'hex';
scrypt.kdf.config.keyEncoding		= 'hex';
scrypt.kdf.config.outputEncoding 	= 'hex';
scrypt.kdf.config.defaultSaltSize 	= 32;
scrypt.kdf.config.outputLength 		= 32;

var mailPool = simplesmtp.createClientPool(2555, '127.0.0.1', {
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

    Mail.find({username:username,folder:folder}).sort( { $natural: -1 } ).skip(firstElem).limit(limit).exec(
		function(err, results) {
			if(err) {
				callback(err,{});
				return;
			}
            else {
                var result = new Array();
                for(var id in results) {
                    if(results[id]) {
                        var mail = decodeMail(results[id],userSk);
                        if(mail) {
                            mail = JSON.parse(nacl.decode_utf8(mail));
                            mail.id = results[id]._id;
                            result.push(mail);
                        }
                    }
                }
                callback(null,result);
			}
		}
	);
};

module.exports.deleteMail = function(mailid, callback) {
    Mail.update({_id:mailid}, {folder:'trash'}, {multi:false}, function(err,numberAffected,raw) {
		if(err || numberAffected !== 1) {
			console.log(err);
			callback(err);
			return;
		}
	});
};

module.exports.updateUser = function(user, callback) {
    User.update({username:user.username}, {meta:encodeUserMeta(user.meta,user.password)}, {multi:false}, function(err,numberAffected,raw) {
		if(err || numberAffected !== 1) {
			callback(err);
			return;
		}
	});
};

module.exports.sendMail = function(user,mail,callback) {
	mail.date = new Date();
	mail.from = [{
		address: user.username+'@'+domains[masterdomain],
		name: (user.meta && user.meta.fullname && user.meta.fullname.length > 1)?user.meta.fullname:''
	}];

	var senderPk = new Uint8Array(user.pk);
	var senderSignSk = new Uint8Array(user.signsk);
	var message = nacl.encode_utf8(JSON.stringify(mail));
	var encoded = encodeMail(message,senderPk);
    
	if(encoded) {
		encoded.folder = 'sent';
		encoded.username = user.username;
		encoded.sign = signMail(message,senderSignSk);
        (new Mail(encoded)).save(function(err) {
				if(err) {
					callback(err,{});
					return;
				}

				mail.id = encoded._id;
				callback(null,mail);
			}
		);
	}
	else {
		callback('',{});
		return;
	}

	var pMailTo = new Array();
	var extTo = new Array();
	var fullPMail = new RegExp('^(.+)@('+domains.join('|')+')$','i');
	var isMail = new RegExp('^(.+)@(.+)$','i');

	mail.to.forEach(function(oneMail) {
		if(isMail.exec(oneMail.address)) {
			var fullTest = fullPMail.exec(oneMail.address);
			if(fullTest) {
				pMailTo.push(fullTest[1]);
			}
			else {
				extTo.push(oneMail.address);
			}
		}
		else {
			pMailTo.push(oneMail.address);
		}
	});

    if(pMailTo.length > 0) {
        User.find({username : {$in : pMailTo}},
              function(err, results) {
                    for(var recipient in results) {
                        if(results[recipient].pk) {
                            var encoded = encodeMail(message,nacl.from_hex(results[recipient].pk));
                            encoded.folder = 'inbox';
                            encoded.username = results[recipient].username;
                            if(results[recipient].signpk) {
                                encoded.sign = signMail(message,results[recipient].signpk);
                            }
                            (new Mail(encoded)).save(function(err) {
                                if(err) {
                                    console.log(err);
                                }
                            });
                        }
                    }
              }
        );
    }

	mail.envelope = {to:new Array()};
	mail.to.forEach(function(oneMail) {
		if(oneMail.name && oneMail.name.length>0) {
			mail.envelope.to.push(oneMail.name+' <'+oneMail.address+'>');
		}
		else {
			mail.envelope.to.push(oneMail.address);
		}
	});
	mail.envelope.to = mail.envelope.to.join(', ');
	if(mail.from[0].name && mail.from[0].name.length>0) {
		mail.envelope.from = mail.from[0].name+' <'+mail.from[0].address+'>';
	}
	else {
		mail.envelope.from = mail.from[0].address;
	}
	mail.from = mail.from[0].address;
	var extMail = new mailcomposer();

	extTo.forEach(function(to) {
		mail.to = to;
		extMail.setMessageOption(mail);
		mailPool.sendMail(extMail,function(err,message) {
			if(err) {
				console.log(err);
				console.log(message);
			}
		});
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
        console.log(err.stack);
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
        console.log(err.stack);
		encoded = null;
	}
	return encoded;
};

var signMail = function(mail,senderSignSk) {
	var sign = null;
	try {
		sign = nacl.to_hex(nacl.crypto_sign_detached(mail,senderSignSk));
	}
	catch(err) {
        console.log(err.stack);
		sign = null;
	}
	return sign;
}

var checkSign = function(mail,senderSignPk) {
	return false;
}

var decodeUserMeta = function(meta,password) {
    var result = null;
    if(meta && meta.nonce && meta.value) {
    	try {
		    var nonce = nacl.from_hex(meta.nonce);
	    	var value = nacl.from_hex(meta.value);
    		result = JSON.parse(nacl.decode_utf8(nacl.crypto_secretbox_open(value,nonce,password)));
	    }
	    catch (err) {
            console.log(err.stack);
	    }
    }
	return result;
};

var encodeUserMeta = function(meta,password) {
	var nonce = nacl.crypto_secretbox_random_nonce();
	var result = null;
	try {
		result = {
			nonce : nacl.to_hex(nonce),
			value : nacl.to_hex(
				nacl.crypto_secretbox(
					nacl.encode_utf8(JSON.stringify(meta)),
					nonce,
					password)
				)
		}
	}
	catch (err) {
        console.log(err.stack);
	}
	return result;
};

var pMailUser = function(username,password,isNew,callback) {
	if(isNew) {
		var user = newUser(password);
			
		if(!user) {
			callback('error',{});
		}
		else {
			var _user = {
				sk : user.box.boxSk,
				pk : user.box.boxPk,
				signsk : user.sign.signSk,
				signpk : user.sign.signPk,
				password : user.password,
				username : username,
				meta : {}
			};
			delete user.box;
			delete user.sign;
			delete user.password;
            user.username = username;
            var dbUser = new User(user);
			dbUser.save(function(err) {
                console.log(err);
				callback(null,_user);
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
					signsk : user.signsk,
					signpk : user.signpk,
					password : user.password,
					username : username,
					meta : user.meta || {}
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
		var signpair = nacl.crypto_sign_keypair();
		var boxnonce = nacl.crypto_secretbox_random_nonce();
		var signnonce = nacl.crypto_secretbox_random_nonce();
		var p = nacl.from_hex(pass.hash);

		res = {
			boxnonce : nacl.to_hex(boxnonce),
			signnonce : nacl.to_hex(signnonce),
			pk : nacl.to_hex(keypair.boxPk),
			sk : nacl.to_hex(nacl.crypto_secretbox(keypair.boxSk,boxnonce,p)),
			signpk : nacl.to_hex(signpair.signPk),
			signsk : nacl.to_hex(nacl.crypto_secretbox(signpair.signSk,signnonce,p)),
			salt : pass.salt,
			box : keypair,
			sign : signpair,
			password : p
		};
	}
	catch(err) {
        console.log(err.stack);
		res = null;
	}
	return res;
};

var loadUser = function(username, password, callback) {
	var user = null;
	var _password = password;
    User.findOne({username:username}, function(err,result) {
		if(err || !result) {
			callback('Bad password',{});
		}
		else {
			try {
				var passHash = scrypt.kdf(_password,{'N':65536, 'r':8, 'p': 1},scrypt.kdf.config.outputLength,result.salt);
				var boxnonce = nacl.from_hex(result.boxnonce);
				var signnonce = nacl.from_hex(result.signnonce);
				var password = nacl.from_hex(passHash.hash);
				user = {
					pk : nacl.from_hex(result.pk),
					sk : nacl.crypto_secretbox_open(nacl.from_hex(result.sk),boxnonce,password),
					signpk : nacl.from_hex(result.signpk),
					signsk : nacl.crypto_secretbox_open(nacl.from_hex(result.signsk),signnonce,password),
					password : password,
					meta : result.meta?decodeUserMeta(result.meta,password):{}
				};
				callback(null,user);
			}
			catch (err) {
                console.log(err.stack);
				callback('Bad password',{});
			}
		}

	});



}


