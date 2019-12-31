Module.register("MMM-SteamPlaytime",{
	defaults: {
		apiKey: null,
		steamId: null,
		updateTime: "00:00",
		displayCount: 5,
		language: config.language,
		emptyText: "none"
	},

	start: function() {
		var self = this;

		moment.locale(self.config.language);

		self.sendSocketNotification("CONFIG", self.config);
	},

	notificationReceived: function(notification, payload, sender) {

	},

	getScripts: function() {
		return ["moment.js"];
	},

	getStyles: function() {
		return ["MMM-SteamPlaytime.css"];
	},

	getTemplate: function () {
		return "MMM-SteamPlaytime.njk";
	},

	getTemplateData: function () {
		var self = this;
		return {
			formatDay: self.formatDay,
			formatTime: self.formatTime,
			playtime: self.data.playtime,
			emptyText: self.config.emptyText
		}
	},

	socketNotificationReceived: function (notification, payload) {
		var self = this;
		if (notification == "PLAYTIME" && payload.steamId == self.config.steamId) {
			self.data = payload;
			self.updateDom();
		} else if (notification == "PLAYTIME_UPDATE_ERROR") {
			this.sendNotification("SHOW_ALERT", { 
				title : this.name + ": Update Error",
				message : payload
			});
		}
	},

	formatDay: function(date) { 
		return moment(date).format('ddd'); 
	},

	formatTime: function(minutes) {
		var now = moment();
		var other = moment().subtract(minutes, "minutes");
		return now.from(other, true);
	}
});
