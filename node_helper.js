const NodeHelper = require("node_helper");
const request = require("request");
const moment = require("moment");
const path = require("path");
const fs = require("fs");

module.exports = NodeHelper.create({
	configured: false,

	start: function() {},

	socketNotificationReceived: function(notification, payload) {
		var self = this;
		if (notification == "CONFIG") {
			var dataFolder = path.resolve(__dirname, "data", payload.steamId);
			if (!self.configured) {
				if (!fs.existsSync(dataFolder)) {
					fs.mkdirSync(dataFolder, { recursive: true }, function(err) {
						console.log("Failed to create directory " + dataFolder);
					});
				}

				var callback = function() {
					self.updateData(dataFolder, payload.apiKey, payload.steamId);

					var data = self.loadCachedData(dataFolder);
					self.sendResult(data, payload.steamId, payload.displayCount);

					self.scheduleNextUpdate(payload.updateTime, callback);
				};
				self.scheduleNextUpdate(payload.updateTime, callback);

				self.configured = true;
			}

			var data = self.loadCachedData(dataFolder);
			self.sendResult(data, payload.steamId, payload.displayCount);
		}
	},

	scheduleNextUpdate: function(updateTime, callback) {
		var self = this;
		var date = self.calculateNextUpdate(updateTime);
		var timeout = date.valueOf() - moment().valueOf();

		console.log("Next update at " + date.format("YYYY-MM-DD HH:mm:ss"));

		setTimeout(function() {
			callback();
		}, timeout);
	},

	loadCachedData: function(dataFolder) {
		var data = {};
		fs.readdirSync(dataFolder).forEach(function(file) {
			var json = JSON.parse(fs.readFileSync(path.resolve(dataFolder, file)));
			json.response.games.forEach(function(game) {
				if (!(game.appid in data)) {
					data[game.appid] = {
						icon: "http://media.steampowered.com/steamcommunity/public/images/apps/" + game.appid + "/" + game.img_icon_url + ".jpg",
						total: {},
						recently: {}
					}
				}
				data[game.appid].total[json.date] = game.playtime_forever;
				data[game.appid].recently[json.date] = game.playtime_2weeks;
			});
		});

		return data;
	},

	sendResult: function(data, steamId, count) {
		var self = this;

		let calculator = new PlaytimeCalculator(data, self.key);
		let result = self.buildResult(calculator, count);
		
		self.sendSocketNotification("PLAYTIME", {
			playtime : result,
			steamId : steamId
		});
	},

	buildResult: function(calculator, count) {
		var self = this;
		var result = {};
		var date = moment().subtract(1, "days").startOf("day");

		for (var i = 0; i < count; i++) {
			var previousDate = date.clone().subtract(1, 'days');
			result[self.key(date)] = calculator.getAllPlaytime(date, previousDate);
			date = previousDate;
		}
		return result;
	},

	updateData: function(dataFolder, apiKey, steamId) {
		var self = this;
		request({
			url : "http://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?key=" + apiKey + "&steamid=" + steamId + "&format=json",
			method : "GET",
			gzip : true,
			headers : {
				"User-Agent" : "MagicMirror/MMM-SteamPlaytime/1.0; (https://github.com/buxxi/MMM-SteamPlaytime)"
			}
		}, function(error, response, body) {
			if (!error && response.statusCode == 200) {
				var forDate = self.key(moment().subtract(1, 'days'));
				var fileName = forDate + ".json";
				
				var data = JSON.parse(body);
				data.date = forDate;

				fs.writeFile(path.resolve(dataFolder, fileName), JSON.stringify(data), function(err) {
					if (err) {
						self.sendSocketNotification("PLAYTIME_UPDATE_ERROR", "Could not write file " + path.resolve(dataFolder, fileName));						
					} else {
						console.log(path.resolve(dataFolder, fileName) + " written");
					}
				});
			} else {
				self.sendSocketNotification("PLAYTIME_UPDATE_ERROR", "Got status code " + response.statusCode + " from API");
			}
		});   
	},

	key: function(date) {
		return date.format("YYYY-MM-DD");
	},

	calculateNextUpdate(updateTime) {
		var date = moment();

		updateTime = updateTime.split(":").map(function(e) { return parseInt(e)});
		date.set({
			hour: updateTime[0],
			minute: updateTime[1],
			second: 0
		});

		if (date.isSameOrBefore(moment())) {
			date.add(1, 'day');
		}
		return date;
	}
});

class PlaytimeCalculator {
	constructor(data, dateKeyFormatter) {
		this.data = data;
		this.dateKeyFormatter = dateKeyFormatter;
		this.firstDate = this.getFirstDate(data);
	}

	getAllPlaytime(date, previousDate) {
		var result = {};
		for (let appid in this.data) {
			var time = 0;
			if (this.startedToPlay(appid, date, previousDate)) {
				time = this.data[appid].recently[self.key(date)];
			} else {
				let dateTotalTime = this.getGameTotalTime(appid, date);
				let previousDateTotalTime = this.getGameTotalTime(appid, previousDate);
				time = dateTotalTime - previousDateTotalTime;
			}
			if (time !== 0) {
				result[appid] = {
					icon: this.data[appid].icon,
					time: time
				}
			}
		}
		return result;
	}


	startedToPlay(appid, date, previousDate) {
		let key = this.dateKeyFormatter(date);
		let previousKey = this.dateKeyFormatter(previousDate);
		
		if (date.isSame(this.firstDate)) {
			return false;
		}

		return (key in this.data[appid].recently && !(previousKey in this.data[appid].recently));
	}

	getGameTotalTime(appid, date, defaultValue) {
		let key = this.dateKeyFormatter(date);
		if (key in this.data[appid].total) {
			return this.data[appid].total[key];	
		}

		if (!isNaN(defaultValue)) {
			return defaultValue;
		}
		
		if (date.isAfter(this.firstDate)) {
			return this.getGameTotalTime(appid, date.clone().subtract(1, 'days'));
		} else {
			return this.getGameTotalTime(appid, this.firstDate, 0);
		}
	}

	getFirstDate() {
		return moment.min(Object.values(this.data).flatMap(function(e) { 
			return Object.keys(e.total); 
		}).map(
			function(e) { 
				return moment(e);
			}
		));
	}
}
