window.PMail 	= Ember.Application.create();
PMail.searchindex	= null;

PMail.serverPk 	= new Uint8Array([176, 198, 150, 232, 87, 89, 72, 75, 206, 71, 27, 189, 209, 72, 184, 102, 41, 157, 252, 208, 107, 67, 140, 223, 246, 177, 115, 176, 199, 254, 19, 84]);
PMail.username 	= null;
PMail.sk 		= null;
PMail.sessionNonce = null;
PMail.sessionKey = null;

PMail.Router.map(function () {
  this.route('login');
  this.route('compose');
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
	actions: {
		newMail: function() {
			this.store.createRecord('sent',{subject:'hihihi'});
		}
	}
});


PMail.LoginController = Ember.ObjectController.extend({
	needs: 'application',
	username: null,
	password: null,
	repeat: null,
	isJoining: false,
	errorMessage: null,
	isLoggedIn: Ember.computed.alias('controllers.application.isLoggedIn'),
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
			var retVal = loginUser(controller.get('username'),controller.get('password'));
			if(retVal && retVal.sk && retVal.sessionKey) {
				PMail.username = controller.get('username');
				PMail.sk = retVal.sk;
				PMail.sessionNonce = retVal.sessionNonce;
				PMail.sessionKey = retVal.sessionKey;
				controller.set('isLoggedIn',true);
				this.transitionTo('inbox');
			}
			else {
				controller.set('errorMessage','Bad password');
			}

		},
		join: function(){
			var controller = this.get('controller');
			controller.set('errorMessage',null);
			if(controller.get('password') !== controller.get('repeat')) {
				controller.set('errorMessage','Passwords do not match !');
				return;
			}
			var retVal = joinUser(controller.get('username'),controller.get('password'));
			if(retVal && retVal.pk && retVal.sk && retVal.serverPk) {
				PMail.username = controller.get('username');
				PMail.serverPk = retVal.serverPk;
				PMail.pk = retVal.pk;
				PMail.sk = retVal.sk;
				controller.set('isLoggedIn',true);
				this.transitionTo('inbox');
			}
			else {
				controller.set('errorMessage','Cannot create that account');
			}

		}
	}
});

PMail.InboxRoute = Em.Route.extend({
	beforeModel: function() {
		if(!PMail.sk) this.transitionTo('login');
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
		return this.store.find('inbox',{req:encodeRequest({limit:10,username:PMail.username})});
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

PMail.InboxController = Ember.ArrayController.extend({
	searchTXT:null
});

PMail.InboxSerializer = DS.RESTSerializer.extend({
	normalizePayload: function(type, payload) {
		var mails = decodeResponse(payload);
		decodeMail(mails.inboxes);
		return mails;
	}

});

PMail.InboxMailRoute = Em.Route.extend({
	beforeModel: function() {
		if(!PMail.sk) this.transitionTo('login');
	},
	model: function(params) {
		return this.store.find('inbox',params.mail_id);
	}
});

PMail.SentRoute = Em.Route.extend({
	model: function() {
		return this.store.find('sent',{limit:10,username:PMail.username});
	},
});

Ember.Handlebars.helper('maillist', function(value, options) {
	return PMail.recipentListToString(value) || 'Unknown';
});

PMail.ComposeRoute = Em.Route.extend({
	beforeModel: function() {
		if(!PMail.sk) this.transitionTo('login');
	},
});

PMail.ComposeController = Ember.ObjectController.extend({
	to: null,
	subject: null,
	body: null,
	toInError: false,
	actions: {
		send: function(evt) {
			this.set('toInError', false);
			var to = this.get('to');
			if(to && to.length > 0) {
				to = to.split(',');
				for(var i = 0; i<to.length; i++) {
					to[i] = {address:to[i].trim()};
				}

				newMail({
					to:to,
					from:[{address:PMail.username}],
					subject:this.get('subject'),
					text:this.get('body')
				});
			}
			else {
				this.set('toInError', true);
			}
		}
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
	body: DS.attr(),
	subject: DS.attr(),
	from: DS.attr(),
	to: DS.attr(),
	date: DS.attr('date'),
	visible: DS.attr('boolean')
});

PMail.Sent = DS.Model.extend({
	body: DS.attr(),
	subject: DS.attr(),
	from: DS.attr(),
	to: DS.attr(),
	date: DS.attr('date'),
	visible: DS.attr('boolean')
});
