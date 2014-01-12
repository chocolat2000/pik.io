var express		= require('express');
var couchbase	= require('couchbase');
var tools 		= require('./pmail-tools');


var app 	= express();
var usersdb = new couchbase.Connection({host: 'localhost:8091', bucket: 'users'});
var mailsdb = new couchbase.Connection({host: 'localhost:8091', bucket: 'mails'});

var inboxes = mailsdb.view('inboxes','by_username');

app.configure(function(){
	app
		.use(express.compress())
		.use(express.cookieParser())
		.use(express.session({secret: "ca3fbe06fe2c244056dc3788341bd4148009a28b30b65aaa1655f246227a2619"}))
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
			}
			else {
				res.send({status: 'NOK'});
			}
		});
		
	})
	.get('/users', function(req, res) {
		var request = tools.decodeRequest(req);
		if(!request || !request.hasOwnProperty('users')) {
			res.send(tools.encodeResponse(req,{users: new Array()}));
		}
		else {
			var users = new Object();
			usersdb.getMulti(request.users, {}, function(err, results) {
				for(user in results) {
					if(results[user].hasOwnProperty('value')) {
						users[user] = {pk:results[user].value.pk};
					}
				}
				res.send(tools.encodeResponse(req,{users: users}));
			});
		}
	})
	.get('/inboxes', function(req, res) {
		var request = tools.decodeRequest(req);
		if(!request || !request.hasOwnProperty('username')) {
			res.send({inboxes: new Array()});
			return;
		}
		var limit = request.limit || 20;
		inboxes.query({limit:limit,key:[request.username,'inbox'],descending:true}, function(err, results) {
			var keys = new Array();
			for(id in results) {
				keys.push(results[id].id);
			}
			mailsdb.getMulti(keys, {}, function(err, results) {
				var inboxes = {inboxes: new Array()};
				for(id in results) {
					if(results[id].value) {
						results[id].value.id = id;
						delete(results[id].value.username);
						inboxes.inboxes.push(results[id].value);
					}
				}
				res.send(tools.encodeResponse(req,inboxes));
			});
		});
	})
	.get('/sents', function(req, res) {
		var request = tools.decodeRequest(req);
		if(!request || !request.hasOwnProperty('username')) {
			res.send({sents: new Array()});
			return;
		}
		var limit = request.limit || 20;
		inboxes.query({limit:limit,key:[request.username,'sent'],descending:true}, function(err, results) {
			var keys = new Array();
			for(id in results) {
				keys.push(results[id].id);
			}
			mailsdb.getMulti(keys, {}, function(err, results) {
				var sents = {sents: new Array()};
				for(id in results) {
					if(results[id].value) {
						results[id].value.id = id;
						sents.sents.push(results[id].value);
					}
				}
				res.send(tools.encodeResponse(req,sents));
			});
		});
	})
	.post('/send', function(req, res) {
		if(!req.body) {
			res.send(400,'failed');
		}
		else {
			res.send({status: 'OK'});
			
			var mails = tools.decodeRequest(req).mails;
			for(id in mails) {
				mails[id].folder = 'inbox';
				mailsdb.set((+new Date).toString(36)+'-pmailInt',mails[id],
					function(err, result) {
						if(err) {
							console.log(err);
						}
					});

			}
		}
	})
	.use(express.static(__dirname + '/static'))
	.use(function(req, res, next){
		res.setHeader('Content-Type', 'text/html');
		res.send(404, '<h1>Page introuvable !</h1>');
	});

app.listen(8080);

