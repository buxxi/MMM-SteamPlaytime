# MMM-SteamPlaytime
[Magic Mirror](https://magicmirror.builders/) Module - A module for Magic Mirror that displays the amount of hours a user on steam has spent the last days.

> :warning: **This module requires to be run for at least 2 days before it displays anything relevant** It will save data in the modules folder under a data/-directory

![Screenshot][screenshot]

## Install
1. Clone repository into ``../modules/`` inside your MagicMirror folder.
2. Run ``npm install`` inside the ``MMM-SteamPlaytime`` folder.
3. Get an API-key from Steam [here](https://steamcommunity.com/dev/apikey).
4. Get the steamID64 for the user you want to track [here](https://steamid.io).
5. Add the module to the Magic Mirror config.
```
{
  module: "MMM-SteamPlaytime",
  position: "top_left",
  header: "Time spent on games",
  config: {
    apiKey: <apikey for steam>,
	steamId: <steamid64 for user>,
  }
},
```
6. Done!

## Configuration parameters
- ``apiKey`` : The API-key to use, required, see Installation instructions
- ``steamId`` : The SteamID64 for the user to track, required, see Installation instructions
- ``daysCount`` : The amount of previous days to display, defaults to 5
- ``gamesCount`` : The maximum amount of games to display per day, defaults to 5
- ``updateTime`` : The time of day when the data should be fetched for the previous day, defaults to "00:00" (midnight) in the format of "HH:mm"
- ``language`` : The language to use for time formatting, defaults to MagicMirror default



 [screenshot]: https://github.com/buxxi/MMM-SteamPlaytime/blob/master/screenshot.png