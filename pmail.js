'use strict';
var express		= require('express');
//var MemcachedStore = require('connect-memcached')(express);
var tools 		= require('./pmail-tools');
var app 		= express();

//var domains = ['pik.io'];


app.configure(function(){
	app
		.use(express.favicon())
		.use(express.compress())
		.use(express.cookieParser(tools.randomSession(32)))
		//.use(express.session({
		//	secret: tools.randomSession(32),
		//	store: new MemcachedStore({
		//		hosts: [ '127.0.0.1:11211' ]
		//	})
		//}))
		//.use(express.session({secret: tools.randomSession(32)}))
		.use(express.cookieSession())
		.use(express.json())
		.use(app.router);
});

app
	.get('/', function(req, res) {
	  res.redirect('/index.htm');
	})
	.post('/login/:username', function(req, res){
		if((req.params.username.length < 3) || !req.body.hasOwnProperty('p')) {
			res.send({status: 'NOK'});
			return;
		}
		tools.newUser(req.params.username,req.body.p,function(err,user) {
			if(err) {
				res.send({status: 'NOK'});
			}
			else {
				req.session.user = user;
				res.send({status: 'OK'});
			}			
		});
	})
	.get('/login/:username', function(req, res){
		if(!req.query.hasOwnProperty('p')) {
			res.send({status: 'NOK'});
			return;
		}
		tools.loadUser(req.params.username,req.query.p,function(err,user) {
			if(err) {
				res.send({status: 'NOK'});
			}
			else {
				req.session.user = user;
				res.send({status: 'OK'});	
			}		
		});

		
	})
	.put('/login/:username', function(req, res){
		if(!(req.session.user && (req.session.user.username === req.session.username))) {
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
	.get('/inboxes', function(req, res){
		if(req.session.user) {
			var params = {
				folder: 'inbox',
				limit: req.query.hasOwnProperty('limit') ? req.query.limit : 20,
				firstElem: req.query.hasOwnProperty('firstElem') ? req.query.firstElem : 0
			};
			tools.getMails(req.session.user,params,function(err,mails) {
				if(err) {
					res.send({
						inboxes: [],
						meta : {
							status: 'NOK'
						}
					});
				}
				else {
					res.send({
						inboxes: mails,
						meta : {
							message : 'OK',
							hasNext : mails.length === params.limit,
							hasPrevious : params.firstElem > 0
						}
					});
				}
			});
		}

	})
	.get('/sents', function(req, res){
		if(req.session.user) {
			var params = {
				folder: 'sent',
				limit: req.query.hasOwnProperty('limit') ? req.query.limit : 20,
				firstElem: req.query.hasOwnProperty('firstElem') ? req.query.firstElem : 0
			};
			tools.getMails(req.session.user,params,function(err,mails) {
				if(err) {
					res.send({
						sents: [],
						meta : {
							status: 'NOK'
						}
					});
				}
				else {
					res.send({
						sents: mails,
						meta : {
							message : 'OK',
							hasNext : mails.length === params.limit,
							hasPrevious : params.firstElem > 0
						}
					});
				}
			});
		}

	})
	.get('/trashes', function(req, res){
		if(req.session.user) {
			var params = {
				folder: 'trash',
				limit: req.query.hasOwnProperty('limit') ? req.query.limit : 20,
				firstElem: req.query.hasOwnProperty('firstElem') ? req.query.firstElem : 0
			};
			req.session.user.getMails(params, function(err,mails) {
				if(err) {
					res.send({
						trashes: [],
						meta : {
							status: 'NOK'
						}
					});
				}
				else {
					res.send({
						trashes: mails,
						meta : {
							message : 'OK',
							hasNext : mails.length === params.limit,
							hasPrevious : params.firstElem > 0
						}
					});
				}
			});
		}

	})
	.delete('/inboxes/:mailid', function(req, res){
		if(req.session.user) {
			tools.deleteMail(req.params.mailid, function(err) {
				if(!err) {
					var params = {
						folder: 'inbox',
						limit: req.query.hasOwnProperty('limit') ? req.query.limit : 20,
						firstElem: req.query.hasOwnProperty('firstElem') ? req.query.firstElem : 0
					};
					tools.getMails(req.session.user,params,function(err,mails) {
						if(err) {
							res.send({
								inboxes: [],
								meta : {
									status: 'NOK'
								}
							});
						}
						else {
							res.send({
								inboxes: mails,
								meta : {
									message : 'OK',
									hasNext : mails.length === params.limit,
									hasPrevious : params.firstElem > 0
								}
							});
						}
					});
				}
			});
		}
	})
	.delete('/sents/:mailid', function(req, res){
		if(req.session.user) {
			tools.deleteMail(req.params.mailid, function(err) {
				if(!err) {
					var params = {
						folder: 'sent',
						limit: req.query.hasOwnProperty('limit') ? req.query.limit : 20,
						firstElem: req.query.hasOwnProperty('firstElem') ? req.query.firstElem : 0
					};
					tools.getMails(req.session.user,params,function(err,mails) {
						if(err) {
							res.send({
								sents: [],
								meta : {
									status: 'NOK'
								}
							});
						}
						else {
							res.send({
								sents: mails,
								meta : {
									message : 'OK',
									hasNext : mails.length === params.limit,
									hasPrevious : params.firstElem > 0
								}
							});
						}
					});
				}
			});
		}
	})
	.delete('/trashes/:mailid', function(req, res){
		if(req.session.user) {
			tools.deleteMail(req.params.mailid, function(err) {
				if(!err) {
					var params = {
						folder: 'trash',
						limit: req.query.hasOwnProperty('limit') ? req.query.limit : 20,
						firstElem: req.query.hasOwnProperty('firstElem') ? req.query.firstElem : 0
					};
					req.session.user.getMails(params, function(err,mails) {
						if(err) {
							res.send({
								trashes: [],
								meta : {
									status: 'NOK'
								}
							});
						}
						else {
							res.send({
								trashes: mails,
								meta : {
									message : 'OK',
									hasNext : mails.length === params.limit,
									hasPrevious : params.firstElem > 0
								}
							});
						}
					});
				}
			});
		}
	})
	.post('/sents', function(req, res){
		if(req.session.user) {
			tools.sendMail(req.session.user,req.body.sent, function(err,result) {
				if(err) {
					res.send({
						sent:[],
						meta: {
							message: 'KO'
						}
					});
				}
				else {
					res.send({
						sent:result,
						meta: {
							message: 'OK'
						}
					});
				}
			});
		}		
	})
	.put('/update', function(req, res) {
		if(req.session.user && req.body.meta) {
			tools.updateUser(req.session.user,req.body.meta, function(err) {
				if(err) {
					res.send({status: 'NOK'});
				}
				else {
					res.send({status: 'OK'});
				}
			});
		}
	})
	.use(express.static(__dirname + '/static'))
	.use(function(req, res, next){
		res.setHeader('Content-Type', 'text/html');
		res.send(404, '<html><head><title>404</title></head><body><h1>Page introuvable !</h1></body></html>');
	});

app.listen(8080);

