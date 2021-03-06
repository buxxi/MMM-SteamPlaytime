const NodeHelper = require("node_helper");
const fetch = require("node-fetch");
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
					self.updateData(dataFolder, payload.apiKey, payload.steamId).then(() => {
						let data = self.loadCachedData(dataFolder, payload.excludeGames);

						self.sendResult(data, payload.steamId, payload.daysCount, payload.gamesCount);
						self.scheduleNextUpdate(payload.updateTime, callback);
					});
				};
				self.scheduleNextUpdate(payload.updateTime, callback);

				self.configured = true;
			}

			var data = self.loadCachedData(dataFolder, payload.excludeGames);
			self.sendResult(data, payload.steamId, payload.daysCount, payload.gamesCount);
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

	loadCachedData: function(dataFolder, excludeAppIds) {
		var data = {};
		fs.readdirSync(dataFolder).forEach(function(file) {
			try {
				var json = JSON.parse(fs.readFileSync(path.resolve(dataFolder, file)));
				json.response.games.forEach(function(game) {
					if (excludeAppIds.indexOf(game.appid) >= 0) {
						return;
					}
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
			} catch (e) {
				console.log("Could not load data from " + file + ", error: " + e);
			}
		});

		return data;
	},

	sendResult: function(data, steamId, daysCount, gamesCount) {
		var self = this;

		let calculator = new PlaytimeCalculator(data, self.key);
		let result = self.buildResult(calculator, daysCount, gamesCount);
		
		self.sendSocketNotification("PLAYTIME", {
			playtime : result,
			steamId : steamId,
			days : calculator.getUniqueDaysCount(),
			games : calculator.getUniqueGamesCount()
		});
	},

	buildResult: function(calculator, daysCount, gamesCount) {
		var self = this;
		var result = {};
		var date = moment().subtract(1, "days").startOf("day");

		for (var i = 0; i < daysCount; i++) {
			var previousDate = date.clone().subtract(1, 'days');
			result[self.key(date)] = calculator.getAllPlaytime(date, previousDate, gamesCount);
			date = previousDate;
		}

		return result;
	},

	updateData: function(dataFolder, apiKey, steamId) {
		let self = this;
		return fetch("http://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?key=" + apiKey + "&steamid=" + steamId + "&format=json",
			{
			method : "GET",
			headers : {
				"User-Agent" : "MagicMirror/MMM-SteamPlaytime/1.0; (https://github.com/buxxi/MMM-SteamPlaytime)"
			}
		}).then(response => {
			if (response.status != 200) {
				throw new Error(response.status + ": " + response.statusText);
			}
			return response.json();
		}).then(data => {
			let forDate = self.key(moment().subtract(1, 'days'));
			let fileName = forDate + ".json";
			
			data.date = forDate;
			
			fs.writeFileSync(path.resolve(dataFolder, fileName), JSON.stringify(data), function(err) {
				if (err) {
					self.sendSocketNotification("PLAYTIME_UPDATE_ERROR", "Could not write file " + path.resolve(dataFolder, fileName));						
				} else {
					console.log(path.resolve(dataFolder, fileName) + " written");
				}
			});
		}).catch(err => {
			self.sendSocketNotification("PLAYTIME_UPDATE_ERROR", "Got " + err.message + " from API");
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

	getAllPlaytime(date, previousDate, gamesCount) {
		var result = [];
		for (let appid in this.data) {
			var time = 0;
			if (this.startedToPlay(appid, date)) {
				time = this.getGameRecentTime(appid, date);
			} else {
				let dateTotalTime = this.getGameTotalTime(appid, date);
				let previousDateTotalTime = this.getGameTotalTime(appid, previousDate);
				time = dateTotalTime - previousDateTotalTime;
			}
			if (time !== 0) {
				result.push({
					appid : appid,
					icon: this.data[appid].icon,
					time: time
				})
			}
		}
		return result.sort((a, b) => b.time - a.time).slice(0, gamesCount);
	}


	startedToPlay(appid, date) {
		let key = this.dateKeyFormatter(date);
		
		if (!key in this.data[appid].recently) {
			return false;
		}

		let firstKey = Object.keys(this.data[appid].recently).reduce((a, b) => a < b ? a : b);
		return key == firstKey;
	}

	getGameRecentTime(appid, date) {
		let key = this.dateKeyFormatter(date);
		if (key in this.data[appid].recently && date.isAfter(this.firstDate)) {
			return this.data[appid].recently[key];	
		}	
		return 0;
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

	getFirstDate(data) {
		return moment(Object.values(data).flatMap(e => Object.keys(e.total)).reduce((a, b) => a < b ? a : b, moment()));
	}

	getUniqueDaysCount() {
		return new Set(Object.values(this.data).flatMap(e => Object.keys(e.total))).size;
	}

	getUniqueGamesCount() {
		return Object.values(this.data).filter(game => {
			let min = Math.min(...Object.values(game.total));
			let max = Math.max(...Object.values(game.total));
			return min != max;
		}).length;
	}
}
