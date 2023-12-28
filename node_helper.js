const NodeHelper = require("node_helper");
const moment = require("moment");
const path = require("path");
const fs = require("fs/promises");

module.exports = NodeHelper.create({
	configured: false,

	start: function() {},

	socketNotificationReceived: async function(notification, payload) {
		let self = this;
		if (notification == "CONFIG") {
			let dataFolder = path.resolve(__dirname, "data", payload.steamId);
			if (!self.configured) {
				try {
					await fs.mkdir(dataFolder, { recursive: true });
				} catch (e) {
					console.log("Failed to create directory " + dataFolder);
				}

				let callback = async function() {
					await self.updateData(dataFolder, payload.apiKey, payload.steamId);
					
					let data = await self.loadCachedData(dataFolder, payload.excludeGames);
					self.sendResult(data, payload.steamId, payload.daysCount, payload.gamesCount);
				};
				self.scheduleNextUpdate(payload.updateTime, callback);

				self.configured = true;
			}

			let data = await self.loadCachedData(dataFolder, payload.excludeGames);
			self.sendResult(data, payload.steamId, payload.daysCount, payload.gamesCount);
		}
	},

	scheduleNextUpdate: function(updateTime, callback) {
		var self = this;
		var date = self.calculateNextUpdate(updateTime);
		var timeout = date.valueOf() - moment().valueOf();

		console.log("Next update at " + date.format("YYYY-MM-DD HH:mm:ss"));

		setTimeout(async function() {
			await callback();
			self.scheduleNextUpdate(updateTime, callback);
		}, timeout);
	},

	loadCachedData: async function(dataFolder, excludeAppIds) {
		var data = {};
		let files = await fs.readdir(dataFolder);

		for (let file of files) {
			try {
				var json = JSON.parse(await fs.readFile(path.resolve(dataFolder, file)));
				json.response.games.forEach(function(game) {
					if (excludeAppIds.indexOf(game.appid) >= 0) {
						return;
					}
					if (!(game.appid in data)) {
						data[game.appid] = {
							icon: "http://media.steampowered.com/steamcommunity/public/images/apps/" + game.appid + "/" + game.img_icon_url + ".jpg",
							total: {}
						}
					}
					data[game.appid].total[json.date] = game.playtime_forever;
				});
			} catch (e) {
				console.log("Could not load data from " + file + ", error: " + e);
			}
		};

		return data;
	},

	sendResult: function(data, steamId, daysCount, gamesCount) {
		let self = this;

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
		let self = this;
		let result = {};
		var date = moment().subtract(1, "days").startOf("day");

		for (let i = 0; i < daysCount; i++) {
			let previousDate = date.clone().subtract(1, 'days');
			result[self.key(date)] = calculator.getAllPlaytime(date, gamesCount);
			date = previousDate;
		}

		return result;
	},

	updateData: async function(dataFolder, apiKey, steamId) {
		let self = this;

		let data = await self.fetchData(apiKey, steamId);
		let forDate = self.key(moment().subtract(1, 'days'));
		let fileName = forDate + ".json";
		let filePath = path.resolve(dataFolder, fileName);
		
		data.date = forDate;
		
		try {
			await fs.writeFile(filePath, JSON.stringify(data));
			console.log(filePath + " written");
		} catch (err) {
			self.sendSocketNotification("PLAYTIME_UPDATE_ERROR", "Could not write file " + filePath);						
		};
 
	},

	fetchData: async function(apiKey, steamId) {
		let self = this;
		try {
			let response = await fetch("http://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?key=" + apiKey + "&steamid=" + steamId + "&format=json",
				{
					method : "GET",
					headers : {
						"User-Agent" : "MagicMirror/MMM-SteamPlaytime/1.0; (https://github.com/buxxi/MMM-SteamPlaytime)"
					}
				}
			);
		
			if (response.status != 200) {
				throw new Error(response.status + ": " + response.statusText);
			}
			return await response.json();
		} catch(err) {
			self.sendSocketNotification("PLAYTIME_UPDATE_ERROR", "Got " + err.message + " from API");
		};   
	},

	key: function(date) {
		return date.format("YYYY-MM-DD");
	},

	calculateNextUpdate(updateTime) {
		let date = moment();

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

	getAllPlaytime(date, gamesCount) {
		var result = [];
		for (let appid in this.data) {
			//Find the playtime for that current date, if not found the json-file is probably missing for that day, no need to backtrack further
			let dateTotalTime = this.getGameTotalTime(appid, date, date);
			if (dateTotalTime > 0) {
				//If the current day has any playtime backtrack possibly all the way to the first day that has the data set to calculate the delta
				let previousDateTotalTime = this.getGameTotalTime(appid, date.clone().subtract(1, 'days'), this.firstDate);
				let time = dateTotalTime - previousDateTotalTime;

				if (time !== 0) {
					result.push({
						appid : appid,
						icon: this.data[appid].icon,
						time: time
					})
				}
			}
		}
		return result.sort((a, b) => b.time - a.time).slice(0, gamesCount);
	}

	getGameTotalTime(appid, date, stopAtDate) {
		let key = this.dateKeyFormatter(date);

		if (key in this.data[appid].total) {
			return this.data[appid].total[key];	
		}

		if (stopAtDate.isBefore(date)) {
			return this.getGameTotalTime(appid, date.clone().subtract(1, 'days'), stopAtDate);
		} else {
			return 0;
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
