Module.register("MMM-SteamPlaytime",{
	defaults: {
		apiKey: null,
		steamId: null,
		updateTime: "00:00",
		daysCount: 5,
		gamesCount: 5,
		excludeGames: [],
		language: config.language
	},

	start: function() {
		var self = this;
		self.templateData = {};

		moment.locale(self.config.language);

		self.sendSocketNotification("CONFIG", self.config);
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

	getTranslations: function() {
		return {
				sv: "translations/sv.json",
				en: "translations/en.json"
		};
	},

	getTemplateData: function () {
		var self = this;
		return {
			formatDay: self.formatDay,
			formatTime: self.formatTime,
			playtime: self.templateData.playtime,
			tracking: self.translate("PLAYTIME_TRACKING", {"days" : "" + self.templateData.days, "games" : "" + self.templateData.games})
		}
	},

	socketNotificationReceived: function (notification, payload) {
		var self = this;
		if (notification == "PLAYTIME" && payload.steamId == self.config.steamId) {
			self.templateData = payload;
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
