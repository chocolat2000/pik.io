'use strict';
var express		= require('express');
var couchbase	= require('couchbase');
var MemcachedStore = require('connect-memcached')(express);
var tools 		= require('./pmail-tools');
var simplesmtp	= require('simplesmtp');
var MailComposer = require('mailcomposer').MailComposer;

var app 	= express();
var usersdb = new couchbase.Connection({host: 'localhost:8091', bucket: 'users'});
var mailsdb = new couchbase.Connection({host: 'localhost:8091', bucket: 'mails'});

var mailPool = simplesmtp.createClientPool(587, 'localhost', {
	auth : {
		user: 'pikio',
		pass: 'pikio'
	}
});
var domains = ['pik.io'];

var inboxes = mailsdb.view('inboxes','by_username');

app.configure(function(){
	app
		.use(express.favicon())
		.use(express.compress())
		.use(express.cookieParser())
		//.use(express.session({
		//	secret: tools.randomSession(32),
		//	store: new MemcachedStore({
		//		hosts: [ '127.0.0.1:11211' ]
		//	})
		//}))
		.use(express.session({secret: tools.randomSession(32)}))
		.use(express.json())
		.use(app.router);
});

app
	.get('/', function(req, res) {
	  res.redirect('/index.htm');
	})
	.post('/login/:username', function(req, res){
		/*
		req.session.pk = null;
		req.session.nonce = null;
		if(req.body && req.body.nonce && req.body.pk && req.body.sk) {
			if(req.params.username.length > 2) {
				usersdb.set(req.params.username, req.body, function(err, result) {
					res.send({status: 'OK', res:tools.newConnection(req,req.body)});
					req.session.user = req.params.username;
				});

			}
			else {
				res.send({status: 'NOK'});
			}
		}
		else {
			res.send({status: 'NOK'});
		}
		*/
		if((req.params.username.length < 3) || !req.body.hasOwnProperty('p')) {
			res.send({status: 'NOK'});
			return;
		}
		var user = tools.newUser(req.body.p);
		//console.log(user);

		req.session.sk = user.box.boxSk;
		req.session.pk = user.box.boxPk;
		req.session.p = user.p;
		req.session.username = req.params.username;
		delete user.box;
		delete user.p;
		usersdb.set(req.params.username, user, function(err, result) {
			if(err) {
				res.send({status: 'NOK'});
			}
			else {
				res.send({status: 'OK'});
			}
			
		});
		
		
	})
	.get('/login/:username', function(req, res){
		/*
		req.session.pk = null;
		req.session.nonce = null;
		usersdb.get(req.params.username, function(err,result) {
			if(!err && result.value) {
				res.send({status: 'OK', res:tools.newConnection(req,result.value)});
				req.session.user = req.params.username;
				req.session.firstElem = 0;
			}
			else {
				res.send({status: 'NOK'});
			}
		});
		*/
		if(!req.query.hasOwnProperty('p')) {
			res.send({status: 'NOK'});
			return;
		}
		usersdb.get(req.params.username, function(err,result) {
			if(err) {
				res.send({status: 'NOK'});
			}
			else {
				var user = tools.skFromUser(req.query.p,result.value);
				if(user) {
					req.session.sk = user.sk;
					req.session.pk = user.pk;
					req.session.p = user.p;
					req.session.username = req.params.username;
					//console.log(user);

					res.send({status: 'OK',meta:result.value.meta?tools.decodeUserMeta(result.value.meta,req.session.p):{}});
					//console.log(req.session);
				}
				else {
					res.send({status: 'NOK'});
				}
			}
		});

		
	})
	.put('/login/:username', function(req, res){
		if(req.session.username !== req.params.username) {
			res.send({status: 'NOK'});
		}
		else {
			var request = tools.decodeRequest(req);
			usersdb.get(req.session.username, function(err,result) {
				result.value.p = request.p;
				usersdb.set(req.session.username, result.value, function(err, result) {
					if(!err) {
						res.send({status: 'OK'});
					}
					else {
						res.send({status: 'NOK'});
					}
				});
				
				
			});
		}
	})
	.post('/', function(req,res) {
		var request = tools.decodeRequest(req);
		var response = {message: 'Internal Error'};
		if(!request || !request.hasOwnProperty('req')) {
			response.message = 'Bad request';
			res.send(tools.encodeResponse(req,response));
		}
		else {
			switch(request.req) {
				case 'users' : 
					var users = new Object();
					usersdb.getMulti(request.users, {}, function(err, results) {
						for(var user in results) {
							if(results[user].hasOwnProperty('value')) {
								users[user] = {pk:results[user].value.pk};
							}
						}
						response.message = 'OK';
						response.users = users;
						res.send(tools.encodeResponse(req,response));
					});
					break;
				case 'inboxes':
				case 'sents':
					var limit = request.limit || 20;
					var firstElem = request.firstElem || 0;
					var folder = '';
					switch(request.req) {
						case 'inboxes':
							folder = 'inbox';
							break;
						case 'sents':
							folder = 'sent';
							break;
					}
					inboxes.query(
						{limit:limit,key:[req.session.username,folder],descending:true,skip:firstElem},
						function(err, results) {
							var keys = new Array();
							for(var id in results) {
								keys.push(results[id].id);
							}
							mailsdb.getMulti(keys, {}, function(err, results) {
								var inboxes = new Array();
								for(var id in results) {
									if(results[id].value) {
										results[id].value.id = id;
										delete(results[id].value.username);
										inboxes.push(results[id].value);
									}
								}
								response.message = 'OK';
								response.hasNext = keys.length === limit;
								response.hasPrevious = firstElem > 0;
								response.inboxes = inboxes;
								res.send(tools.encodeResponse(req,response));
							});
					});
					break;
				case 'toTrash':
					mailsdb.get(request.id, function(err, result) {
						result.value.folder = 'trash';
						mailsdb.set(request.id,result.value,function(err, result) {
							response.message = 'OK';
							res.send(tools.encodeResponse(req,response));
						});
					});
					break;
				case 'send':
					var mails = request.mails;
					var mailcomposer = new MailComposer();
					for(var id in mails) {
						if(mails[id].hasOwnProperty('username')) {
							if(mails[id].username === 'me') {
								mails[id].folder = 'sent';
								mails[id].username = req.session.username;
							}
							else {
								mails[id].folder = 'inbox';
							}
							
							mailsdb.set((+new Date).toString(36)+'-pmailInt',mails[id],
								function(err, result) {
									if(err) {
										console.log(err);
									}
								});
						}
						else {
							var mail = mails[id].body;
							var to = [];
							var from = [];
							for(var i in mail.to) {
								to.push(mail.to[i].address);
							}
							for(var i in mail.from) {
								from.push(mail.from[i].address+'@'+domains[0]);
							}
							var message = new MailComposer();
							message.setMessageOption({
								from: from.join(', '),
								to: to.join(', '),
								subject: mail.subject,
								text: mail.text,
								html: mail.html
							});
							mailPool.sendMail(message, function(error, responseObj) {
								console.log('Cannot send mail');
								console.log(error);
							});
						}
					}
					response.message = 'OK';
					res.send(tools.encodeResponse(req,response));
					break;
				case 'update' :
					usersdb.get(req.session.username, function(err,result) {
						result.value.p = request.p;
						usersdb.set(req.session.username, result.value, function(err, result) {
							response.message = err ? 'NOK' : 'OK';
							res.send(tools.encodeResponse(req,response));
						});
						
						
					});
					break;
			}
		}
	})
	.get('/inboxes', function(req, res){
		var params = {
			session: req.session,
			folder: 'inbox',
			limit: req.query.hasOwnProperty('limit') ? req.query.limit : 20,
			firstElem: req.query.hasOwnProperty('firstElem') ? req.query.firstElem : 0
		};
		tools.getMails(params, function(mails) {
			res.send({
				inboxes: mails,
				meta : {
					message : 'OK',
					hasNext : mails.length === params.limit,
					hasPrevious : params.firstElem > 0
				}
			});
		});

	})
	.get('/sents', function(req, res){
		var params = {
			session: req.session,
			folder: 'sent',
			limit: req.query.hasOwnProperty('limit') ? req.query.limit : 20,
			firstElem: req.query.hasOwnProperty('firstElem') ? req.query.firstElem : 0
		};
		tools.getMails(params, function(mails) {
			res.send(
			{
				sents: mails,
				meta : {
					message : 'OK',
					hasNext : mails.length === params.limit,
					hasPrevious : params.firstElem > 0
				}
			});
		});
		

	})
	.get('/trashes', function(req, res){
		var params = {
			session: req.session,
			folder: 'trash',
			limit: req.query.hasOwnProperty('limit') ? req.query.limit : 20,
			firstElem: req.query.hasOwnProperty('firstElem') ? req.query.firstElem : 0
		};
		tools.getMails(params, function(mails) {
			res.send(
			{
				sents: mails,
				meta : {
					message : 'OK',
					hasNext : mails.length === params.limit,
					hasPrevious : params.firstElem > 0
				}
			});
		});
		

	})
	.delete('/inboxes/:mailid', function(req, res){
		tools.deleteMail(req.params.mailid, function(result) {
			var params = {
				session: req.session,
				folder: 'inbox',
				limit: req.query.hasOwnProperty('limit') ? req.query.limit : 20,
				firstElem: req.query.hasOwnProperty('firstElem') ? req.query.firstElem : 0
			};
			tools.getMails(params, function(mails) {
				res.send(
				{
					inboxes: mails,
					meta : {
						message : 'OK',
						hasNext : mails.length === params.limit,
						hasPrevious : params.firstElem > 0
					}
				});
			});
		});
	})
	.delete('/sents/:mailid', function(req, res){
		tools.deleteMail(req.params.mailid, function(result) {
			var params = {
				session: req.session,
				folder: 'sent',
				limit: req.query.hasOwnProperty('limit') ? req.query.limit : 20,
				firstElem: req.query.hasOwnProperty('firstElem') ? req.query.firstElem : 0
			};
			tools.getMails(params, function(mails) {
				res.send(
				{
					sents: mails,
					meta : {
						message : 'OK',
						hasNext : mails.length === params.limit,
						hasPrevious : params.firstElem > 0
					}
				});
			});
		});
	})
	.post('/sents', function(req, res){
		var mail = req.body.sent;
		tools.sendpMail(mail,[req.session.username],req.session.pk,'sent', function(result) {
			res.send({
				sent:result,
				meta: {
					message: 'OK'
				}
			});
		});
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


		tools.sendpMail(mail,pMailTo,req.session.pk,'inbox',function(result) {
			
		});
		
	})
	.put('/update', function(req, res) {
		if(!req.body.meta) {
			res.send({status: 'NOK'});
			return;
		}
		usersdb.get(req.session.username, function(err,result) {
			if(err) {
				console.log(err);
				res.send({status: 'NOK'});
			}

			result.value.meta = tools.encodeUserMeta(req.body.meta,req.session.p);
			usersdb.set(req.session.username, result.value, function(err, result) {
				if(err)	res.send({status: 'NOK'});
				else res.send({status: 'OK'});
			});
		});
	})
	.use(express.static(__dirname + '/static'))
	.use(function(req, res, next){
		res.setHeader('Content-Type', 'text/html');
		res.send(404, '<html><head><title>404</title></head><body><h1>Page introuvable !</h1></body></html>');
	});

app.listen(8080);

