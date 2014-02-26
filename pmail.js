"use strict";
var express		= require('express');
var couchbase	= require('couchbase');
var tools 		= require('./pmail-tools');
var simplesmtp	= require('simplesmtp');
var MailComposer = require('mailcomposer').MailComposer;

var app 	= express();
var usersdb = new couchbase.Connection({host: 'localhost:8091', bucket: 'users'});
var mailsdb = new couchbase.Connection({host: 'localhost:8091', bucket: 'mails'});

var mailPool = simplesmtp.createClientPool(25);
var domains = ['pik.io'];

var inboxes = mailsdb.view('inboxes','by_username');

app.configure(function(){
	app
		.use(express.compress())
		.use(express.cookieParser())
		.use(express.session({secret: tools.randomSession(32)}))
		.use(express.json())
		.use(app.router);
});

app
	.get('/', function(req, res) {
	  res.redirect('/index.htm');
	})
	.post('/login/:username', function(req, res){
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
		
	})
	.get('/login/:username', function(req, res){
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
		
	})
	.put('/login/:username', function(req, res){
		if(req.session.user !== req.params.username) {
			res.send({status: 'NOK'});
		}
		else {
			var request = tools.decodeRequest(req);
			usersdb.get(req.session.user, function(err,result) {
				result.value.p = request.p;
				usersdb.set(req.session.user, result.value, function(err, result) {
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
				case 'inboxesNext':
				case 'inboxesPrev':
					var limit = request.limit || 20;
					if(request.req === 'inboxesNext') {
						req.session.firstElem += limit;
					}
					else if(request.req === 'inboxesPrev') {
						req.session.firstElem -= limit;
						if(req.session.firstElem < 0) req.session.firstElem = 0;
					}
					inboxes.query(
						{limit:limit,key:[req.session.user,'inbox'],descending:true,skip:req.session.firstElem},
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
								response.hasPrevious = req.session.firstElem > 0;
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
				case 'sents':
				case 'sentsNext':
				case 'sentsPrev':
					var limit = request.limit || 20;
					if(request.req === 'sentsNext') {
						req.session.firstElem += limit;
					}
					else if(request.req === 'sentsPrev') {
						req.session.firstElem -= limit;
						if(req.session.firstElem < 0) req.session.firstElem = 0;
					}
					inboxes.query(
						{limit:limit,key:[req.session.user,'sents'],descending:true,skip:req.session.firstElem},
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
								response.hasPrevious = req.session.firstElem > 0;
								response.inboxes = inboxes;
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
								mails[id].folder = 'sents';
								mails[id].username = req.session.user;
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
					usersdb.get(req.session.user, function(err,result) {
						result.value.p = request.p;
						usersdb.set(req.session.user, result.value, function(err, result) {
							response.message = err ? 'NOK' : 'OK';
							res.send(tools.encodeResponse(req,response));
						});
						
						
					});
					break;
			}
		}
	})
	.use(express.static(__dirname + '/static'))
	.use(function(req, res, next){
		res.setHeader('Content-Type', 'text/html');
		res.send(404, '<h1>Page introuvable !</h1>');
	});

app.listen(8080);

