'use strict';
window.PMail 	= Ember.Application.create();
PMail.searchindex	= null;
PMail.domain 	= 'pik.io';

//PMail.username 	= null;
//PMail.sk 		= null;
//PMail.pk 		= null;
//PMail.sessionNonce = null;
//PMail.sessionKey = null;
//PMail.k 		= null;

PMail.Router.map(function () {
  this.route('login');
  this.route('compose');
  this.route('profile');
  this.resource('inbox', function () {
  	this.route('mail', {path: '/:mail_id'});
  });
  this.resource('sent', function () {
  	this.route('mail', {path: '/:mail_id'});
  });
  this.resource('trash', function () {
  	this.route('mail', {path: '/:mail_id'});
  });
});


PMail.ApplicationController = Ember.ObjectController.extend({
	isLoggedIn: false,
	username: null,
	fullname: ''
});


PMail.LoginController = Ember.ObjectController.extend({
	needs: 'application',
	usernameBinding: 'controllers.application.username',
	fullnameBinding: 'controllers.application.fullname',
	isLoggedInBinding: 'controllers.application.isLoggedIn',
	password: null,
	repeat: null,
	isJoining: false,
	errorMessage: null,
	actions: {
		changeJoin : function() {
			this.set('isJoining',!this.get('isJoining'));
		}
	}
});

PMail.LoginRoute = Em.Route.extend({
	actions: {
		login: function(){
			var controller = this.get('controller');
			controller.set('errorMessage',null);
			var password = CryptoJS.SHA512(controller.get('password')).toString(CryptoJS.enc.Hex);

			Ember.$.ajax({
				url: '/login/'+controller.get('username'),
				type: 'GET',
				async: false,
				data: {
					p: password
				}
			}).done(function(res) {
				if(res.status === 'OK') {
					controller.set('isLoggedIn',true);
					if(res.hasOwnProperty('meta')) {
						controller.set('fullname', res.meta.fullname || '');
					}
				}
				else {
					controller.set('errorMessage','Bad password');
				}
			});

			if(controller.get('isLoggedIn')) {
				this.transitionTo('inbox');
			}
		},
		join: function(){
			var controller = this.get('controller');
			controller.set('errorMessage',null);
			var password = CryptoJS.SHA512(controller.get('password')).toString(CryptoJS.enc.Hex);
			Ember.$.ajax({
				url: '/login/'+controller.get('username'),
				type: 'POST',
				async: false,
				contentType: 'application/json',
				data: JSON.stringify({
					p: password
				})
			}).done(function(res) {
				if(res.status === 'OK') {
					controller.set('isLoggedIn',true);
				}
				else {
					controller.set('errorMessage','Bad password');
				}
			});

			if(controller.get('isLoggedIn')) {
				this.transitionTo('inbox');
			}

		}
	}
});

PMail.InboxRoute = Ember.Route.extend({
	beforeModel: function() {
		if(!this.controllerFor('application').get('isLoggedIn')) this.transitionTo('login');
		PMail.searchindex = lunr(function () {
		    this.field('subject', {boost: 3})
		    this.field('body'),
		    this.field('from'),
		    this.field('to'),
		    this.field('date'),
		    this.ref('id')
		});
	},
	model: function() {
		var controller = this.controllerFor('inbox');
		return this.store.find('inbox',{limit:controller.get('limit'),firstElem:controller.get('firstElem')});
	},
	actions: {
		search: function(evt) {
			var controller = this.get('controller');
			var searchTXT = controller.get('searchTXT');
			if((!searchTXT) || (searchTXT === '')) {
				controller.set('model',this.store.all('inbox'));
				return;
			}
			var inbox = this.store.all('inbox');
			var founds = [];
			PMail.searchindex.search(searchTXT).forEach(function(res) {
				founds.push(res.ref);
			});
			inbox.forEach(function(mail) {
				if($.inArray(mail.id,founds)>-1) {
					mail.set('visible', true);
				}
				else {
					mail.set('visible', false);
				}
			});
			this.get('controller').set('model',inbox.filterBy('visible',true));
		}
	}
});

PMail.InboxSerializer = DS.RESTSerializer.extend({
	/*
	normalizePayload: function(type, payload) {
		var controller = this.get('controller');
		

	}
	*/
});

PMail.InboxController = Ember.ArrayController.extend({
	searchTXT: 	null,
	hasNext: 	false,
	hasPrevious:false,
	limit: 		10,
	firstElem: 	0,
	actions: {
		delete: function(mail) {
			if(!mail.hasOwnProperty('id')) return;
			mail.destroyRecord();
		},
		nextPage: function(event) {
			if(!this.get('hasNext')) return;
			var controller = this;
			var limit = controller.get('limit');
			var firstElem = controller.get('firstElem') + limit;
			controller.set('firstElem', firstElem);
			sendRequest('inboxes', {limit:limit,firstElem:firstElem})
			.then(function(mails) {
				decodeMail(mails.inboxes);
				controller.set('hasPrevious',true);
				if(mails.hasOwnProperty('hasNext')) {
					controller.set('hasNext', mails.hasNext?true:false);
				}
				controller.set('model',mails.inboxes);
			});
		},
		prevPage: function(event) {
			if(!this.get('hasPrevious')) return;
			var controller = this;
			var limit = controller.get('limit');
			var firstElem = controller.get('firstElem') - limit;
			controller.set('firstElem', firstElem);
			sendRequest('inboxes', {limit:limit,firstElem:firstElem})
			.then(function(mails) {
				decodeMail(mails.inboxes);
				controller.set('hasNext',true);
				if(mails.hasOwnProperty('hasPrevious')) {
					controller.set('hasPrevious', mails.hasPrevious?true:false);
				}
				controller.set('model',mails.inboxes);
			});		
		}
	}
});

PMail.InboxMailRoute = Em.Route.extend({
	beforeModel: function() {
		if(!this.controllerFor('application').get('isLoggedIn')) this.transitionTo('login');
	},
	model: function(params) {
		return this.store.find('inbox',params.mail_id);
	}
});

PMail.InboxMailController = Ember.ObjectController.extend({
	actions: {
		reply: function() {
			var from = this.get('model.from');
			var subject = this.get('model.subject');
			var body = this.get('model.text');			

			PMail.composeMail = {
				to: from[0].address,
				subject: /^re:(.*)/i.exec(subject) ? subject : "Re: "+subject,
				body: "<br><hr>"+from[0].address+" wrote:<div>"+body+"</div>"
			};
			this.transitionToRoute('compose');
		},
		replyAll: function() {
			var to = [this.get('model.from')[0].address];
			var from = this.get('model.from');
			var subject = this.get('model.subject');
			var body = this.get('model.text');	
			var _to = this.get('model.to');
			for(var i in _to) {
				if(_to.hasOwnProperty(i)) {
					var address = _to[i].address;
					if(to.indexOf(address) === -1) {
						to.push(address)
					}
				}
			}
			to = to.join(', ');		

			PMail.composeMail = {
				to: to,
				subject: /^re:(.*)/i.exec(subject) ? subject : "Re: "+subject,
				body: "<br><hr>"+from[0].address+" wrote:<div>"+body+"</div>"
			};
			this.transitionToRoute('compose');

		},
		forward: function() {
			var from = this.get('model.from');
			var subject = this.get('model.subject');
			var body = this.get('model.text');			

			PMail.composeMail = {
				to: '',
				subject: /^fw:(.*)/i.exec(subject) ? subject : "Fw: "+subject,
				body: "<br><hr>"+from[0].address+" wrote:<div>"+body+"</div>"
			};
			this.transitionToRoute('compose');
		}
	}
});

PMail.SentRoute = Em.Route.extend({
	beforeModel: function() {
		if(!this.controllerFor('application').get('isLoggedIn')) this.transitionTo('login');
	},
	model: function() {
		var controller = this.controllerFor('sent');
		return this.store.find('sent',{limit:controller.get('limit'),firstElem:controller.get('firstElem')});
	}
});

PMail.SentController = Ember.ArrayController.extend({
	searchTXT: 	null,
	hasNext: 	false,
	hasPrevious:false,
	limit: 		10,
	firstElem: 	0,
	actions: {
		delete: function(mail) {
			if(!mail.hasOwnProperty('id')) return;
			mail.destroyRecord();
		},
		nextPage: function(event) {
			if(!this.get('hasNext')) return;
			var controller = this;
			var limit = controller.get('limit');
			var firstElem = controller.get('firstElem') + limit;
			controller.set('firstElem', firstElem);
			sendRequest('sents', {limit:limit,firstElem:firstElem})
			.then(function(mails) {
				decodeMail(mails.inboxes);
				controller.set('hasPrevious',true);
				if(mails.hasOwnProperty('hasNext')) {
					controller.set('hasNext', mails.hasNext?true:false);
				}
				controller.set('model',mails.inboxes);
			});
		},
		prevPage: function(event) {
			if(!this.get('hasPrevious')) return;
			var controller = this;
			var limit = controller.get('limit');
			var firstElem = controller.get('firstElem') - limit;
			controller.set('firstElem', firstElem);
			sendRequest('sents', {limit:limit,firstElem:firstElem})
			.then(function(mails) {
				decodeMail(mails.inboxes);
				controller.set('hasNext',true);
				if(mails.hasOwnProperty('hasPrevious')) {
					controller.set('hasPrevious', mails.hasPrevious?true:false);
				}
				controller.set('model',mails.inboxes);
			});		
		}
	}
});

PMail.SentMailRoute = Em.Route.extend({
	beforeModel: function() {
		if(!this.controllerFor('application').get('isLoggedIn')) this.transitionTo('login');
	}
});

Ember.Handlebars.helper('maillist', function(value, options) {
	return PMail.recipentListToString(value) || 'Unknown';
});

Ember.Handlebars.helper('truncate', function(value, options) {
	return ((typeof value === 'string') && value.length > 23) ? value.slice(0,20)+"...":value;
});

PMail.ComposeRoute = Em.Route.extend({
	beforeModel: function() {
		if(!this.controllerFor('application').get('isLoggedIn')) this.transitionTo('login');
	},
	model: function() {
		var model = Ember.Object.create({
			to: '',
			subject: '',
			body: ''
		});
		if(PMail.hasOwnProperty('composeMail')) {
			model.setProperties({
				to: PMail.composeMail.to || '',
				subject: PMail.composeMail.subject || '',
				body: PMail.composeMail.body || ''
			});
			delete PMail.composeMail;
		}
		return model;
	}
});

PMail.ComposeView = Ember.View.extend({
	didInsertElement: function() {
		Ember.$('#inputBody').val(this.get('controller.model.body')).cleditor();
        Ember.$('#inputTo').focus();
	}
});

PMail.ComposeController = Ember.ObjectController.extend({
	needs: 'application',
	usernameBinding: 'controllers.application.username',
	fullnameBinding: 'controllers.application.fullname',
	toInError: false,
	actions: {
		send: function(evt) {
			var controller = this;
			controller.set('toInError', false);
			var to = controller.get('model.to');
			if(to && to.length > 0 && /^[\040-\176]*$/.test(to)) {
				to = to.split(',');
				for(var i = 0; i<to.length; i++) {
					to[i] = {address:to[i].trim()};
				}
				var body = Ember.$('#inputBody').cleditor()[0].doc.body;
				controller.store.createRecord('sent', {
					to:to,
					from:[{name:controller.get('fullname'),address:controller.get('username')}],
					subject:controller.get('model.subject'),
					text:body.textContent,
					html:body.innerHTML
				}).save().then(function(mail) {
					controller.transitionToRoute('sent');
				});
			}
			else {
				controller.set('toInError', true);
			}
		}
	}
});

PMail.ProfileController = Ember.ObjectController.extend({
	needs: 'application',
	fullnameBinding: 'controllers.application.fullname',
	actions: {
		send: function(evt) {
			var fullname = this.get('fullname');
			if(fullname && fullname.length > 2) {
				Ember.$.ajax({
					url: '/update',
					type: 'PUT',
					async: false,
					contentType: 'application/json',
					data: JSON.stringify({
						meta: {
							fullname : fullname
						}
					})
				})
				.done(function(result) {
					if(result.status === 'OK') {
						
					}
				});
			}
		}
	}
});

PMail.ProfileRoute = Em.Route.extend({
	beforeModel: function() {
		if(!this.controllerFor('application').get('isLoggedIn')) this.transitionTo('login');
	}
});

PMail.recipentListToString = function(list) {
	if(!list || !$.isArray(list)) return null;
	var rlist = (list[0].name || '') + ' <' + list[0].address + '>';
	if(list.length > 1) {
		list.slice(1).forEach(function(val) {
			rlist += ',' + (val.name || '') + ' <' + val.address + '>';
		});

	}
	return rlist;
}

PMail.ClearSearchView = Ember.View.extend({
	tagName: 'span',
	classNames: ['input-icon', 'fui-cross'],
	click: function(event) {
		var controller = this.get('controller');
		controller.set('searchTXT','');
		controller.set('model',controller.store.all('inbox'));
	}
});

PMail.Inbox = DS.Model.extend({
	text: DS.attr(),
	html: DS.attr(),
	subject: DS.attr(),
	from: DS.attr(),
	to: DS.attr(),
	date: DS.attr('date'),
	visible: DS.attr('boolean')
});

PMail.Sent = DS.Model.extend({
	text: DS.attr(),
	html: DS.attr(),
	subject: DS.attr(),
	from: DS.attr(),
	to: DS.attr(),
	date: DS.attr('date'),
	visible: DS.attr('boolean')
});
