(function(jQuery, Underscore, Backbone) {/**
 * @license almond 0.3.0 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that "directory" and not name of the baseName's
                //module. For instance, baseName of "one/two/three", maps to
                //"one/two/three.js", but we want the directory, "one/two" for
                //this normalization.
                baseParts = baseParts.slice(0, baseParts.length - 1);
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                name = baseParts.concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("lib/almond.js", function(){});

/*!
 * EventEmitter v4.2.9 - git.io/ee
 * Oliver Caldwell
 * MIT license
 * @preserve
 */
(function(){function t(){}function i(t,n){for(var e=t.length;e--;)if(t[e].listener===n)return e;return-1}function n(e){return function(){return this[e].apply(this,arguments)}}var e=t.prototype,r=this,s=r.EventEmitter;e.getListeners=function(n){var r,e,t=this._getEvents();if(n instanceof RegExp){r={};for(e in t)t.hasOwnProperty(e)&&n.test(e)&&(r[e]=t[e])}else r=t[n]||(t[n]=[]);return r},e.flattenListeners=function(t){var e,n=[];for(e=0;e<t.length;e+=1)n.push(t[e].listener);return n},e.getListenersAsObject=function(n){var e,t=this.getListeners(n);return t instanceof Array&&(e={},e[n]=t),e||t},e.addListener=function(r,e){var t,n=this.getListenersAsObject(r),s="object"==typeof e;for(t in n)n.hasOwnProperty(t)&&-1===i(n[t],e)&&n[t].push(s?e:{listener:e,once:!1});return this},e.on=n("addListener"),e.addOnceListener=function(e,t){return this.addListener(e,{listener:t,once:!0})},e.once=n("addOnceListener"),e.defineEvent=function(e){return this.getListeners(e),this},e.defineEvents=function(t){for(var e=0;e<t.length;e+=1)this.defineEvent(t[e]);return this},e.removeListener=function(r,s){var n,e,t=this.getListenersAsObject(r);for(e in t)t.hasOwnProperty(e)&&(n=i(t[e],s),-1!==n&&t[e].splice(n,1));return this},e.off=n("removeListener"),e.addListeners=function(e,t){return this.manipulateListeners(!1,e,t)},e.removeListeners=function(e,t){return this.manipulateListeners(!0,e,t)},e.manipulateListeners=function(r,t,i){var e,n,s=r?this.removeListener:this.addListener,o=r?this.removeListeners:this.addListeners;if("object"!=typeof t||t instanceof RegExp)for(e=i.length;e--;)s.call(this,t,i[e]);else for(e in t)t.hasOwnProperty(e)&&(n=t[e])&&("function"==typeof n?s.call(this,e,n):o.call(this,e,n));return this},e.removeEvent=function(e){var t,r=typeof e,n=this._getEvents();if("string"===r)delete n[e];else if(e instanceof RegExp)for(t in n)n.hasOwnProperty(t)&&e.test(t)&&delete n[t];else delete this._events;return this},e.removeAllListeners=n("removeEvent"),e.emitEvent=function(r,o){var e,i,t,s,n=this.getListenersAsObject(r);for(t in n)if(n.hasOwnProperty(t))for(i=n[t].length;i--;)e=n[t][i],e.once===!0&&this.removeListener(r,e.listener),s=e.listener.apply(this,o||[]),s===this._getOnceReturnValue()&&this.removeListener(r,e.listener);return this},e.trigger=n("emitEvent"),e.emit=function(e){var t=Array.prototype.slice.call(arguments,1);return this.emitEvent(e,t)},e.setOnceReturnValue=function(e){return this._onceReturnValue=e,this},e._getOnceReturnValue=function(){return this.hasOwnProperty("_onceReturnValue")?this._onceReturnValue:!0},e._getEvents=function(){return this._events||(this._events={})},t.noConflict=function(){return r.EventEmitter=s,t},"function"==typeof define&&define.amd?define('EE',[],function(){return t}):"object"==typeof module&&module.exports?module.exports=t:r.EventEmitter=t}).call(this);
define('instances/time',[], function() {
    var Time = function(time, totalTime){
        time = time < 0 ? 0 : time;
        var minutes = Math.floor(time / 60000),
            seconds = Math.floor((time - minutes * 60000) / 1000);
        if (minutes < 10) minutes = '0' + minutes;
        if (seconds < 10) seconds = '0' + seconds;
        return {
            timeMS: time,
            timeS: Math.floor(time / 1000),
            timePer: totalTime ? time / totalTime : null,
            timeFormat: minutes + ':' + seconds
        }
    };

    return Time;
});
define('instances/room',['instances/time'], function(Time) {
    var Room = function(roomInfo, client){
        this.data = roomInfo; //deprecated
        this.inviteData = roomInfo.data;
        this.id = roomInfo.room;
        this.owner = client.getUser(roomInfo.owner);
        this.players = [];
        this.spectators = [];
        this.isPlayer = false;
        this.mode = roomInfo.mode;
        this.turnTime = roomInfo.turnTime || client.opts.turnTime * 1000;
        this.takeBacks = roomInfo.takeBacks;
        this.timeMode = roomInfo.timeMode || 'reset_every_switch';
        this.timeStartMode = roomInfo.timeStartMode || 'after_switch';
        this.timeGameStart = Date.now();
        this.timeRoundStart = 0;
        this.history = [];
        this.userData = {};
        var i;
        // init players
        if (typeof roomInfo.players[0] == "object") {
            this.players = roomInfo.players;
        }
        else {
            for (i = 0; i < roomInfo.players.length; i++)
                this.players.push(client.getUser(roomInfo.players[i]));
        }

        // init spectators
        if (roomInfo.spectators && roomInfo.spectators.length) {
            if (typeof roomInfo.spectators[0] == "object") {
                this.players = roomInfo.players;
            }
            else {
                for (i = 0; i < roomInfo.spectators.length; i++)
                    this.spectators.push(client.getUser(roomInfo.spectators[i]));
            }
        }

        this.score = {games:0};
        for (i = 0; i < this.players.length; i++){
            this.score[this.players[i].userId] = 0;
            this.userData[this.players[i].userId] = {};
            if (this.players[i] == client.getPlayer()) this.isPlayer = true;
        }
    };

    Room.prototype.load = function(data){
        var id;
        if (data.userData){
            // load personal user data, total time, others
            for (var i = 0; i < this.players.length; i++){
                id = this.players[i].userId;
                this.userData[id].userTotalTime = data.userData[id].userTotalTime || this.userData[id].userTotalTime;
                this.userData[id].userTurnTime = data.userData[id].userTurnTime || this.userData[id].userTurnTime || this.turnTime;
            }
        }
        if (data['gameTime']) this.timeGameStart -= data['gameTime'];
        if (data['roundTime']) this.timeRoundStart -= data['roundTime'];
    };

    Room.prototype.getTime = function(user, fGetFromUserData){
        user = user || this.current;
        var time = this.userTime, turnTime;
        if (this.timeMode == 'common') {
            time = Date.now() - this.turnStartTime;
        }
        if (fGetFromUserData) time = this.userData[user.userId].userTurnTime;
        var userTime = new Time(time, this.turnTime);


        time = {
            userTimeMS: userTime.timeMS,
            userTimeS: userTime.timeS,
            userTimePer: userTime.timePer,
            userTimeFormat: userTime.timeFormat,
            userTime: userTime,
            turnTime: this.userTurnTime || this.userData[user.userId].userTurnTime || this.turnTime
        };

        if (this.timeGameStart){
            time.gameTime = new Time(Date.now() - this.timeGameStart);
        }
        if (this.timeRoundStart){
            time.roundTime = new Time(Date.now() - this.timeRoundStart);
        }

        if (this.timeMode == 'common'){
            time.userTotalTime = userTime;
            time.totalTime = userTime;
        } else {
            time.user = user;
            turnTime = (user == this.current && this.turnStartTime) ? Date.now() - this.turnStartTime : 0;
            time.userTotalTime = new Time(turnTime + this.userData[user.userId].userTotalTime);
            var totalTimeMs = turnTime;
            for (var i = 0; i < this.players.length; i++){
                totalTimeMs += this.userData[this.players[i].userId].userTotalTime || 0;
            }
            time.totalTime = new Time(totalTimeMs);
        }

        return time;
    };

    Room.prototype.checkPlayWithBlackList = function(blacklist){
        if (!this.isPlayer) return false;
        for (var i = 0; i < this.players.length; i++){
            if (blacklist[this.players[i].userId]) return true;
        }
        return false;
    };

    return Room;
});
define('instances/turn',[], function() {
    var Turn = function(turn, user, nextPlayer){
        this.user = user;
        this.nextPlayer = nextPlayer;
        this.turn = turn;
        if (turn.userTurnTime){
            this.userTurnTime = turn.userTurnTime;
            delete turn.userTurnTime;
        }
        if (turn.userTime){
            this.userTime = turn.userTime;
            delete turn.userTime;
        }
        delete this.turn.nextPlayer;
    };
    return Turn;
});
define('instances/game_event',[], function() {
    var GameEvent = function(data){
        this.event = {};
        for (var key in data){
            if (data.hasOwnProperty(key)){
                switch (key){
                    case 'user':
                        this.user = data.user;
                        break;
                    case 'nextPlayer':
                        this.nextPlayer = data.nextPlayer;
                        break;
                    case 'type':
                        this.event.type = data.type;
                        break;
                    case 'action':
                        if (data.action == 'timeout') {
                            this.event.type = data.action;
                        }
                        break;
                    case 'userTime':
                        this.userTime = data[key];
                        break;
                    case 'userTurnTime':
                        this.userTurnTime = data[key];
                        break;
                    default:
                        this.event[key] = data[key];
                }
            }
        }
    };
    return GameEvent;
});
define('modules/game_manager',['EE', 'instances/room', 'instances/turn', 'instances/game_event', 'instances/time'],
    function(EE, Room, Turn, GameEvent, Time) {
    

    var GameManager = function(client){
        this.client = client;
        this.currentRoom = null;
        this.enableGames = true;
        this.wasPlaying = false;
        this.leaveGameTimeout = null;
        this.LEAVE_GAME_TIME = 1000;

        client.on('relogin', function(){
            clearTimeout(this.leaveGameTimeout);
            // if was previous game, wait reconnect and leave prev game;
            if (this.wasPlaying){
                this.leaveGameTimeout = setTimeout(function () {
                    console.log('game_manager;', 'auto leave not restarted game');
                    this.emit('game_leave', this.currentRoom);
                    this.currentRoom = null;
                }.bind(this), this.LEAVE_GAME_TIME);
            }
        }.bind(this));

        client.on('disconnected', function () {
            this.wasPlaying = this.isPlaying();
            if (this.isSpectating()){
                this.emit('game_leave', this.currentRoom);
            } else if (this.inGame() && !this.isPlaying()){
                this.emit('game_leave', this.currentRoom);
                this.currentRoom = null;
            }
            clearTimeout(this.leaveGameTimeout);
            clearInterval(this.timeInterval);
            this.timeInterval = null;
            this.prevTime = null;
        }.bind(this));

        window.addEventListener('blur', function(){
            this.onUserFocusChanged(false);
        }.bind(this));
        window.addEventListener('focus', function(){
            this.onUserFocusChanged(true);
        }.bind(this));
    };

    GameManager.prototype  = new EE();


    GameManager.prototype.onMessage = function(message){
        var data = message.data, player = this.client.getPlayer(),
            i, user, spectatorInd;
        console.log('game_manager;', 'message', message);
        switch (message.type) {
            case 'new_game':
                for ( i = 0; i < data.players.length; i++){
                    if (data.players[i] == player){
                        if (this.currentRoom)
                            if (this.currentRoom.isClosed || !this.currentRoom.isPlayer) this.leaveRoom();
                            else throw new Error('start game before current game finished! old: '+this.currentRoom.id+' new:'+data.room);
                        this.onGameStart(data);
                    }
                }
                break;
            case 'end_game':
                break;
            case 'ready':
                console.log('game_manager;', 'user_ready', data);
                break;
            case 'round_start':
                this.onRoundStart(data);
                break;
            case 'turn':
                this.onTurn(data);
                break;
            case 'event':
                user = this.getPlayer(data.user);
                console.log('game_manager;', 'game event', data, user);
                this.onUserEvent(user, data);
                break;
            case 'user_leave':
                user = this.getPlayer(data);
                this.onUserLeave(user);
                break;
            case 'round_end':
                this.onRoundEnd(data);
                break;
            case 'game_restart':
                this.onGameRestart(data);
                break;
            case 'spectate':
                this.onSpectateStart(data);
                break;
            case 'spectator_join':
                console.log('game_manager;', 'spectator_join', data);
                user = this.client.getUser(data.user);
                spectatorInd = this.currentRoom.spectators.indexOf(user);
                if (user && spectatorInd < 0){
                    this.currentRoom.spectators.push(user);
                    this.emit('spectator_join', user);
                }
                break;
            case 'spectator_leave':
                console.log('game_manager;', 'spectator_leave', data);
                if (this.currentRoom && this.currentRoom.id != data.room){
                    console.error('game_manager;', 'user leave wrong room, roomId:', data.room, 'current room: ', this.currentRoom);
                    return;
                }
                if (data.user == this.client.getPlayer().userId && this.currentRoom) {
                    this.currentRoom.isClosed = true;
                    this.leaveRoom();
                } else {
                    user = this.getSpectator(data.user);
                    spectatorInd = this.currentRoom.spectators.indexOf(user);
                    if (user && spectatorInd >= 0){
                        this.currentRoom.spectators.splice(spectatorInd, 1);
                        this.emit('spectator_leave', user);
                    }
                }
                break;
            case 'error':
                console.error('game_manager;', 'error', data);
                this.emit('error', data);
                break;
        }
    };


    GameManager.prototype.onGameStart = function(room){
        clearTimeout(this.leaveGameTimeout);
        room = new Room(room, this.client);
        console.log('game_manager;', 'emit game_start', room);
        this.currentRoom = room;
        this.emit('game_start', room);
        if (room.checkPlayWithBlackList(this.client.settings.blacklist)){
            console.log('game_manager;', 'play with user in blacklist');
            this.leaveGame();
            return;
        }
        this.sendReady();
    };


    GameManager.prototype.onGameRestart = function (data) {
        clearTimeout(this.leaveGameTimeout);
        console.log('game_manager;', 'game restart', data);
        //start game
        var room = new Room(data['roomInfo'], this.client);
        console.log('game_manager;', 'emit game_start', room);
        this.currentRoom = room;
        room.score = data.score || room.score;
        var timeStart = Date.now();
        this.emit('game_start', room);
        this.onRoundStart(data['initData'], true);
        room.load(data);
        for (var key in this.currentRoom.players){
            if (this.currentRoom.players.hasOwnProperty(key)){
                console.log('game_manager; emit time', key);
                this.emitTime(this.currentRoom.players[key], true);
            }
        }
        this.currentRoom.history = this.parseHistory(data.history, data['playerTurns']);
        this.emit('game_load', this.currentRoom.history);
        this.currentRoom.userTakeBacks = data['usersTakeBacks']?data['usersTakeBacks'][this.client.getPlayer().userId] : 0;
        // switch player
        var turn = this.getLastTurn(),
            userTurnTime = turn ? turn.userTurnTime : room.userTurnTime;
            userTurnTime = userTurnTime < 0 ? 0 :userTurnTime;
        this.switchPlayer(this.getPlayer(data.nextPlayer), data.userTime + (Date.now() - timeStart),userTurnTime);
    };


    GameManager.prototype.onSpectateStart = function(data){
        console.log('game_manager;', 'spectate start', data);
        //start game
        var room = new Room(data['roomInfo'], this.client);
        // for old server version add user to spectators
        if (!room.spectators.length) {
            room.spectators.push(this.client.getPlayer());
        }
        console.log('game_manager;', 'emit game_start', room);
        this.currentRoom = room;
        room.score = data.score || room.score;
        var timeStart = Date.now();
        this.emit('game_start', room);
        if (data.state == 'waiting'){
            console.log('game_manager', 'start spectate', 'waiting players ready to play');
            return;
        }
        this.onRoundStart(data['initData'], true);
        room.load(data);
        for (var key in this.currentRoom.players){
            if (this.currentRoom.players.hasOwnProperty(key)){
                this.emitTime(this.currentRoom.players[key], true)
            }
        }
        this.currentRoom.history = this.parseHistory(data.history, data['playerTurns']);
        this.emit('game_load', this.currentRoom.history);
        // switch player
        if (data.userTime != null) {
            var turn = this.getLastTurn();
            this.switchPlayer(this.getPlayer(data.nextPlayer), data.userTime + (Date.now() - timeStart), turn ? turn.userTurnTime : 0);
        }
    };


    GameManager.prototype.onRoundStart = function (data, loading){
        console.log('game_manager;', 'emit round_start', data);
        // TODO: replace in room function
        this.currentRoom.timeMode = data.timeMode || this.currentRoom.timeMode;
        this.currentRoom.timeStartMode = data.timeStartMode || this.currentRoom.timeStartMode;
        this.currentRoom.turnTime = data.turnTime || this.currentRoom.turnTime;

        this.currentRoom.current = this.getPlayer(data.first);
        this.currentRoom.userTime = this.currentRoom.turnTime;
        this.currentRoom.userTurnTime = 0;
        this.currentRoom.turnStartTime = null;
        this.currentRoom.userTakeBacks = 0;
        this.currentRoom.cancelsAscTakeBack = 0;
        this.currentRoom.cancelsAscDraw = 0;
        this.currentRoom.history = [];
        this.currentRoom.initData = data;
        this.currentRoom.timeRoundStart = Date.now();
        var players = data.first == data.players[0]?[this.getPlayer(data.players[0]),this.getPlayer(data.players[1])]:[this.getPlayer(data.players[1]),this.getPlayer(data.players[0])];
        for (var i = 0; i < this.currentRoom.players.length; i++){
            this.currentRoom.userData[this.currentRoom.players[i].userId].userTotalTime = 0;
        }

        this.emit('round_start', {
            players: players,
            first: this.getPlayer(data.first),
            id: data.id,
            inviteData: data.inviteData,
            initData: data,
            score: this.currentRoom.score,
            isPlayer: this.currentRoom.isPlayer,
            loading: !!loading
        });
        if (this.currentRoom.timeStartMode == 'after_round_start'){
            this.switchPlayer(this.currentRoom.current, 0, this.getTurnTime());
        }
        this.emitTime();
    };


    GameManager.prototype.onRoundEnd = function(data){
        console.log('game_manager;', 'emit round_end', data, this.currentRoom, this.getHistory());
        clearInterval(this.timeInterval);
        this.timeInterval = null;
        this.prevTime = null;
        this.currentRoom.current = null;
        this.currentRoom.score = data.score;
        data.mode = this.currentRoom.data.mode;
        data.isPlayer = this.currentRoom.isPlayer;
        if (data.winner){
            if (data.winner == this.client.getPlayer().userId) { // win
                console.log('game_manager;', 'win', data);
                data.result = 'win'
            } else { // lose
                console.log('game_manager;', 'lose', data);
                data.result = 'lose'
            }
        } else { // not save or draw
            if (data.winner == 'not_save') console.log('game_manager', 'not accepted', data);
            else {
                data.result = 'draw';
                console.log('game_manager;', 'draw', data);
            }
        }

        if (!this.currentRoom.isPlayer && data.winner){
            data.result = null;
        }

        data.message = this.getResultMessages(data);

        this.emit('round_end', data);
    };


    GameManager.prototype.onUserLeave = function(user){
        //TODO: check user is opponent or me
        this.currentRoom.isClosed = true;
        console.log('game_manager;', 'user_leave', this.currentRoom, user);
        if (user != this.client.getPlayer()) this.emit('user_leave', user);
        else this.leaveRoom();
    };


    GameManager.prototype.onTurn = function(data){
        console.log('game_manager;', 'emit turn', data);
        var room = this.currentRoom;
        if (!this.client.opts.newGameFormat){
            room.history.push(data.turn);
        }
        var userTurnTime = data.turn.userTurnTime || 0;
        userTurnTime = userTurnTime < 0 ? 0 :userTurnTime;
        if (data.turn.userTurnTime) {
            delete data.turn.userTurnTime;
        }
        if (data.turn.nextPlayer) {
            data.nextPlayer = this.getPlayer(data.turn.nextPlayer);
            delete data.turn.nextPlayer;
        } else {
            // reset user turn time if enabled
            if (room.timeMode == 'reset_every_turn'){
                console.log('game_manager;', 'reset user turn time', room.current, room.userTime, room.userTurnTime);
                room.userData[room.current.userId].userTotalTime += room.turnTime - room.userTime;
                room.userTime = userTurnTime || room.turnTime;
            }
        }
        if (this.client.opts.newGameFormat){
            data = new Turn(data.turn, this.getPlayer(data.user), data.nextPlayer);
            var time = this.currentRoom.getTime();
            if (time) {
                data.userTime = time.userTime;
                data.userTotalTime = time.userTotalTime;
            }
            room.history.push(data);
        }
        this.emit('turn', data);
        var nextPlayer = data.nextPlayer;
        // reset time on first turn if need
        if (!data.nextPlayer && !this.timeInterval && (room.timeMode == 'reset_every_turn' || room.timeStartMode == 'after_turn')){
            nextPlayer = room.current;
        }
        this.switchPlayer(nextPlayer, 0, userTurnTime);
    };


    GameManager.prototype.onUserEvent = function(user, event){
        switch (event.type){
            case 'draw':
                if (user == this.client.getPlayer()) return; // draw to yourself
                switch (event.action){
                    case 'ask':
                        this.emit('ask_draw', user);
                        break;
                    case 'cancel':
                        this.emit('cancel_draw', user);
                        this.currentRoom.cancelsAscDraw++;
                        break;
                }
                break;
            case 'timeout':
                if (event.nextPlayer) {
                    var nextPlayer = this.getPlayer(event.nextPlayer);
                    if (this.client.opts.newGameFormat){
                        event.user = this.getPlayer(event.user);
                        event.nextPlayer = nextPlayer;
                        event = new GameEvent(event);
                        this.currentRoom.history.push(event);
                        this.emit('timeout', event);
                    } else {
                        event.user = this.getPlayer(event.user);
                        this.currentRoom.history.push({
                            user: event.user.userId,
                            action: 'timeout',
                            nextPlayer: event.nextPlayer
                        });
                        this.emit('timeout', event);
                    }
                    this.switchPlayer(nextPlayer);
                }
                break;
            case 'back':
                switch (event.action){
                    case 'take':
                        if (user == this.client.getPlayer()){
                            this.currentRoom.userTakeBacks++;
                        }
                        this.switchPlayer(user);
                        this.currentRoom.history = this.parseHistory(event.history);
                        this.emit('take_back', {user: user, history: this.currentRoom.history});
                        break;
                    case 'ask':
                        if (user != this.client.getPlayer())
                            this.emit('ask_back', user);
                        break;
                    case 'cancel':
                        this.emit('cancel_back', user);
                        this.currentRoom.cancelsAscTakeBack++;
                        break;
                }
                break;
            case 'focus':
                this.emit('focus', {user: user, windowHasFocus: event.action == 'has'});
                break;
            default:
                console.log('game_manager;', 'onUserEvent user:', user, 'event:', event);
                if (this.client.opts.newGameFormat) {
                    event.user = this.getPlayer(event.user) || undefined;
                    event.nextPlayer = this.getPlayer(event.nextPlayer) || undefined;
                    event.target = this.getPlayer(event.target) || undefined;
                    event = new GameEvent(event);
                }
                this.currentRoom.history.push(event);
                this.emit('event', event);
        }
    };


    GameManager.prototype.onUserFocusChanged = function(windowHasFocus){
        this.client.isFocused = windowHasFocus;
        if (this.isPlaying()) {
            this.client.send('game_manager', 'event', 'server', {
                type: 'focus',
                action: windowHasFocus ? 'has' : 'lost'
            });
        }
    };


    GameManager.prototype.switchPlayer = function(nextPlayer, userTime, turnTime){
        console.log('switch player;', nextPlayer, userTime, turnTime);
        var room = this.currentRoom;
        userTime = userTime || 0;
        if (!room){
            console.error('game_manager;', 'switchPlayer', 'game not started!');
            return;
        }
        if (!nextPlayer)  return;
        room.userData[room.current.userId].userTotalTime +=  room.turnStartTime ? Date.now() - room.turnStartTime : 0;
        if (!turnTime){
            room.userTurnTime = null;
        } else {
            room.userTurnTime = turnTime;
        }

        room.current = nextPlayer;
        userTime = userTime || 0;

        if (room.timeMode == 'common'){
            room.turnStartTime = room.turnStartTime == null ? Date.now() - userTime : room.turnStartTime;
            room.userTime = userTime;
        } else {
            room.turnStartTime = Date.now() - userTime;
            room.userTime = (turnTime || room.turnTime) - userTime;
            if (room.userTime < 0) room.userTime = 0;
        }

        this.emit('switch_player', room.current);
        this.emitTime();
        if (!this.timeInterval) {
            this.prevTime = null;
            this.timeInterval = setInterval(this.onTimeTick.bind(this), 100);
        }
    };


    GameManager.prototype.leaveGame = function(){
        if (!this.currentRoom){
            console.warn('game_manager;', 'leaveGame', 'game not started!');
            return;
        }
        if (this.currentRoom.isClosed){
            this.leaveRoom();
            return;
        }
        // TODO: send to server leave game, block game and wait leave message
        this.client.send('game_manager', 'leave', 'server', true);
    };


    GameManager.prototype.leaveRoom = function(){
        if (!this.currentRoom){
            console.warn('game_manager;', 'leaveRoom', 'game not started!');
            return;
        }
        if (!this.currentRoom.isClosed) {
            if (this.currentRoom.isPlayer)
                throw new Error('leave not closed room! ' + this.currentRoom.id);
            else console.error('game_manager', 'spectator leave not closed room')
        }
        clearInterval(this.timeInterval);
        this.timeInterval = null;
        console.log('game_manager;', 'emit game_leave;', this.currentRoom);
        this.emit('game_leave', this.currentRoom);
        this.currentRoom = null;
    };


    GameManager.prototype.sendReady = function(){
        if (!this.currentRoom){
            console.error('game_manager;', 'sendReady', 'game not started!');
            return;
        }
        if (!this.enableGames){
            this.leaveGame();
            this.client.viewsManager.dialogsView.showDialog('Новые игры временно отключены',{}, true, false, false);
        }
        this.client.send('game_manager', 'ready', 'server', true);
    };


    GameManager.prototype.sendTurn = function(turn){
        if (!this.isPlaying()){
            console.error('game_manager;', 'sendTurn', 'game not started!');
            return false
        }
        if (this.currentRoom.current != this.client.getPlayer()){
            console.warn('game_manager;', 'not your turn!');
            return false;
        }
        if (this.currentRoom.timeMode != 'common' && this.currentRoom.userTime < 300) {
            console.warn('game_manager;', 'your time is out!');
            return false;
        }
        // TODO: replace auto cancel draw to server
        if ($('.dialogDraw').length) {
            this.cancelDraw();
            $('.dialogDraw').remove();
        }
        this.client.send('game_manager', 'turn', 'server', turn);
        return true;
    };


    GameManager.prototype.sendThrow = function(){
        if (!this.isPlaying()){
            console.error('game_manager', 'sendThrow', 'game not started!');
            return;
        }
        this.client.send('game_manager', 'event', 'server', {type:'throw'});
    };


    GameManager.prototype.sendDraw = function(){
        if (!this.isPlaying()){
            console.error('game_manager;', 'sendDraw', 'game not started!');
            return;
        }
        if (this.currentRoom.cancelsAscDraw >= 3){
            this.client.viewsManager.dialogsView.showDialog('Число запросов ограничено тремя', false, true, true);
            return;
        }
        this.client.send('game_manager', 'event', 'server', {type:'draw', action:'ask'});
        this.emit('send_draw');
    };


    GameManager.prototype.sendEvent = function (type, event, target) {
        if (!this.isPlaying()){
            console.error('game_manager;', 'sendEvent', 'game not started!');
            return;
        }
        console.log('game_manager;', 'sendEvent', type, event);
        event.type = type;
        if (target) event.target = target;
        else target = 'server';
        this.client.send('game_manager', 'event', target, event);
    };


    GameManager.prototype.sendTakeBack = function(){
        if (!this.isPlaying()){
            console.error('game_manager;', 'sendTakeBack', 'game not started!');
            return;
        }
        if (this.currentRoom.cancelsAscTakeBack >= 3){
            this.client.viewsManager.dialogsView.showDialog('Вы превысили число запросов к другому игроку', false, true, true);
            return;
        }
        this.client.viewsManager.dialogsView.cancelTakeBack();
        this.client.send('game_manager', 'event', 'server', {type:'back', action:'take'});
        this.emit('send_back');
    };


    GameManager.prototype.acceptTakeBack = function() {
        if (!this.isPlaying()){
            console.error('game_manager;', 'acceptTakeBack', 'game not started!');
            return;
        }
        this.client.send('game_manager', 'event', 'server', {type:'back', action:'accept'});
    };


    GameManager.prototype.cancelTakeBack = function() {
        if (!this.isPlaying()){
            console.error('game_manager;', 'cancelTakeBack', 'game not started!');
            return;
        }
        this.client.send('game_manager', 'event', 'server', {type:'back', action:'cancel'});
    };


    GameManager.prototype.acceptDraw = function(){
        if (!this.isPlaying()){
            console.error('game_manager;', 'acceptDraw', 'game not started!');
            return;
        }
        this.client.send('game_manager', 'event', 'server', {type:'draw', action:'accept'});
    };


    GameManager.prototype.cancelDraw = function(){
        if (!this.isPlaying()){
            console.error('game_manager;', 'cancelDraw', 'game not started!');
            return;
        }
        this.client.send('game_manager', 'event', 'server', {type:'draw', action:'cancel'});
    };


    GameManager.prototype.spectate = function(room){
        if (!room){
            return;
        }

        if (this.isPlaying()) {
            console.warn('game_manager;', 'spectate', 'you are already playing game!');
            return;
        }
        if (this.isSpectating()){
            this.leaveGame();
        }
        this.client.send('game_manager', 'spectate', 'server', {roomId: room});
    };


    GameManager.prototype.getPlayer = function(id){
        if (!this.currentRoom){
            console.error('game_manager;', 'getPlayer', 'game not started!');
            return;
        }
        if (this.currentRoom)
            for (var i = 0; i < this.currentRoom.players.length; i++)
                if (this.currentRoom.players[i].userId == id) return this.currentRoom.players[i];
        return null;
    };


    GameManager.prototype.getSpectator = function(id){
        for (var i = 0; i < this.currentRoom.spectators.length; i++)
            if (this.currentRoom.spectators[i].userId == id) return this.currentRoom.spectators[i];
        return null;
    };


    GameManager.prototype.getHistory = function(){
        if (!this.currentRoom || !this.currentRoom.history) return [];
        var history = [];
        for (var i = 0; i < this.currentRoom.history.length; i++) {
            if (this.currentRoom.history[i].length){
                for (var j = 0; j < this.currentRoom.history[i].length; j++){
                    history.push(this.currentRoom.history[i][j]);
                }
            }
            else history.push(this.currentRoom.history[i]);
        }
        return history
    };


    GameManager.prototype.getLastTurn = function(){
        if (this.currentRoom && this.currentRoom.history && this.currentRoom.history.length >= 1){
            var history = this.currentRoom.history,
                turn = history[history.length - 1];
            if (turn.length){
                return turn[turn.length-1];
            } else {
                return turn;
            }
        } else {
            return null;
        }
    };


    GameManager.prototype.getTurnTime = function(){
        if (this.currentRoom){
            return this.currentRoom.userTurnTime || this.currentRoom.turnTime;
        }
        return null
    };


    GameManager.prototype.getResultMessages = function(data){
        var locale = this.client.locale['game']['resultMessages'], loser,
            message = {
            resultMessage: locale[data.result],
            resultComment: ""
        };
        if (data.winner){
            if (data.isPlayer){
                if (data.result == 'lose'){
                    switch  (data.action){
                        case 'timeout': message.resultComment =  locale['playerTimeout']; break;
                        case 'user_leave': message.resultComment = locale['playerLeave']; break;
                        case 'throw': message.resultComment = locale['playerThrow']; break;
                    }
                } else { // win
                    switch (data.action) {
                        case 'timeout':
                            message.resultComment = locale['opponentTimeoutPre'] + locale['opponentTimeout'];
                            break;
                        case 'user_leave':
                            message.resultComment = locale['opponent'] + locale['opponentLeave'];
                            break;
                        case 'throw':
                            message.resultComment = locale['opponent'] + locale['opponentThrow'];
                            break;
                    }
                }
            } else{ // spectator
                message.resultMessage = locale['wins'] + this.getPlayer(data.winner).userName;
                loser = (data.winner == this.currentRoom.players[0].userId ? this.currentRoom.players[1] : this.currentRoom.players[0]);
                switch (data.action) {
                    case 'timeout':
                        message.resultComment = locale['timeoutPre'] + loser.userName + locale['opponentTimeout'];
                        break;
                    case 'user_leave':
                        message.resultComment = loser.userName + locale['opponentLeave'];
                        break;
                    case 'throw':
                        message.resultComment = loser.userName + locale['opponentThrow'];
                        break;
                }
            }
        }
        return message;
    };

    /**
     * returns true if user in room and he is player
     * @returns {boolean|*}
     */
    GameManager.prototype.inGame = function (){
        return this.currentRoom != null && !this.currentRoom.isClosed && this.getPlayer(this.client.getPlayer().userId);
    };

    /**
     * returns true if user in room, he is player and room state is playing
     * @returns {boolean|*}
     */
    GameManager.prototype.isPlaying = function(){
        return this.currentRoom != null && !this.currentRoom.isClosed
            && this.getPlayer(this.client.getPlayer().userId) && this.currentRoom.current != null;
    };

    /**
     * return true if user is spectator
     * @returns {boolean}
     */
    GameManager.prototype.isSpectating = function(){
        if (this.currentRoom != null && !this.currentRoom.isClosed && this.currentRoom.spectators){
            for (var i = 0; i < this.currentRoom.spectators.length; i++){
                if (this.currentRoom.spectators[i] == this.client.getPlayer()) return true;
            }
        }
        return false;
    };


    GameManager.prototype.onTimeTick = function(){
        var time = Date.now();
        if (!this.prevTime){
            this.prevTime = time;
            return;
        }
        var delta = time - this.prevTime;

        if (delta > 100) {
            this.currentRoom.userTime -= delta;
            if (this.currentRoom.userTime  < 0) {
                this.currentRoom.userTime = 0;
                //console.warn('gameManager;', 'user time is out', this.current, this.currentRoom);
            }
            this.emitTime();
            this.prevTime = time;
        }
    };


    GameManager.prototype.emitTime = function(user, fGetFromUserData){
        try {
            var time = this.currentRoom.getTime(user, fGetFromUserData);
            this.emit('time', time);
        } catch (e) {
            console.error('game_manager; emitTime', e);
        }
    };


    GameManager.prototype.parseHistory = function(shistory, playerTurns){
        shistory = '['+shistory+']';
        shistory = shistory.replace(new RegExp('@', 'g'),',');
        var history = JSON.parse(shistory);
        if (playerTurns && playerTurns.length != 0){
            if (playerTurns.length == 1)
                playerTurns = playerTurns[0];
            history.push(playerTurns);
        }
        if (this.client.opts.newGameFormat){
            var current = this.currentRoom.current,
                newHistory = [],
                times = {}, // contain users total time
                turnTime = this.currentRoom.turnTime,
                totalTime = 0,
                self = this;
            for (var i = 0; i < history.length; i++){
                newHistory = newHistory.concat(parseTurn(history[i]));
                if (newHistory[i] instanceof Turn || (newHistory[i] instanceof GameEvent && newHistory[i].event.type == 'timeout')){
                    // init user time
                    // userTurnTime - time remain for turn, userTime - time user turn
                    // clear first turn time; first turn time = turn time - round start time
                    if (this.currentRoom.timeStartMode != 'after_round_start' && $.isEmptyObject(times)){
                        newHistory[i].userTime = 0;
                    }
                    newHistory[i].userTime = newHistory[i].userTime || 0;
                    if (newHistory[i].userTime != null){
                        totalTime += newHistory[i].userTime;
                        if (this.currentRoom.timeMode == 'dont_reset'){ // blitz
                            newHistory[i].userTime = new Time((times[newHistory[i].user.userId] || turnTime) - newHistory[i].userTime || turnTime, turnTime);
                            newHistory[i].userTotalTime = new Time(times[newHistory[i].user.userId] || turnTime, turnTime);

                            // turn contain time for turn for next player
                            newHistory[i].userTurnTime =  newHistory[i].userTurnTime < 0 ? 0 : newHistory[i].userTurnTime;
                            if (newHistory[i].nextPlayer){
                                times[newHistory[i].nextPlayer.userId] = newHistory[i].userTurnTime
                            } else {
                                times[newHistory[i].user.userId] = newHistory[i].userTurnTime
                            }
                        } else {
                            times[newHistory[i].user.userId] = times[newHistory[i].user.userId] ? times[newHistory[i].user.userId] + newHistory[i].userTime : newHistory[i].userTime;
                            newHistory[i].userTotalTime = new Time(times[newHistory[i].user.userId] || 0);
                            newHistory[i].userTime = new Time(newHistory[i].userTime);
                        }
                    }
                }
            }
            history = newHistory;
        }

        function parseTurn(turn){
            // parse array of user turns
            if (turn.length){
                for (var j = 0; j < turn.length; j++){
                    turn[j] = parseTurn(turn[j]);
                }
            } else { // parse single user turn or game event
                if (turn.type || turn.action == 'timeout'){ // event
                    turn.user = self.getPlayer(turn.user) || undefined;
                    turn.nextPlayer = self.getPlayer(turn.nextPlayer) || undefined;
                    turn.target = self.getPlayer(turn.target) || undefined;
                    turn = new GameEvent(turn);
                } else { // turn
                    turn.nextPlayer = self.getPlayer(turn.nextPlayer) || undefined;
                    turn = new Turn(turn, current, turn.nextPlayer);
                }
                if (turn.nextPlayer){
                    current = turn.nextPlayer;
                }
            }

            return turn;
        }
        return history;
    };

    return GameManager;
});
define('modules/invite_manager',['EE'], function(EE) {
    

    var InviteManager = function(client){
        var self = this;

        this.client = client;
        this.invites = {}; // userId : invite
        this.invite = null;
        this.inviteTimeoutTime = 30;
        this.inviteTimeout = null;
        this.isPlayRandom = false;

        client.userList.on('leave_user', function (user) {
            if (self.invite && self.invite.target == user.userId) {
                self.invite = null;
            }
            self.removeInvite(user.userId);
        });
        client.on('user_relogin', function (user) {
            if (self.invite && self.invite.target == user.userId) {
                self.invite = null;
                user.isInvited = false;
            }
            self.removeInvite(user.userId);
        });
        client.gameManager.on('game_start', function(room){
            if (!room.isPlayer) return;
            self.cancel();
            self.rejectAll();
            self.invite = null;
            self.isPlayRandom = false;
            self.client.viewsManager.userListView._setRandomPlay();
        });
        client.on('disconnected', function(){
            // TODO: clear all;
            clearTimeout(self.inviteTimeout);
            self.invite = null;
            for (var userId in self.invites)
                if (self.invites.hasOwnProperty(userId)){
                    self.removeInvite(userId);
                }
            self.isPlayRandom = false;
            self.client.viewsManager.userListView._setRandomPlay();
        });
        client.on('mode_switch', function(){
            if (self.isPlayRandom){
                self.playRandom(true);
            }
        });
    };

    InviteManager.prototype  = new EE();


    InviteManager.prototype.onMessage = function(message){
        console.log('invite_manager;', 'message', message);
        switch (message.type) {
            case 'invite': this.onInvite(message.data); break;
            case 'reject': this.onReject(message.data.target, message.data.from, 'rejected'); break;
            case 'cancel': this.onCancel(message.data); break;
            case 'random_wait': this.client.userList.onWaiting(message.data); break;
            case 'random_cancel': this.client.userList.onWaiting(message.data); break;
        }
    };


    InviteManager.prototype.onInvite = function(invite){
        //TODO: CHECK INVITE AVAILABLE
        this.invites[invite.from] = invite;

        if (this.client.settings.disableInvite || this.client.settings.blacklist[invite.from]){
            this.reject(invite.from);
            return;
        }

        if (this.isPlayRandom && this.client.currentMode == invite.mode) {
            console.log('invite_manager;', 'auto accept invite', invite);
            this.accept(invite.from);
            return;
        }

        this.emit('new_invite', {
            from: this.client.getUser(invite.from),
            data: invite
        });
    };


    InviteManager.prototype.onReject = function(userId, senderId, reason){
        console.log('invite_manger;', 'onReject', this.invite, 'reason');
        if (this.invite.target == userId && this.client.getPlayer().userId == senderId){
            if ((Date.now() - this.inviteTime)/1000 > this.inviteTimeoutTime - 1) reason = 'timeout';
            this.emit('reject_invite', {user:this.client.userList.getUser(userId), reason:reason});
            this.invite = null;
            clearTimeout(this.inviteTimeout);
        } else {
            console.warn('invite_manager; ', 'wrong user reject invite', userId, senderId);
        }
    };


    InviteManager.prototype.onCancel = function(invite){
        console.log('invite_manger;', 'onCancel', invite);
        if (this.invites[invite.from]){
            this.emit('cancel_invite', this.invites[invite.from]);
            this.removeInvite(invite.from);
        }
    };


    InviteManager.prototype.sendInvite = function(userId, params) {
        if (!this.client.gameManager.enableGames){
            this.client.viewsManager.dialogsView.showDialog('новые игры временно отключены',{}, true, false, false);
            return;
        }
        // find user, get current params, send invite and emit event invite sand // params.gameType;
        if (this.client.gameManager.inGame()){
            console.warn('You are already in game!');
            return;
        }
        if (!userId){
            console.warn('invite_manager; ', 'wrong userId to send invite', userId);
            return;
        }
        if (this.invite){
            this.cancel();
        }
        params = params || {};
        if (params.mode){
            console.error('invite param mode is reserved!');
            return;
        }
        params.mode = this.client.currentMode;
        params.target = userId;
        this.invite = params;
        this.inviteTime = Date.now();
        this.client.send('invite_manager', 'invite', userId, this.invite);
        this.inviteTimeout = setTimeout(function(){
            if (this.invite) {
                this.client.send('invite_manager', 'cancel', this.invite.target, this.invite);
                this.onReject(this.invite.target, this.client.getPlayer().userId, 'timeout');
            }
        }.bind(this), this.inviteTimeoutTime * 1000);
    };


    InviteManager.prototype.accept = function(userId){
        if (this.client.gameManager.inGame()){
            console.warn('You are already in game!');
            return;
        }
        if (this.invites[userId]){
            var invite = this.invites[userId];
            delete this.invites[userId];
            this.cancel();
            this.rejectAll();
            this.client.send('invite_manager', 'accept', userId, invite);
        }
    };


    InviteManager.prototype.reject = function(userId){
        if (this.invites[userId]){
            this.client.send('invite_manager', 'reject', userId, this.invites[userId]);
            this.removeInvite(userId);
        }
    };


    InviteManager.prototype.rejectAll = function() {
        for (var userId in this.invites)
            if (this.invites.hasOwnProperty(userId)){
                this.client.send('invite_manager', 'reject', userId, this.invites[userId]);
                this.removeInvite(userId);
            }
    };


    InviteManager.prototype.cancel = function(){
        console.log('invite_manger;', 'cancel', this.invite);
        if (this.invite) {
            this.client.send('invite_manager', 'cancel', this.invite.target, this.invite);
            this.invite = null;
            clearTimeout(this.inviteTimeout);
        }
    };


    InviteManager.prototype.removeInvite = function(userId){
        console.log('invite_manger;', 'removeInvite', userId);
        if (this.invites[userId]){
            this.emit('remove_invite', this.invites[userId]);
            clearInterval(this.invites[userId]);
            delete this.invites[userId];
        }
    };


    InviteManager.prototype.playRandom = function(cancel){
        if (!this.client.isLogin) return;
        if (!this.client.gameManager.enableGames && !cancel){
            this.client.viewsManager.dialogsView.showDialog('новые игры временно отключены',{}, true, false, false);
            return;
        }
        if (this.client.gameManager.inGame()){
            console.warn('You are already in game!');
            return;
        }

        if (!cancel){
            for (var userId in this.invites){
                if (this.invites[userId].mode == this.client.currentMode){
                    console.log('invite_manager;', 'auto accept invite', this.invites[userId]);
                    this.accept(userId);
                    return;
                }

            }
            this.isPlayRandom = true;
            var params = this.client.opts.getUserParams == 'function'?this.client.opts.getUserParams():{};
            if (params.mode){
                console.error('invite param mode is reserved!');
                return;
            }
            params.mode = this.client.currentMode;
            this.client.send('invite_manager', 'random', 'server', params);
        } else {
            this.isPlayRandom = false;
            this.client.send('invite_manager', 'random', 'server', 'off');
            this.client.viewsManager.userListView._setRandomPlay();
        }
    };

    return InviteManager;
});
define('translit',['module'], function (module) {
    
    var dict = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
        'з': 'z', 'и': 'i', 'й': 'j', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n',
        'о': 'o', 'п': 'p', 'р': 'r','с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h',
        'ц': 'c', 'ч': 'ch', 'ш': 'sh', 'щ': 'sh','ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
    };
    var Translit = function (text) {
        if (typeof text != "string" || !text.length) return text;
        var result = '', char;
        for (var i = 0; i < text.length; i++) {
            char = text[i];
            if (dict[char] != null ) {
                result += dict[char];
            } else
                if (dict[char.toLowerCase()] != null){
                    result += dict[char.toLowerCase()].toUpperCase();
                }
            else {
                result += char;
            }
        }
        return result;
    };

    Translit.test = function(){
        var text = 'Съешь Ещё Этих мягких Французских булок, да выпей Же чаю';
        console.log('translit text before: ', text);
        console.log('translit text after: ', Translit(text));
    };

    return Translit;
});

define('modules/user_list',['EE', 'translit'], function(EE, translit) {
    

    var UserList = function(client){
        var self = this;

        this.client = client;
        this.users = [];
        this.rooms = [];
        this.waiting = {};

        client.on('disconnected', function(){
            this.rooms = [];
            this.users = [];
            this.waiting = {};
        }.bind(this));
        client.gameManager.on('round_end', function(data){
            if (data.ratings && data.mode){
                for (var userId in data.ratings){
                    for (var i = 0; i < self.users.length; i++){
                        if(self.users[i].userId == userId) {
                            self.users[i][data.mode] = data.ratings[userId];
                        }
                    }
                }
                this.emit('update', data);
            }
        });
    };

    UserList.prototype  = new EE();


    UserList.prototype.onMessage = function(message){
        switch (message.type){
            case 'user_login': this.onUserLogin(message.data); break;
        }
    };


    UserList.prototype.onUserLogin = function(data, fIsPlayer){
        var user = new User(data, fIsPlayer, this.client);
        if (fIsPlayer) this.player = user;
        for (var i = 0; i < this.users.length; i++){
            if(this.users[i].userId == user.userId) {
                console.warn('user_list;', 'user already in list!', user);
                return false;
            }
        }
        if (this.client.opts.showCheaters) {
            for (var i = 0; i < this.client.modes.length; i++)
                if (user[this.client.modes[i]].timeLastCheatGame){
                    user.userName = 'cheater!' + user.userName;
                    break;
                }
        }
        this.users.push(user);
        this.emit('new_user', user);
    };


    UserList.prototype.onUserLeave = function(userId){
        for (var i = 0; i < this.users.length; i++) {
            if (this.users[i].userId == userId){
                var user = this.users[i];
                this.users.splice(i, 1);
                this.removeWaiting(user);
                this.emit('leave_user', user);
                return;
            }
        }
        console.warn('user_list;', 'onUserLeave; no user in list', userId);
    };


    UserList.prototype.onGameStart = function(roomId, players, mode){
        for (var i = 0; i < players.length; i++){
            players[i] = this.getUser(players[i]);
            players[i].isInRoom = true;
            this.removeWaiting(players[i]);
        }
        var room = {
            room:roomId, players: players, mode: mode
        };
        this.rooms.push(room);
        this.emit('new_room',room);
    };


    UserList.prototype.onGameEnd = function(roomId, players){
        for (var i = 0; i < this.rooms.length; i++) {
            if (this.rooms[i].room == roomId){
                var room = this.rooms[i];
                this.rooms.splice(i, 1);
                for (var j = 0; j < room.players.length; j++){
                    room.players[j].isInRoom = false;
                }
                this.emit('close_room', room);
                return;
            }
        }
        console.warn('user_list;', 'onGameEnd; no room in list', roomId, players);
    };


    UserList.prototype.onUserChanged = function(userData){
        for (var i = 0; i < this.users.length; i++){
            if (this.users[i].userId == userData.userId){
                this.users[i].update(userData);
                if (!this.users[i].isPlayer) console.log('user_changed!', userData.isActive, userData);
                if (this.client.opts.showCheaters) {
                    for (var j = 0; j < this.client.modes.length; j++)
                        if (this.users[i][this.client.modes[j]].timeLastCheatGame){
                            this.users[i].userName = 'cheater!' + this.users[i].userName;
                            break;
                        }
                }
                this.emit('user_changed', this.users[i]);
                return;
            }
        }
        console.warn('user_list;', 'onUserChanged; no user in list', userData)
    };


    UserList.prototype.getUser = function(id){
        for (var i = 0; i < this.users.length; i++)
            if (this.users[i].userId == id) return this.users[i];
        return null;
    };


    UserList.prototype.getUsers = function() {
        var invite = this.client.inviteManager.invite;
        if (invite) { // mark invited user
            return _.map(this.users, function(usr) {
                if (usr.userId === invite.target) {
                    usr.isInvited = true;
                }
                return usr;
            });
        } else {
            return this.users;
        }
    };


    UserList.prototype.getUserList = function(filter) {
        var userList = [], invite = this.client.inviteManager.invite, user,
            sort = this.client.opts.showRank == 'place' ? 1 : -1;
        for (var i = 0; i < this.users.length; i++){
            user = this.users[i];
            if (invite && user.userId == invite.target) { // user is invited
                user.isInvited = true;
            } else delete user.isInvited;
            user.waiting = (this.waiting && this.waiting[this.client.currentMode] == user);
            if (user.isInRoom) continue;
            if (this.client.settings.blacklist[user.userId] && !user.waiting) continue;
            if (!user.isPlayer && !user.waiting && (!this.client.opts.showHidden && (user.disableInvite || !user.isActive))) continue;
            if (filter && user.userName.toLowerCase().indexOf(filter) == -1) continue;
            else userList.push(user);
        }

        userList.sort(function(a, b){
            // sort by rank or time login
            // player always is first
            var ar = a.getRank();
            if (isNaN(+ar)) {
                ar = a.timeLogin;
                if (a.isPlayer) {
                    sort == 1 ? ar = 99999998 : ar += 0.1;
                }
            }
            var br = b.getRank();
            if (isNaN(+br)) {
                br = b.timeLogin;
                if (b.isPlayer) {
                    sort == 1 ? ar = 99999998 : ar += 0.1;
                }
            }
            return sort == 1 ? ar - br : br - ar;
        });

        return userList;
    };


    UserList.prototype.getFreeUserList = function() {
        var userList = [], invite = this.client.inviteManager.invite, user;
        for (var i = 0; i < this.users.length; i++){
            user = this.users[i];
            if (user.isPlayer){
                continue;
            }
            if (invite && user.userId == invite.target) { // user is invited
                continue;
            }
            if (user.isInRoom) {
                continue;
            }
            userList.push(user);
        }
        return userList;
    };


    UserList.prototype.getRoomList = function(filter) {
        var rooms = [], room, client = this.client;
        for (var i = 0; i < this.rooms.length; i++) {
            room = this.rooms[i];
            // check room is current
            room.current = (this.client.gameManager.currentRoom && this.client.gameManager.currentRoom.id == room.room);
            if (!filter) {
                rooms.push(room);
            } else { // find user by filter in room
                for (var j = 0; j < room.players.length; j++) {
                    if (room.players[j].userName.toLowerCase().indexOf(filter) != -1) {
                        rooms.push(room);
                        break;
                    }
                }
            }
        }

        rooms.sort(function(a, b){
            var ar, br;
            if (a.mode != b.mode){
                ar = client.modes.indexOf(a.mode);
                br = client.modes.indexOf(b.mode);
            } else {
                ar = UserList.getRoomRank(a);
                br = UserList.getRoomRank(b);
            }
            return ar - br;
        });

        return rooms;
    };


    UserList.prototype.getSpectatorsList = function(filter) {
        var spectators = [];
        if (this.client.gameManager.currentRoom && this.client.gameManager.currentRoom.spectators.length) {
            var user, invite = this.client.inviteManager.invite;
            for (var i = 0; i < this.client.gameManager.currentRoom.spectators.length; i++) {
                user = this.client.gameManager.currentRoom.spectators[i];
                if (invite && user.userId == invite.target) { // user is invited
                    user.isInvited = true;
                } else {
                    delete user.isInvited;
                }
                if (!filter || user.userName.toLowerCase().indexOf(filter) != -1) {
                    spectators.push(user);
                }
            }
        }

        return spectators;
    };


    UserList.prototype.onWaiting = function(waiting){
        if (!waiting) return;
        var user;
        for (var mode in waiting){
            user = waiting[mode];
            if (user) {
                user = this.getUser(user);
                if (user){
                    this.waiting[mode] = user;
                } else {
                    console.error('waiting user no in list', waiting[mode], mode);
                }
            } else {
                this.waiting[mode] = null;
            }
        }
        this.emit('waiting', this.waiting);
    };


    UserList.prototype.removeWaiting = function(user) {
        if (this.waiting) {
            for (var mode in this.waiting) {
                if (this.waiting[mode] == user){
                    this.waiting[mode] = null;
                }
            }
        }
    };


    UserList.getRoomRank = function(room) {
        if (room.players.length) {
            return Math.min(room.players[0].getNumberRank(room.mode), room.players[1].getNumberRank(room.mode))
        }
        return 0;
    };


    UserList.prototype.createUser = function(data) {
        if (!data.userId || !data.userName){
            console.error('user_list;', 'wrong data for User', data);
        }
        return new User(data, data.userId == this.player.userId, this.client);
    };


    function User(data, fIsPlayer, client){
        if (!data || !data.userId || !data.userName) throw new Error("wrong user data!");
        for (var key in data){
            if (data.hasOwnProperty(key)) this[key] = data[key];
        }

        this.isPlayer = fIsPlayer || false;
        this.disableInvite = data.disableInvite || false;
        this.isActive  = (typeof data.isActive == 'boolean' ? data.isActive : true); // true default
        this.fullName = this.userName;
        this.timeLogin = Date.now();

        if (client.opts.shortGuestNames && this.userName.substr(0,6) == 'Гость ' &&  this.userName.length > 11){
            var nameNumber = this.userName.substr(6,1) + '..' + this.userName.substr(this.userName.length-2, 2);
            this.userName = 'Гость ' + nameNumber;
        }

        if (client.lang != 'ru') {
            this.userName = translit(this.userName)
        }

        this.getRank = function (mode) {
            if (this._client.opts.showRank == 'place') {
                return this[mode || this._client.currentMode].rank || '—';
            } else {
                return this[mode || this._client.currentMode].ratingElo || 1600;
            }
        };

        this.getNumberRank = function(mode) {
            return this[mode||this._client.currentMode].rank || Number.POSITIVE_INFINITY;
        };

        this.update = function(data) {
            for (var key in data){
                if (data.hasOwnProperty(key)) this[key] = data[key];
            }
            this.disableInvite = data.disableInvite || false;
            if (typeof data.isActive == 'boolean') this.isActive  = data.isActive;

            if (this._client.opts.shortGuestNames && this.userName.substr(0,6) == 'Гость ' &&  this.userName.length > 11){
                var nameNumber = this.userName.substr(6,1) + '..' + this.userName.substr(this.userName.length-2, 2);
                this.userName = 'Гость ' + nameNumber;
            }
        };

        this._client = client;
    }

    return UserList;
});
define('modules/socket',['EE'], function(EE) {
    

    var Socket = function(opts){
        opts = opts || {};
        this.port = opts.port||'8080';
        this.domain = opts.domain || document.domain;
        if (this.domain.substr(0,4) == 'www.'){
            this.domain = this.domain.substr(4);
        }
        this.game = opts.game||"test";
        this.prefix = 'ws/';
        this.url = opts.url || this.game;
        this.https = opts.https || false;
        if (this.domain == "test.logic-games.spb.ru") this.domain = "logic-games.spb.ru";
        if (this.domain != 'logic-games.spb.ru') this.https = false;
        this.protocol = (this.https?'wss':'ws');
        this.connectionCount = 0;

        this.isConnecting = true;
        this.isConnected = false;
        this.reconnectTimeout = null;
        this.timeOutInterval = 100000
    };

    Socket.prototype  = new EE();


    Socket.prototype.init = function(){
        var self = this;
        this.isConnecting = true;
        this.isConnected = false;
        this.timeConnection = this.timeLastMessage = Date.now();
        this.connectionCount++;

        try{
            //// TODO: test config, remove this
            //if (window.location.hostname == "test.logic-games.spb.ru" && this.url != "domino"){
            //    this.ws = new WebSocket (this.protocol + '://' + this.domain + '/' + this.prefix + this.url);
            //}
            //else
                this.ws = new WebSocket (this.protocol + '://' + this.domain + ':' + this.port+'/' + this.url);

            this.ws.onclose = function (code, message) {
                console.log('socket;', 'ws closed', code, message);
                if (self.isConnected) self.onDisconnect();
            };

            this.ws.onerror = function (error) {
                self.onError(error);
            };

            this.ws.onmessage = function (data, flags) {
                clearTimeout(self.reconnectTimeout);
                self.reconnectTimeout = setTimeout(function(){
                    if (Date.now() - self.timeLastMessage >= self.timeOutInterval){
                        console.log('socket;', 'ws timeout', Date.now() - self.timeLastMessage);
                        self.ws.close();
                        self.onDisconnect();
                    }
                }, self.timeOutInterval);
                self.timeLastMessage = Date.now();

                if (data.data == 'ping') {
                    self.ws.send('pong');
                    return;
                }
                console.log('socket;', 'ws message', data, flags);
                try{
                    data = JSON.parse(data.data)
                } catch (e) {
                    console.log('socket;', 'ws wrong data in message', e);
                    return;
                }

                self.onMessage(data);
            };

            this.ws.onopen = function () {
                console.log('socket;', new Date(), 'ws open');
                self.onConnect();
            };

        } catch (error) {
            console.log('socket;', 'ws open error');
            this.onError(error);
        }


    };

    Socket.prototype.onError = function(error){
        console.log('socket;', 'ws error', error);
        if (this.isConnecting){
            this.isConnecting = false;
            console.log('socket;', "ws connection failed!");
            this.onConnectionFailed();
        }
    };


    Socket.prototype.onConnect = function(){
        this.isConnected = true;
        this.connectionCount = 0;
        this.emit("connection");
    };


    Socket.prototype.onDisconnect = function(){
        this.isConnected = false;
        this.emit("disconnection");
    };


    Socket.prototype.onMessage = function(data){
        this.emit("message", data);
    };


    Socket.prototype.onConnectionFailed = function(){
        this.isConnecting = false;
        this.isConnected = false;
        this.emit("failed");
    };


    Socket.prototype.send = function (data) {
        try{
            data = JSON.stringify(data);
        } catch (error){
            console.warn('socket;', "json stringify err", data, error);
            return;
        }
        this.ws.send(data);
    };

    return Socket;
});
/**
 * @license RequireJS text 2.0.12 Copyright (c) 2010-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/requirejs/text for details
 */
/*jslint regexp: true */
/*global require, XMLHttpRequest, ActiveXObject,
  define, window, process, Packages,
  java, location, Components, FileUtils */

define('text',['module'], function (module) {
    

    var text, fs, Cc, Ci, xpcIsWindows,
        progIds = ['Msxml2.XMLHTTP', 'Microsoft.XMLHTTP', 'Msxml2.XMLHTTP.4.0'],
        xmlRegExp = /^\s*<\?xml(\s)+version=[\'\"](\d)*.(\d)*[\'\"](\s)*\?>/im,
        bodyRegExp = /<body[^>]*>\s*([\s\S]+)\s*<\/body>/im,
        hasLocation = typeof location !== 'undefined' && location.href,
        defaultProtocol = hasLocation && location.protocol && location.protocol.replace(/\:/, ''),
        defaultHostName = hasLocation && location.hostname,
        defaultPort = hasLocation && (location.port || undefined),
        buildMap = {},
        masterConfig = (module.config && module.config()) || {};

    text = {
        version: '2.0.12',

        strip: function (content) {
            //Strips <?xml ...?> declarations so that external SVG and XML
            //documents can be added to a document without worry. Also, if the string
            //is an HTML document, only the part inside the body tag is returned.
            if (content) {
                content = content.replace(xmlRegExp, "");
                var matches = content.match(bodyRegExp);
                if (matches) {
                    content = matches[1];
                }
            } else {
                content = "";
            }
            return content;
        },

        jsEscape: function (content) {
            return content.replace(/(['\\])/g, '\\$1')
                .replace(/[\f]/g, "\\f")
                .replace(/[\b]/g, "\\b")
                .replace(/[\n]/g, "\\n")
                .replace(/[\t]/g, "\\t")
                .replace(/[\r]/g, "\\r")
                .replace(/[\u2028]/g, "\\u2028")
                .replace(/[\u2029]/g, "\\u2029");
        },

        createXhr: masterConfig.createXhr || function () {
            //Would love to dump the ActiveX crap in here. Need IE 6 to die first.
            var xhr, i, progId;
            if (typeof XMLHttpRequest !== "undefined") {
                return new XMLHttpRequest();
            } else if (typeof ActiveXObject !== "undefined") {
                for (i = 0; i < 3; i += 1) {
                    progId = progIds[i];
                    try {
                        xhr = new ActiveXObject(progId);
                    } catch (e) {}

                    if (xhr) {
                        progIds = [progId];  // so faster next time
                        break;
                    }
                }
            }

            return xhr;
        },

        /**
         * Parses a resource name into its component parts. Resource names
         * look like: module/name.ext!strip, where the !strip part is
         * optional.
         * @param {String} name the resource name
         * @returns {Object} with properties "moduleName", "ext" and "strip"
         * where strip is a boolean.
         */
        parseName: function (name) {
            var modName, ext, temp,
                strip = false,
                index = name.indexOf("."),
                isRelative = name.indexOf('./') === 0 ||
                             name.indexOf('../') === 0;

            if (index !== -1 && (!isRelative || index > 1)) {
                modName = name.substring(0, index);
                ext = name.substring(index + 1, name.length);
            } else {
                modName = name;
            }

            temp = ext || modName;
            index = temp.indexOf("!");
            if (index !== -1) {
                //Pull off the strip arg.
                strip = temp.substring(index + 1) === "strip";
                temp = temp.substring(0, index);
                if (ext) {
                    ext = temp;
                } else {
                    modName = temp;
                }
            }

            return {
                moduleName: modName,
                ext: ext,
                strip: strip
            };
        },

        xdRegExp: /^((\w+)\:)?\/\/([^\/\\]+)/,

        /**
         * Is an URL on another domain. Only works for browser use, returns
         * false in non-browser environments. Only used to know if an
         * optimized .js version of a text resource should be loaded
         * instead.
         * @param {String} url
         * @returns Boolean
         */
        useXhr: function (url, protocol, hostname, port) {
            var uProtocol, uHostName, uPort,
                match = text.xdRegExp.exec(url);
            if (!match) {
                return true;
            }
            uProtocol = match[2];
            uHostName = match[3];

            uHostName = uHostName.split(':');
            uPort = uHostName[1];
            uHostName = uHostName[0];

            return (!uProtocol || uProtocol === protocol) &&
                   (!uHostName || uHostName.toLowerCase() === hostname.toLowerCase()) &&
                   ((!uPort && !uHostName) || uPort === port);
        },

        finishLoad: function (name, strip, content, onLoad) {
            content = strip ? text.strip(content) : content;
            if (masterConfig.isBuild) {
                buildMap[name] = content;
            }
            onLoad(content);
        },

        load: function (name, req, onLoad, config) {
            //Name has format: some.module.filext!strip
            //The strip part is optional.
            //if strip is present, then that means only get the string contents
            //inside a body tag in an HTML string. For XML/SVG content it means
            //removing the <?xml ...?> declarations so the content can be inserted
            //into the current doc without problems.

            // Do not bother with the work if a build and text will
            // not be inlined.
            if (config && config.isBuild && !config.inlineText) {
                onLoad();
                return;
            }

            masterConfig.isBuild = config && config.isBuild;

            var parsed = text.parseName(name),
                nonStripName = parsed.moduleName +
                    (parsed.ext ? '.' + parsed.ext : ''),
                url = req.toUrl(nonStripName),
                useXhr = (masterConfig.useXhr) ||
                         text.useXhr;

            // Do not load if it is an empty: url
            if (url.indexOf('empty:') === 0) {
                onLoad();
                return;
            }

            //Load the text. Use XHR if possible and in a browser.
            if (!hasLocation || useXhr(url, defaultProtocol, defaultHostName, defaultPort)) {
                text.get(url, function (content) {
                    text.finishLoad(name, parsed.strip, content, onLoad);
                }, function (err) {
                    if (onLoad.error) {
                        onLoad.error(err);
                    }
                });
            } else {
                //Need to fetch the resource across domains. Assume
                //the resource has been optimized into a JS module. Fetch
                //by the module name + extension, but do not include the
                //!strip part to avoid file system issues.
                req([nonStripName], function (content) {
                    text.finishLoad(parsed.moduleName + '.' + parsed.ext,
                                    parsed.strip, content, onLoad);
                });
            }
        },

        write: function (pluginName, moduleName, write, config) {
            if (buildMap.hasOwnProperty(moduleName)) {
                var content = text.jsEscape(buildMap[moduleName]);
                write.asModule(pluginName + "!" + moduleName,
                               "define(function () { return '" +
                                   content +
                               "';});\n");
            }
        },

        writeFile: function (pluginName, moduleName, req, write, config) {
            var parsed = text.parseName(moduleName),
                extPart = parsed.ext ? '.' + parsed.ext : '',
                nonStripName = parsed.moduleName + extPart,
                //Use a '.js' file name so that it indicates it is a
                //script that can be loaded across domains.
                fileName = req.toUrl(parsed.moduleName + extPart) + '.js';

            //Leverage own load() method to load plugin value, but only
            //write out values that do not have the strip argument,
            //to avoid any potential issues with ! in file names.
            text.load(nonStripName, req, function (value) {
                //Use own write() method to construct full module value.
                //But need to create shell that translates writeFile's
                //write() to the right interface.
                var textWrite = function (contents) {
                    return write(fileName, contents);
                };
                textWrite.asModule = function (moduleName, contents) {
                    return write.asModule(moduleName, fileName, contents);
                };

                text.write(pluginName, nonStripName, textWrite, config);
            }, config);
        }
    };

    if (masterConfig.env === 'node' || (!masterConfig.env &&
            typeof process !== "undefined" &&
            process.versions &&
            !!process.versions.node &&
            !process.versions['node-webkit'])) {
        //Using special require.nodeRequire, something added by r.js.
        fs = require.nodeRequire('fs');

        text.get = function (url, callback, errback) {
            try {
                var file = fs.readFileSync(url, 'utf8');
                //Remove BOM (Byte Mark Order) from utf8 files if it is there.
                if (file.indexOf('\uFEFF') === 0) {
                    file = file.substring(1);
                }
                callback(file);
            } catch (e) {
                if (errback) {
                    errback(e);
                }
            }
        };
    } else if (masterConfig.env === 'xhr' || (!masterConfig.env &&
            text.createXhr())) {
        text.get = function (url, callback, errback, headers) {
            var xhr = text.createXhr(), header;
            xhr.open('GET', url, true);

            //Allow plugins direct access to xhr headers
            if (headers) {
                for (header in headers) {
                    if (headers.hasOwnProperty(header)) {
                        xhr.setRequestHeader(header.toLowerCase(), headers[header]);
                    }
                }
            }

            //Allow overrides specified in config
            if (masterConfig.onXhr) {
                masterConfig.onXhr(xhr, url);
            }

            xhr.onreadystatechange = function (evt) {
                var status, err;
                //Do not explicitly handle errors, those should be
                //visible via console output in the browser.
                if (xhr.readyState === 4) {
                    status = xhr.status || 0;
                    if (status > 399 && status < 600) {
                        //An http 4xx or 5xx error. Signal an error.
                        err = new Error(url + ' HTTP status: ' + status);
                        err.xhr = xhr;
                        if (errback) {
                            errback(err);
                        }
                    } else {
                        callback(xhr.responseText);
                    }

                    if (masterConfig.onXhrComplete) {
                        masterConfig.onXhrComplete(xhr, url);
                    }
                }
            };
            xhr.send(null);
        };
    } else if (masterConfig.env === 'rhino' || (!masterConfig.env &&
            typeof Packages !== 'undefined' && typeof java !== 'undefined')) {
        //Why Java, why is this so awkward?
        text.get = function (url, callback) {
            var stringBuffer, line,
                encoding = "utf-8",
                file = new java.io.File(url),
                lineSeparator = java.lang.System.getProperty("line.separator"),
                input = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(file), encoding)),
                content = '';
            try {
                stringBuffer = new java.lang.StringBuffer();
                line = input.readLine();

                // Byte Order Mark (BOM) - The Unicode Standard, version 3.0, page 324
                // http://www.unicode.org/faq/utf_bom.html

                // Note that when we use utf-8, the BOM should appear as "EF BB BF", but it doesn't due to this bug in the JDK:
                // http://bugs.sun.com/bugdatabase/view_bug.do?bug_id=4508058
                if (line && line.length() && line.charAt(0) === 0xfeff) {
                    // Eat the BOM, since we've already found the encoding on this file,
                    // and we plan to concatenating this buffer with others; the BOM should
                    // only appear at the top of a file.
                    line = line.substring(1);
                }

                if (line !== null) {
                    stringBuffer.append(line);
                }

                while ((line = input.readLine()) !== null) {
                    stringBuffer.append(lineSeparator);
                    stringBuffer.append(line);
                }
                //Make sure we return a JavaScript string and not a Java string.
                content = String(stringBuffer.toString()); //String
            } finally {
                input.close();
            }
            callback(content);
        };
    } else if (masterConfig.env === 'xpconnect' || (!masterConfig.env &&
            typeof Components !== 'undefined' && Components.classes &&
            Components.interfaces)) {
        //Avert your gaze!
        Cc = Components.classes;
        Ci = Components.interfaces;
        Components.utils['import']('resource://gre/modules/FileUtils.jsm');
        xpcIsWindows = ('@mozilla.org/windows-registry-key;1' in Cc);

        text.get = function (url, callback) {
            var inStream, convertStream, fileObj,
                readData = {};

            if (xpcIsWindows) {
                url = url.replace(/\//g, '\\');
            }

            fileObj = new FileUtils.File(url);

            //XPCOM, you so crazy
            try {
                inStream = Cc['@mozilla.org/network/file-input-stream;1']
                           .createInstance(Ci.nsIFileInputStream);
                inStream.init(fileObj, 1, 0, false);

                convertStream = Cc['@mozilla.org/intl/converter-input-stream;1']
                                .createInstance(Ci.nsIConverterInputStream);
                convertStream.init(inStream, "utf-8", inStream.available(),
                Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

                convertStream.readString(inStream.available(), readData);
                convertStream.close();
                inStream.close();
                callback(readData.value);
            } catch (e) {
                throw new Error((fileObj && fileObj.path || '') + ': ' + e);
            }
        };
    }
    return text;
});


define('text!tpls/v6-userListFree.ejs',[],function () { return '<% _.each(users, function(user) { %>\r\n<tr class="userListFree <%= user.isActive?\'\':\'userListInactive\' %> <%= user.waiting?\'userListWaiting\':\'\' %> <%= user.isPlayer?\'userListPlayer\':\'\' %>">\r\n    <td class="userName"\r\n        data-userId="<%= user.userId %>"\r\n        data-userName="<%= user.userName %>"\r\n        title="<%= user.userName%>"\r\n    > <%= user.userName %> </td>\r\n    <td class="userRank"><%= user.getRank() %></td>\r\n    <% if (user.isPlayer) { %>\r\n    <td class="userListPlayerInvite">\r\n        <% if (user.disableInvite ) { %>\r\n        <img src="<%= imgBlock %>" title="<%= locale.disableInvite %>" >\r\n        <% } %>\r\n    </td>\r\n    <% } else if (user.isInvited) { %>\r\n    <td class="inviteBtn activeInviteBtn" data-userId="<%= user.userId %>"><%= locale.buttons.cancel %></td>\r\n    <% } else {\r\n        if (!user.waiting && user.disableInvite) { %>\r\n        <td class="userListUserInvite"><img src="<%= imgBlock %>" title="<%= locale.playerDisableInvite %>"></td>\r\n        <% } else { %>\r\n            <td class="inviteBtn" data-userId="<%= user.userId %>"><%= locale.buttons.invite %></td>\r\n        <% }\r\n    } %>\r\n</tr>\r\n<% }) %>';});


define('text!tpls/v6-userListInGame.ejs',[],function () { return '<%\r\n    var mode;\r\n_.each(rooms, function(room) {\r\n    if (showModes && room.mode != mode && modes[room.mode] ) {\r\n    window.console.log(mode, room.mode, room.room, room.mode != mode)\r\n        mode = room.mode;\r\n%>\r\n        <tr class="userListGameMode"><td colspan="3"><%= modes[mode] %></td></tr>\r\n<%}%>\r\n<tr class="userListGame <%= room.current ? \'currentGame\' : \'\' %>" data-id="<%= room.room %>">\r\n    <td>\r\n        <span class="userName" title="<%= room.players[0].userName + \' (\' +  room.players[0].getRank(room.mode) + \')\' %>">\r\n            <%= room.players[0].userName %>\r\n        </span>\r\n    </td>\r\n    <td>:</td>\r\n    <td>\r\n        <span class="userName" title="<%= room.players[1].userName + \' (\' +  room.players[1].getRank(room.mode) + \')\' %>">\r\n            <%= room.players[1].userName %>\r\n        </span>\r\n    </td>\r\n</tr>\r\n<% }) %>';});


define('text!tpls/v6-userListMain.ejs',[],function () { return '<div class="tabs notInGame">\r\n    <div data-type="free"> <%= tabs.free %> <span></span></div>\r\n    <div data-type="inGame"> <%= tabs.inGame %>  <span></span></div>\r\n    <div data-type="spectators" style="display: none"> <%= tabs.spectators %>  <span></span></div>\r\n</div>\r\n<div id="userListSearch">\r\n    <input type="text" id="filterUserList" placeholder="<%= search %>"/>\r\n    <span class="rankSwitch isActive"><%= rankPlaceShort %></span>\r\n    <span class="rankSlash">/</span>\r\n    <span class="ratingSwitch"><%= ratingShort %></span>\r\n</div>\r\n<div class="tableWrap">\r\n    <table cellspacing="0" class="playerList"></table>\r\n</div>\r\n\r\n<div class="btn" id="randomPlay">\r\n    <span><%= buttons.playRandom %></span>\r\n</div>';});

define('views/user_list',['underscore', 'backbone', 'text!tpls/v6-userListFree.ejs', 'text!tpls/v6-userListInGame.ejs', 'text!tpls/v6-userListMain.ejs'],
    function(_, Backbone, tplFree, tplInGame, tplMain) {
    
    var UserListView = Backbone.View.extend({
        tagName: 'div',
        id: 'userList',
        tplFree: _.template(tplFree),
        tplInGame: _.template(tplInGame),
        tplMain: _.template(tplMain),
        events: {
            'click .inviteBtn': '_inviteBtnClicked',
            'click .userListFree .userName': 'userClick',
            'click .userListGame': 'roomClick',
            'click .tabs div': 'clickTab',
            'click .disconnectButton': '_reconnect',
            'click #randomPlay': 'playClicked',
            'click #userListSearch .rankSwitch': 'switchRankDisplay',
            'click #userListSearch .ratingSwitch': 'switchRankDisplay',
            'keyup #filterUserList': 'filter',
            'mouseenter ': 'mouseEnter',
            'mouseleave ': 'mouseLeave'
        },
        _reconnect: function() {
            this.client.reconnect();
            this.$list.html(this.$loadingTab);
        },
        clickTab: function(e) {
            if (!this.client.socket.isConnected) {
                return;
            }

            var target = $(e.currentTarget),
                clickedTabName = target.attr('data-type');

            if (clickedTabName === this.currentActiveTabName) {
                return;
            }
            this._setActiveTab(clickedTabName);
            this.render();
        },
        userClick: function(e) {
            var target = $(e.currentTarget),
                userId = target.attr('data-userId');
            this.client.viewsManager.v6ChatView.showMenu.bind(this.client.viewsManager.v6ChatView)(e, userId);
            //this.client.onShowProfile(userId);
        },
        roomClick: function(e) {
            var target = $(e.currentTarget),
                roomId = target.attr('data-Id');
            if (roomId) {
                this.$el.find('.userListGame').removeClass('currentGame');
                $(target).addClass('currentGame');
                this.client.gameManager.spectate(roomId);
            } else {
                console.warn('wrong room id', roomId);
            }
        },
        switchRankDisplay: function(e){
            var target = $(e.currentTarget);
            if (target.hasClass('rankSwitch')){
                this.client.opts.showRank = 'place';
            }
            if (target.hasClass('ratingSwitch')){
                this.client.opts.showRank = 'rating';
            }
            this.$el.find('#userListSearch .isActive').removeClass('isActive');
            target.addClass('isActive');
            this.render();
        },
        _inviteBtnClicked: function(e) {
            var target = $(e.currentTarget),
                userId = target.attr('data-userId');
            this.invitePlayer(userId)
        },
        invitePlayer: function(userId) {
            if (this.client.gameManager.inGame()) {
                console.warn('You are already in game!');
                return;
            }

            var target = this.$el.find('.inviteBtn[data-userId="' + userId + '"]');

            if (target.hasClass(this.ACTIVE_INVITE_CLASS)) {
                // cancel invite
                this.client.inviteManager.cancel();
                target.removeClass(this.ACTIVE_INVITE_CLASS);
                target.html(this.locale.buttons.invite);
            } else {
                // send invite
                this.$el.find('.' + this.ACTIVE_INVITE_CLASS).html(this.locale.buttons.invite).removeClass(this.ACTIVE_INVITE_CLASS);
                var params = (typeof this.client.opts.getUserParams == 'function' ? this.client.opts.getUserParams() : {});
                params = $.extend(true, {}, params);
                this.client.inviteManager.sendInvite(userId, params);
                target.addClass(this.ACTIVE_INVITE_CLASS);
                target.html(this.locale.buttons.cancel);
            }
        },
        playClicked: function (e) {
            this.client.inviteManager.playRandom(this.client.inviteManager.isPlayRandom);
            this._setRandomPlay();
        },
        filter: function () {
            this.render();
        },
        mouseEnter: function(){
            this.mouseOver = true
        },
        mouseLeave: function(){
            this.mouseOver = false;
        },

        initialize: function(_client) {
            var bindedRender = this.render.bind(this);
            this.images = _client.opts.images;
            this.client = _client;
            this.locale = _client.locale.userList;
            this.mouseOver = false;

            this.$disconnectedTab = $('<tr class="disconnected"><td><div>' +
                '<span class="disconnectText">' + this.locale.disconnected.text + '</span>' +
                '<br>' +
                '<br>' +
                '<span class="disconnectButton">' + this.locale.disconnected.button + '</span>' +
                '</div></td></tr>');
            this.$loadingTab = $('<tr><td>' + this.locale.disconnected.status + '</td></tr>');
            this.$el.html(this.tplMain(this.locale));
            this.$el.addClass('v6-block-border');

            this.ACTIVE_INVITE_CLASS = 'activeInviteBtn';
            this.ACTIVE_TAB_CLASS = 'activeTab';

            this.TEXT_PLAY_ACTIVE = this.locale.buttons.cancelPlayRandom;
            this.TEXT_PLAY_UNACTIVE = this.locale.buttons.playRandom;

            this.IN_GAME_CLASS = 'inGame';
            this.NOT_IN_GAME_CLASS = 'NotInGame';

            this.$list = this.$el.find('.tableWrap table');
            this.$container = this.$el.find('.tableWrap');
            this.$counterFree = this.$el.find('.tabs div[data-type="free"]').find('span');
            this.$counterinGame = this.$el.find('.tabs div[data-type="inGame"]').find('span');
            this.$counterSpectators = this.$el.find('.tabs div[data-type="spectators"]').find('span');
            this.$btnPlay = this.$el.find('#randomPlay');
            this.$filter = this.$el.find('#filterUserList');
            this.$tabs = this.$el.find('.tabs');

            this.listenTo(this.client.userList, 'new_user', bindedRender);
            this.listenTo(this.client, 'mode_switch', bindedRender);
            this.listenTo(this.client.userList, 'update', bindedRender);
            this.listenTo(this.client.userList, 'leave_user', bindedRender);
            this.listenTo(this.client.inviteManager, 'reject_invite', this.onRejectInvite.bind(this));
            this.listenTo(this.client.userList, 'new_room', bindedRender);
            this.listenTo(this.client.userList, 'close_room', bindedRender);
            this.listenTo(this.client.userList, 'user_changed', bindedRender);
            this.listenTo(this.client.userList, 'waiting', bindedRender);
            this.listenTo(this.client, 'disconnected', bindedRender);
            this.listenTo(this.client, 'user_relogin', bindedRender);
            this.listenTo(this.client.gameManager, 'spectator_join', bindedRender);
            this.listenTo(this.client.gameManager, 'spectator_leave', bindedRender);
            this.listenTo(this.client.gameManager, 'game_start', this.showSpectatorsTab.bind(this));
            this.listenTo(this.client.gameManager, 'game_leave', this.hideSpectatorsTab.bind(this));
            this._setActiveTab('free');
            this.$list.html(this.$loadingTab);
            this.randomPlay = false;
        },
        _setRandomPlay: function(){
            if (this.client.inviteManager.isPlayRandom) {
                this.$btnPlay.html(this.TEXT_PLAY_ACTIVE);
                this.$btnPlay.addClass('active');
            } else {
                this.$btnPlay.html(this.TEXT_PLAY_UNACTIVE);
                this.$btnPlay.removeClass('active');
            }
        },
        showSpectatorsTab: function(){
            if (!this.client.opts.showSpectators) return;
            this.$tabs.removeClass(this.NOT_IN_GAME_CLASS);
            this.$tabs.addClass(this.IN_GAME_CLASS);
            this.$el.find('.tabs div[data-type="' + 'spectators' + '"]').show();
            this.render();
        },
        hideSpectatorsTab: function(){
            if (!this.client.opts.showSpectators) return;
            if (this.currentActiveTabName == 'spectators'){
                this._setActiveTab('free');
            }
            this.$tabs.addClass(this.NOT_IN_GAME_CLASS);
            this.$tabs.removeClass(this.IN_GAME_CLASS);
            this.$el.find('.tabs div[data-type="' + 'spectators' + '"]').hide();
        },
        _setActiveTab: function(tabName) {
            this.currentActiveTabName = tabName;
            this.$el.find('.tabs div').removeClass(this.ACTIVE_TAB_CLASS);
            this.$el.find('.tabs div[data-type="' + tabName + '"]').addClass(this.ACTIVE_TAB_CLASS);

            // скрыть заголовки на вкладке со списком играющих
            if (this.currentActiveTabName == 'inGame') {
                this.$el.find('#userListSearch span').hide();
            } else {
                this.$el.find('#userListSearch span').show();
            }
        },
        _setCounters: function() {
            if (!this.client.socket.isConnected) {
                this.$counterFree.html('');
                this.$counterinGame.html('');
                this.hideSpectatorsTab();
                return;
            }

            this.$counterFree.html('(' + this.client.userList.getUserList().length + ')');
            this.$counterinGame.html('(' + this.client.userList.getRoomList().length * 2 + ')');
            this.$counterSpectators.html('(' + this.client.userList.getSpectatorsList().length + ')');
        },
        _showPlayerListByTabName: function() {
            if (!this.client.socket.isConnected) {
                this.$list.html(this.$disconnectedTab);
                return;
            }

            switch(this.currentActiveTabName) {
                case 'free':
                    this.$list.html(this.tplFree({
                        users: this.client.userList.getUserList(this.getFilter()),
                        locale: this.locale,
                        imgBlock: this.images.block
                    }));
                    if (!this.mouseOver) this.scrollToUser();
                    break;
                case 'inGame':
                    this.$list.html(this.tplInGame({
                        rooms: this.client.userList.getRoomList(this.getFilter()),
                        modes: this.client.locale.modes,
                        showModes: this.client.modes.length > 1
                    }));
                    break;
                case 'spectators':
                    this.$list.html(this.tplFree({
                        users: this.client.userList.getSpectatorsList(this.getFilter()),
                        locale: this.locale,
                        imgBlock: this.images.block
                    }));
                    break;
                default: console.warn('unknown tab', this.currentActiveTabName);
            }
        },
        onRejectInvite: function(invite) {
            this.$el.find('.' + this.ACTIVE_INVITE_CLASS + '[data-userId="' + invite.user.userId + '"]').html(this.locale.buttons.invite).removeClass(this.ACTIVE_INVITE_CLASS);
        },
        render: function() {
            if (this.client.unload) return;
            setTimeout(this._showPlayerListByTabName.bind(this),1);
            this._setCounters();
            return this;
        },
        scrollToUser: function(){
            if (this.currentActiveTabName != 'free') return;
            var scrollTo = this.$el.find('.userListPlayer');
            if (scrollTo.length) {
                scrollTo = scrollTo.offset().top - this.$container.offset().top
                         + this.$container.scrollTop() - this.$container.height() / 2;
                this.$container.scrollTop(scrollTo);
            }
        },
        getFilter: function() {
            var filter = this.$filter.val().toLowerCase().trim();
            if (filter.length == 0) filter = false;
            return filter;
        },

        addInviteFriendButton: function() {
            var div = $('<div>');
            var block = $('#left-block');
            if (!block.length) return;
            div.attr('id', 'vkInviteFriend');
            div.addClass('btn');
            div.html('Пригласить Друга');
            div.width((block.width() || 255) - 10);
            div.css('top' , block.position().top + block.height() + 25 + 'px');
            div.on('click', this.client.vkInviteFriend.bind(this.client));
            this.$el.append(div);
        }
    });
    return UserListView;
});

define('text!tpls/v6-dialogRoundResult.ejs',[],function () { return '<p><%= result %></p>\r\n<%= (rankResult && rankResult.length) ? \'<p>\' + rankResult + \'</p>\' : \'\' %>\r\n<%= vkPost ? \'<span class="vkWallPost">Рассказать друзьям</span>\' : \'\'%>\r\n<span class="dialogGameAction"><%= locale.dialogPlayAgain %></span>\r\n<div class="roundResultTime"><%= locale.inviteTime %><span>30</span><%= locale.seconds %></div>\r\n';});

define('views/dialogs',['underscore', 'text!tpls/v6-dialogRoundResult.ejs'], function(_, tplRoundResultStr) {
    
    var dialogs = (function() {
        var NOTIFICATION_CLASS = 'dialogNotification';
        var HIDEONCLICK_CLASS = 'dialogClickHide';
        var INVITE_CLASS = 'dialogInvite';
        var GAME_CLASS = 'dialogGame';
        var DRAW_CLASS = 'dialogDraw';
        var DRAGGABLE_CLASS = 'dialogDraggable';
        var ROUNDRESULT_CLASS = 'dialogRoundResult';
        var TAKEBACK_CLASS = 'dialogTakeBack';
        var ACTION_CLASS = 'dialogGameAction';
        var BTN_PLAYAGANIN_CLASS = 'btnPlayAgain';
        var BTN_LEAVEGAME_CLASS = 'btnLeaveGame';
        var BTN_LEAVEGAMEOK_CLASS = 'btnLeaveGameOk';
        var client;
        var locale;
        var roundResultInterval, roundResultStartTime;
        var tplRoundResult = _.template(tplRoundResultStr);
        var dialogTimeout;
        var inviteTimeout = 30;
        var tplInvite = '';

        function _subscribe(_client) {
            client = _client;
            locale = client.locale['dialogs'];
            client.inviteManager.on('new_invite', newInvite);
            client.inviteManager.on('reject_invite', rejectInvite);
            client.inviteManager.on('cancel_invite', cancelInvite);
            client.inviteManager.on('remove_invite', removeInvite);
            client.gameManager.on('user_leave', userLeave);
            client.gameManager.on('turn', userTurn);
            client.gameManager.on('game_start', hideDialogs);
            client.gameManager.on('round_start', onRoundStart);
            client.gameManager.on('round_end', roundEnd);
            client.gameManager.on('game_leave', leaveGame);
            client.gameManager.on('ask_draw', askDraw);
            client.gameManager.on('cancel_draw', cancelDraw);
            client.gameManager.on('ask_back', askTakeBack);
            client.gameManager.on('cancel_back', cancelTakeBack);
            client.chatManager.on('show_ban', showBan);
            client.on('login_error', loginError);
            client.on('disconnected', onDisconnect);
            $(document).on("click", hideOnClick);
            inviteTimeout = client.inviteManager.inviteTimeoutTime;
            tplInvite = '<div class="inviteTime">'+locale['inviteTime']+'<span>'+inviteTimeout+'</span>'+locale['seconds']+'</div>';
        }

        function newInvite(invite) {
            var html = locale.player + ' <b>' + invite.from.userName + '</b> '
                + '(' +(client.opts.showRank == 'place' ?
                invite.from.getRank(invite.data.mode) + locale['placeRating'] :
                locale['ratingElo'] + invite.from.getRank(invite.data.mode)) + ')'
                + locale.invite
                + (client.modes.length > 1 ? locale['of'] +  '<b>'+client.getModeAlias(invite.data.mode) + '</b>' : '');
            if (typeof this.client.opts.generateInviteOptionsText == "function")
                html += this.client.opts.generateInviteOptionsText(invite);
            var div = showDialog(html, {
                buttons: {
                    "Принять": { text: locale['accept'], click: function() {
                            clearInterval(invite.data.timeInterval);
                            client.inviteManager.accept($(this).attr('data-userId'));
                            $(this).remove();
                        }
                    },
                    "Отклонить": { text: locale['decline'], click: function() {
                            clearInterval(invite.data.timeInterval);
                            client.inviteManager.reject($(this).attr('data-userId'));
                            $(this).remove();
                        }
                    }
                },
                close: function() {
                    clearInterval(invite.data.timeInterval);
                    client.inviteManager.reject($(this).attr('data-userId'));
                    $(this).remove();
                }
            }, true, false, false);
            div.attr('data-userId', invite.from.userId);
            div.addClass(INVITE_CLASS);
            invite.data.startTime = Date.now();
            invite.data.timeInterval = setInterval(function(){
                var time = (inviteTimeout * 1000 - (Date.now() - invite.data.startTime)) / 1000 ^0;
                this.find('.inviteTime span').html(time);
                if (time < 1) this.dialog('close');
            }.bind(div), 250);
        }

        function rejectInvite(invite) {
            console.log('dialogs; rejectInvite invite', invite);
            var html = locale.user + ' <b>' + invite.user.userName + '</b>';
            if (invite.reason != 'timeout')
                html += locale['rejectInvite'];
            else html += locale['timeoutInvite'] + inviteTimeout + locale['seconds'];
            var div = showDialog(html, {}, true, true, true);
        }

        function cancelInvite(invite) {
            console.log('dialogs; cancel invite', invite);
            clearInterval(invite.timeInterval);
        }

        function removeInvite(invite) {
            console.log('dialogs; removeInvite invite', invite);
            var userId = invite.from;
            $('.' + INVITE_CLASS + '[data-userId="' + userId + '"]').remove();
            clearInterval(invite.timeInterval);
        }

        function askDraw(user) {
            if (!this.client.gameManager.inGame()) return;
            var html = locale['user'] + ' <b>' + user.userName + '</b>' + locale['askDraw'];
            var div = showDialog(html,{
                position: true,
                buttons: {
                    "Принять": { text: locale['accept'], click: function() {
                            client.gameManager.acceptDraw();
                            $(this).remove();
                        }
                    },
                    "Отклонить": { text: locale['decline'], click: function() {
                            client.gameManager.cancelDraw();
                            $(this).remove();
                        }
                    }
                },
                close: function() {
                    client.gameManager.cancelDraw();
                    $(this).remove();
                }
            }, true, true, false);
            div.addClass(GAME_CLASS);
            div.addClass(DRAW_CLASS);
        }

        function cancelDraw(user) {
            var html = locale['user'] + ' <b>' + user.userName + '</b> ' + locale['cancelDraw'];
            var div = showDialog(html, {position: true}, true, true, true);
        }

        function askTakeBack(user) {
            if (!this.client.gameManager.inGame()) return;
            var html = locale['user'] + ' <b>' + user.userName + '</b> ' + locale['askTakeBack'];
            var div = showDialog(html,{
                position: true,
                buttons: {
                    "Да": { text: locale['yes'], click: function() {
                            client.gameManager.acceptTakeBack();
                            $(this).remove();
                        }
                    },
                    "Нет": { text: locale['no'], click: function() {
                            client.gameManager.cancelTakeBack();
                            $(this).remove();
                        }
                    }
                },
                close: function() {
                    client.gameManager.cancelTakeBack();
                    $(this).remove();
                }
            }, true, true, false);
            div.addClass(TAKEBACK_CLASS);
            div.addClass(GAME_CLASS);
        }

        function cancelTakeBack(user) {
            if (!this.client.gameManager.inGame()) return;
            var html = locale['user'] + ' <b>' + user.userName + '</b>' + locale['cancelTakeBack'];
            var div = showDialog(html, {position: true}, true, true, true);
        }

        function roundEnd(data) {
            if (!data.isPlayer) {
                return;
            }
            var oldElo = +client.getPlayer()[data.mode].ratingElo;
            var oldRank = +client.getPlayer()[data.mode].rank;
            var newElo = +data['ratings'][client.getPlayer().userId].ratingElo;
            var newRank = +data['ratings'][client.getPlayer().userId].rank;
            var eloDif = newElo - oldElo,
                vkPost = false,
                vkText = '';
            console.log('round_end;', data, oldElo, newElo, oldRank, newRank);
            hideDialogs();
            var result = locale['gameOver'], rankResult = '';
            if (data.save) {
                switch (data.result) {
                    case 'win':
                        result = locale['win'];
                        break;
                    case 'lose':
                        result = locale['lose'];
                        break;
                    case 'draw':
                        result = locale['draw'];
                        break;
                }
                result += '<b> (' + (eloDif >= 0 ? '+' : '') + eloDif + ' ' + locale['scores'] + ') </b>';
            }
            switch (data.action){
                case 'timeout': result += ' ' + (data.result == 'win' ? locale['opponentTimeout'] : locale['playerTimeout']);
                    break;
                case 'throw': result += ' ' + (data.result == 'win' ? locale['opponentThrow'] : locale['playerThrow']);
                    break;
            }
            if (newRank > 0 && data.save) {
                if (data.result == 'win' && oldRank > 0 && newRank < oldRank) {
                    rankResult = locale['ratingUp'] + oldRank + locale['on'] + newRank + locale['place'] + '.';
                } else rankResult = locale['ratingPlace'] + newRank + locale['place'] + '.';
            }
            // check vk post
            if (this.client.vkWallPost) {
                if (client.getPlayer()[data.mode].win == 0 && data['ratings'][client.getPlayer().userId].win == 1){
                    vkPost = true;
                    vkText = 'Моя первая победа';
                } else if (data.result == 'win' && oldRank > 0 && newRank < oldRank){
                    vkPost = true;
                    vkText = 'Я занимаю ' + newRank + ' место в рейтинге';
                }
            }
            var html = tplRoundResult({
                result: result, rankResult: rankResult, vkPost: vkPost, locale: locale
            });
            var div = showDialog(html, {
                position: true,
                width: 350,
                buttons: {
                    "Да, начать новую игру": {
                        text: locale['playAgain'],
                        'class': BTN_PLAYAGANIN_CLASS,
                        click: function () {
                            console.log('result yes');
                            client.gameManager.sendReady();
                            div.parent().find(':button').hide();
                            div.parent().find(":button."+BTN_LEAVEGAME_CLASS).show();
                            div.find('.'+ACTION_CLASS).html(locale['waitingOpponent']);
                        }
                    },
                    "Нет, выйти": {
                        text: locale['leave'],
                        'class': BTN_LEAVEGAME_CLASS,
                        click: function () {
                            console.log('result no');
                            clearInterval(roundResultInterval);
                            $(this).remove();
                            client.gameManager.leaveGame();
                        }
                    },
                    "Ок" : {
                        text: 'Ок',
                        'class': BTN_LEAVEGAMEOK_CLASS,
                        click: function() {
                            console.log('result ok');
                            clearInterval(roundResultInterval);
                            $(this).remove();
                            //client.gameManager.leaveGame();
                        }
                    }
                },
                close: function () {
                    console.log('result close');
                    clearInterval(roundResultInterval);
                    $(this).remove();
                    client.gameManager.leaveGame();
                }
            }, true, false);

            div.addClass(ROUNDRESULT_CLASS);
            div.parent().find(":button."+BTN_LEAVEGAMEOK_CLASS).hide();
            // show dialog result with delay
            div.parent().hide();
            dialogTimeout = setTimeout(function(){
                div.parent().show();
                //this.client.soundManager._playSound(data.result);
            }.bind(this), data.action == 'user_leave' ? 1000 : client.opts.resultDialogDelay);
            div.addClass(GAME_CLASS);

            // add timer to auto close
            roundResultStartTime = Date.now();
            roundResultInterval = setInterval(function(){
                var time = (inviteTimeout * 2000 - (Date.now() - roundResultStartTime)) / 1000 ^0;
                this.find('.roundResultTime span').html(time);
                if (time < 1) {
                    console.log('interval', time);
                    clearInterval(roundResultInterval);
                    this.find('.roundResultTime').hide();
                    this.find('.'+ACTION_CLASS).html(locale['waitingTimeout']);
                    div.parent().find(':button').hide();
                    div.parent().find(":button."+BTN_LEAVEGAMEOK_CLASS).show();
                    div.removeClass(GAME_CLASS);
                    client.gameManager.leaveGame();
                }
            }.bind(div), 250);

            if (vkPost) {
                div.find('.vkWallPost').on('click', function(){
                    this.client.vkWallPostResult(vkText);
                }.bind(this))
            }
        }

        function userLeave(user) {
            hideNotification();
            var html = locale['user'] + ' <b>' + user.userName + '</b> ' + locale['opponentLeave'];
            var div = $('.'+ROUNDRESULT_CLASS);
            if (div && div.length>0){   // find round result dialog and update it
                div.parent().find(':button').hide();
                div.parent().find(":button."+BTN_LEAVEGAMEOK_CLASS).show();
                div.find('.'+ACTION_CLASS).html(html);
                clearInterval(roundResultInterval);
                div.find('.roundResultTime').hide();
            } else {
                div = showDialog(html, {
                    position: true,
                    buttons: {
                        "Ок": function() {
                            $(this).remove();
                            //client.gameManager.leaveRoom();
                        }
                    },
                    close: function() {
                        //client.gameManager.leaveRoom();
                        $(this).remove();
                    }
                }, true, true, true);
            }
            div.addClass(GAME_CLASS);
        }

        function loginError() {
            var html = locale['loginError'];
            var div = showDialog(html, {}, false, false, false);
        }

        function showBan(ban) {
            var html = locale['banMessage'];
            if (ban.reason && ban.reason != '') html += 'за ' + ban.reason;
            else html += locale['banReason'];
            if (ban.timeEnd) {
                html += (ban.timeEnd > 2280000000000 ? ' навсегда' : ' до ' + formatDate(ban.timeEnd));
            }
            var div = showDialog(html, {}, false, false, false);
        }

        function leaveGame() {
            hideNotification();
            hideGameMessages();
        }

        function userTurn() {
            $('.' + TAKEBACK_CLASS).dialog("close");
        }

        function showDialog(html, options, draggable, notification, clickHide) {
            options = options || {};
            options.resizable = options.resizable || false;
            options.modal = options.modal || false;
            options.draggable = options.draggable || false;
            options.buttons = options.buttons || {
                "Ок": function() {
                    $(this).remove();
                }
            };
            options.draggable = options.draggable || draggable;
            notification = notification || options.notification;
            clickHide = clickHide || options.clickHide;
            if (options.position === true) {
                var field = document.getElementById('game-field') || document.getElementById('field') || document;
                options.position = {my: 'top', at: 'top', of: field}
            }

            var div = $('<div>');
            var prevFocus = document.activeElement || document;
            div.html(html).dialog(options);
            div.parent().find(':button').attr('tabindex', '-1');
            if (document.activeElement != null){
                document.activeElement.blur();
            }
            $(prevFocus).focus();
            if (notification) {
                div.addClass(NOTIFICATION_CLASS);
            }
            if (clickHide) {
                div.addClass(HIDEONCLICK_CLASS);
            }
            return div;
        }


        function onRoundStart() {
            clearInterval(roundResultInterval);
            $('.' + ROUNDRESULT_CLASS).remove();
        }


        function hideDialogs() {
            $('.' + NOTIFICATION_CLASS).dialog("close");
            $('.' + INVITE_CLASS).dialog("close");
            clearTimeout(dialogTimeout);
            clearInterval(roundResultInterval);
        }

        function hideNotification() {
            $('.' + NOTIFICATION_CLASS).dialog("close");
        }

        function hideGameMessages() {
            $('.' + GAME_CLASS).dialog("close");
        }

        function hideOnClick() {
            $('.' + HIDEONCLICK_CLASS).dialog("close");
        }

        function formatDate(time) {
            var date = new Date(time);
            var day = date.getDate();
            var month = date.getMonth() + 1;
            var year = ("" + date.getFullYear()).substr(2, 2);
            return ext(day, 2, "0") + "." + ext(month, 2, "0") + "."  + year;
            function ext(str, len, char) {
                //char = typeof (char) == "undefined" ? "&nbsp;" : char;
                str = "" + str;
                while (str.length < len) {
                    str = char + str;
                }
                return str;
            }
        }

        function onDisconnect() {
            hideDialogs();
            $('.' + ROUNDRESULT_CLASS).remove();
        }

        return {
            init: _subscribe,
            showDialog: showDialog,
            hideDialogs: hideDialogs,
            hideNotification: hideNotification,
            cancelTakeBack: function(){
                $('.' + TAKEBACK_CLASS).dialog("close");
            }
        };
    }());
    return dialogs;
});


define('text!tpls/v6-chatMain.ejs',[],function () { return '<div class="tabs">\r\n    <div class="tab" data-type="public"><%= locale.tabs.main %></div>\r\n    <div class="tab" data-type="room" style="display: none;"><%= locale.tabs.room %></div>\r\n    <div class="tab" data-type="private" style="display: none;">игрок</div>\r\n</div>\r\n<div class="clear"></div>\r\n<div class="messagesWrap"><ul></ul></div>\r\n<div class="inputMsg" contenteditable="true"></div>\r\n<div class="layer1">\r\n    <div class="sendMsgBtn"><%= locale.buttons.send %></div>\r\n    <select id="chat-select">\r\n        <option selected style="font-style: italic;"><%= locale.templateMessages.header %></option>\r\n        <option>Ваш ход!</option>\r\n        <option>Привет!</option>\r\n        <option>Молодец!</option>\r\n        <option>Здесь кто-нибудь умеет играть?</option>\r\n        <option>Кто со мной?</option>\r\n        <option>Спасибо!</option>\r\n        <option>Спасибо! Интересная игра!</option>\r\n        <option>Спасибо, больше играть не могу. Ухожу!</option>\r\n        <option>Отличная партия. Спасибо!</option>\r\n        <option>Дай ссылку на твою страницу вконтакте</option>\r\n        <option>Снимаю шляпу!</option>\r\n        <option>Красиво!</option>\r\n        <option>Я восхищен!</option>\r\n        <option>Где вы так научились играть?</option>\r\n        <option>Еще увидимся!</option>\r\n        <option>Ухожу после этой партии. Спасибо!</option>\r\n        <option>Минуточку</option>\r\n    </select>\r\n</div>\r\n<div class="layer2">\r\n    <span class="showChat"><%= locale.buttons.showChat %></span>\r\n    <span class="hideChat"><%= locale.buttons.hideChat %></span>\r\n        <span class="chatAdmin">\r\n        <input type="checkbox" id="chatIsAdmin"/><label for="chatIsAdmin">От админа</label>\r\n    </span>\r\n    <span class="chatRules"><%= locale.buttons.chatRules %></span>\r\n</div>\r\n\r\n<ul class="menuElement noselect">\r\n    <li data-action="answer"><span><%= locale.menu.answer %></span></li>\r\n    <li data-action="invite"><span><%= locale.menu.invite %></span></li>\r\n    <li data-action="showProfile"><span><%= locale.menu.showProfile %></span></li>\r\n    <li data-action="addToBlackList"><span><%= locale.menu.blackList %></span></li>\r\n    <li data-action="ban"><span><%= locale.menu.ban %></span></li>\r\n</ul>';});


define('text!tpls/v6-chatMsg.ejs',[],function () { return '<li class="chatMsg" data-msgId="<%= msg.time %>">\r\n    <div class="msgRow1">\r\n        <div class="smallRight time"><%= msg.t %></div>\r\n        <div class="smallRight rate"  title="<%= \'(\' + locale.rankPlace + \')\'%>"><%= (msg.rank || \'—\') %></div>\r\n        <div class="chatUserName"\r\n             data-userId="<%= msg.userId%>"\r\n             data-userName="<%= msg.userName %>"\r\n             title="<%= msg.userName + \', \' + locale.rankPlace + \': \' + (msg.rank || \' — \') %>"\r\n        > <span class="userName"><%= msg.userName %></span> </div>\r\n    </div>\r\n    <div class="msgRow2">\r\n        <div class="delete" title="<%= locale.buttons.removeMessage %>" style="background-image: url(<%= imgDel %>);"></div>\r\n        <div class="msgTextWrap">\r\n            <span class="v6-msgText"><%= _.escape(msg.text) %></span>\r\n        </div>\r\n    </div>\r\n</li>';});


define('text!tpls/v6-chatDay.ejs',[],function () { return '<li class="chatDay" data-day-msgId="<%= time %>">\r\n    <div>\r\n        <%= d %>\r\n    </div>\r\n</li>';});


define('text!tpls/v6-chatRules.ejs',[],function () { return '<div id="chat-rules" class="aboutPanel v6-block-border">\r\n    <img class="closeIcon" src="<%= close %>">\r\n\r\n    <div style="padding: 10px 12px 15px 25px;">\r\n        <h2>Правила чата</h2>\r\n        <p style="line-height: 16px;">В чате запрещено:<br>\r\n            <span style="margin-left:5px;">1. использование ненормативной лексики и оскорбительных выражений;</span><br>\r\n            <span style="margin-left:5px;">2. хамское и некорректное общение с другими участниками;</span><br>\r\n            <span style="margin-left:5px;">3. многократная публикация бессмысленных, несодержательных или одинаковых сообщений.</span>\r\n        </p>\r\n\r\n        <p style="line-height: 16px;"><span style="margin-left:5px;">Баны</span> выносятся: на 1 день, на 3 дня, на 7 дней, на месяц или навсегда,\r\n            в зависимости от степени тяжести нарушения.\r\n        </p>\r\n\r\n        <p style="line-height: 16px;"><span style="margin-left:5px;">Бан</span> снимается автоматически по истечении срока.\r\n        </p>\r\n\r\n    </div>\r\n</div>';});


define('text!tpls/v6-chatBan.ejs',[],function () { return '<div>\r\n    <span class="ban-username" style="font-weight:bold;">Бан игрока <i><%= userName%></i></span><br><br>\r\n    <span>Причина бана:</span>\r\n    <br>\r\n    <div class="inputTextField" id="ban-reason" contenteditable="true" style="height:54px; border: 1px solid #aaaaaa;"></div><br>\r\n\r\n    <span>Длительность бана:</span><br>\r\n    <select id="ban-duration">\r\n        <option value="1">1 день</option>\r\n        <option value="3">3 дня</option>\r\n        <option value="7" selected="">7 дней</option>\r\n        <option value="30">30 дней</option>\r\n        <option value="9999">Навсегда</option>\r\n    </select>\r\n\r\n</div>';});

define('views/chat',['underscore', 'backbone', 'text!tpls/v6-chatMain.ejs', 'text!tpls/v6-chatMsg.ejs', 'text!tpls/v6-chatDay.ejs', 'text!tpls/v6-chatRules.ejs', 'text!tpls/v6-chatBan.ejs'],
    function(_, Backbone, tplMain, tplMsg, tplDay, tplRules, tplBan) {
        

        var ChatView = Backbone.View.extend({
            tagName: 'div',
            id: 'v6Chat',
            tplMain: _.template(tplMain),
            tplMsg: _.template(tplMsg),
            tplDay: _.template(tplDay),
            tplRules: _.template(tplRules),
            tplBan: _.template(tplBan),
            events: {
                'click .chatMsg': '_deleteMsg',
                'click .tab': 'clickTab',
                'blur .inputMsg': 'blurInputMsg',
                'focus .inputMsg': 'clickInputMsg',
                'click .sendMsgBtn': 'sendMsgEvent',
                'keyup .inputMsg': 'sendMsgEvent',
                'change #chat-select': 'changeChatSelect',
                'click .chatMsg div[data-userid]': 'showMenu',
                'click li[data-action]': 'clickDialogAction',
                'click .chatRules': 'showChatRules',
                'click .showChat': 'showChat',
                'click .hideChat': 'hideChat'
            },

            banUser: function(userId, userName){
                var mng =  this.manager;
                var div = $(this.tplBan({userName: userName})).attr('data-userId', userId).dialog({
                    buttons: {
                        "Добавить в бан": function() {
                           mng.banUser($(this).attr('data-userId'),$(this).find('#ban-duration')[0].value, $(this).find('#ban-reason').html());
                            $(this).remove();
                        },
                        "Отмена": function(){
                            $(this).remove();
                        }
                    },
                    close: function() {
                        $(this).remove();
                    }
                }).parent().draggable();
            },

            answerUser: function(userId, userName){
                var text = this.$inputMsg.text();
                console.log('answer', userName, text);
                if (this.$inputMsg.has(this.$placeHolderSpan).length) {
                   text = ' ';
                }
                if (text.indexOf(userName+',') != -1){
                    return;
                }
                this.$inputMsg.text(userName+ ', '+ text);
                this.$inputMsg.focus();
                // cursor to end
                if (typeof window.getSelection != "undefined" && typeof document.createRange != "undefined") {
                    var range = document.createRange();
                    range.selectNodeContents(this.$inputMsg[0]);
                    range.collapse(false);
                    var sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                } else if (typeof document.body.createTextRange != "undefined") {
                    var textRange = document.body.createTextRange();
                    textRange.moveToElementText(this.$inputMsg[0]);
                    textRange.collapse(false);
                    textRange.select();
                }
            },

            showChat: function(){
                $('#left-block').removeClass('chatHidden');
            },

            hideChat: function(){
                $('#left-block').addClass('chatHidden');
            },

            showChatRules: function() {
                this.$rules.css({
                    top: ($(window).height() / 2) - (this.$rules.outerHeight() / 2),
                    left: ($(window).width() / 2) - (this.$rules.outerWidth() / 2)
                }).show();
            },

            clickDialogAction: function(e) {
                var actionObj = {
                    action: $(e.currentTarget).attr('data-action'),
                    userId: this.$menu.attr('data-userId'),
                    userName: this.$menu.attr('data-userName')
                };

                switch (actionObj.action){
                    case 'showProfile': this.client.onShowProfile(actionObj.userId, actionObj.userName); break;
                    case 'invite': this.client.viewsManager.userListView.invitePlayer(actionObj.userId); break;
                    case 'ban': this.banUser(actionObj.userId, actionObj.userName); break;
                    case 'addToBlackList': this.manager.addUserToBlackList({userId: actionObj.userId, userName: actionObj.userName}); break;
                    case 'answer': this.answerUser(actionObj.userId, actionObj.userName); break;
                }
            },

            showMenu: function(e, userId) {
                // клик на window.body сработает раньше, поэтому сдесь даже не нужно вызывать $menu.hide()
                var coords = e.target.getBoundingClientRect(),
                    OFFSET = 20, // отступ, чтобы не закрывало имя
                    userName =  $(e.currentTarget).attr('data-userName') || $(e.currentTarget).attr('title');
                userId = userId || $(e.target).parent().attr('data-userid');

                setTimeout(function() {
                    this.$menu.find('li[data-action=invite]').hide();
                    if (!this.client.gameManager.inGame()) {                // show invite user, if we can
                        var userlist = this.client.userList.getFreeUserList();
                        if (userlist) {                                     // check user is free
                            for (var i = 0; i < userlist.length; i++){
                                if (userlist[i].userId == userId){
                                    this.$menu.find('li[data-action=invite]').show();
                                }
                            }
                        }
                    }

                    //hide answer not in chat
                    if ($(e.target).parent().hasClass('chatUserName') && userId != this.client.getPlayer().userId){
                        this.$menu.find('li[data-action=answer]').show();
                    } else {
                        this.$menu.find('li[data-action=answer]').hide();
                    }

                    // hide/show add black list
                    if (userId == this.client.getPlayer().userId || userId == '0'){
                        this.$menu.find('li[data-action=addToBlackList]').hide();
                    } else {
                        this.$menu.find('li[data-action=addToBlackList]').show();
                    }

                    this.$menu.attr('data-userId', userId);
                    this.$menu.attr('data-userName', userName);
                    this.$menu.css({
                        left: OFFSET, // фиксированный отступ слева
                        top: coords.top - document.getElementById('v6Chat').getBoundingClientRect().top + OFFSET
                    }).slideDown();
                }.bind(this), 0);

            },

            hideMenuElement: function() {
                this.$menu.removeAttr('data-userId');
                this.$menu.hide();
            },

            changeChatSelect: function(e) {
                var textMsg = e.target.options[e.target.selectedIndex].innerHTML;
                this.$SELECTED_OPTION.attr('selected', true);
                var text = this.$inputMsg.text();
                text = (text.substr(text.length-3, 2) == ', ' ? text : '') + textMsg;
                this.$inputMsg.text(text);
            },

            sendMsgEvent: function(e) {
                // e используется здесь только если нажат enter
                if (e.type === 'keyup' && e.keyCode !== 13) {
                    return;
                }

                if (this.$inputMsg.has(this.$placeHolderSpan).length) {
                    return;
                }

                this._sendMsg(this.$inputMsg.text());
            },

            scrollEvent: function() {
                if (this.$messagesWrap[0].scrollHeight - this.$messagesWrap.height() != 0 &&
                    this.$messagesWrap.scrollTop()<5 && this.client.isLogin &&
                    !this.manager.fullLoaded[this.manager.current]){
                    this._setLoadingState();
                    this.manager.loadMessages();
                }
            },

            bodyScroll: function (e) {
                e.deltaY =  e.deltaY ||  e.originalEvent.wheelDeltaY || -e.originalEvent.detail;
                if ((this.$messagesWrap[0].scrollHeight - this.$messagesWrap.height() - this.$messagesWrap.scrollTop() === 0) && e.deltaY < 0) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            },

            _sendMsg: function(text) {
                if (text === '' || typeof text !== 'string') {
                    return;
                }

                if (text.length > this.MAX_MSG_LENGTH) {
                    alert(this.MAX_LENGTH_MSG);
                    return;
                }
                this.manager.sendMessage(text, null, this.currentActiveTabName, $('#chatIsAdmin')[0].checked);
                this.$inputMsg.empty();
                this.$inputMsg.focus();
            },

            blurInputMsg: function(e) {
                var target = $(e.currentTarget);

                if (target.text() === '') {
                    target.empty().append(this.$placeHolderSpan); // empty на всякий случай
                }
            },

            clickInputMsg: function(e) {
                var target = $(e.currentTarget);

                if (target.has(this.$placeHolderSpan).length) {
                    target.empty();
                }
            },

            clickTab: function(e) {
                var $target = $(e.target),
                    tabName = $target.attr('data-type');

                if (tabName === this.currentActiveTabName) {
                    return;
                }

                this.currentActiveTabName = tabName;
                this._setActiveTab(this.currentActiveTabName);
                this.manager.loadCachedMessages(this.tabs[tabName].target, this.currentActiveTabName);
            },

            reload: function () {
                this._setActiveTab(this.currentActiveTabName);
                this.manager.loadCachedMessages(this.tabs[ this.currentActiveTabName].target, this.currentActiveTabName);
            },

            initialize: function(_client) {
                this.client = _client;
                this.locale = _client.locale.chat;
                this.manager = _client.chatManager;
                this.images = _client.opts.images;
                this.$el.html(this.tplMain({locale: this.locale}));
                this.$el.addClass('v6-block-border');

                this.MAX_MSG_LENGTH = 128;
                this.SCROLL_VAL = 40;
                this.MAX_LENGTH_MSG = 'Сообщение слишком длинное (максимальная длина - 128 символов). Сократите его попробуйте снова';

                this.CLASS_DISABLED = 'disabled';
                this.CLASS_CHATADMIN = 'chatAdmin';
                this.CLASS_DELETE_CHAT_MESSAGE = 'delete';
                this.CLASS_NEW_MSG = 'newMsg';
                this.CLASS_ADMIN_MSG = 'isAdmin';
                this.ACTIVE_TAB_CLASS = 'activeTab';
                this.CLASS_MENU_ELEMENT = 'menuElement';

                this.$menu = this.$el.find('.' + this.CLASS_MENU_ELEMENT); // диалоговое меню при ЛКМ на имени игрока
                if (!this.client.isAdmin) {
                    this.$menu.find('li[data-action="ban"]').remove();
                } else {
                    this.$el.find('.' + this.CLASS_CHATADMIN).show();
                    this.$el.find('.chatRules').hide();
                }

                window.document.body.addEventListener('click', this.hideMenuElement.bind(this));

                this.$rules = $(this.tplRules({close: this.images.close}));
                window.document.body.appendChild(this.$rules[0]);
                this.$rules.find('img.closeIcon').on('click', function() {
                    this.$rules.hide();
                }.bind(this));

                this.$placeHolderSpan = $('<span class="placeHolderSpan">'+this.locale.inputPlaceholder+'..</span>');

                this.$spinnerWrap = $('<li class="spinnerWrap"><div class="spinner" style="background: url(' + this.images.spin + ');"></div></li>');
                this.$messagesWrap = this.$el.find('.messagesWrap');
                this.$msgsList = this.$messagesWrap.find('ul');
                this.$inputMsg = this.$el.find('.inputMsg');
                this.$SELECTED_OPTION = this.$el.find('select option:selected');

                this.currentActiveTabName = 'public';
                this.currentActiveTabTitle = _client.game;
                this.tabs = {
                    'public': { target: _client.game, title: this.locale.tabs.main },
                    'private': null,
                    'room': null
                };

                this._setActiveTab(this.currentActiveTabName);
                this.$inputMsg.empty().append(this.$placeHolderSpan);
                this._setLoadingState();



                this.listenTo(this.manager, 'message', this._addOneMsg.bind(this));
                this.listenTo(this.manager, 'load', this._preaddMsgs.bind(this));
                this.listenTo(this.manager, 'open_dialog', this._openDialog.bind(this));
                this.listenTo(this.manager, 'close_dialog', this._closeDialog.bind(this));
                this.listenTo(this.client, 'disconnected', this._closeDialog.bind(this));
                this.$messagesWrap.scroll(this.scrollEvent.bind(this));
                this.$messagesWrap.on({'mousewheel DOMMouseScroll': this.bodyScroll.bind(this)});
            },

            setPublicTab: function(tabName){
                this.tabs.public.target = tabName;
                this.currentActiveTabName = 'public';
                this._setActiveTab('public');
            },

            _setActiveTab: function(tabName) {
                var $tab = this.$el.find('.tabs div[data-type="' + tabName + '"]');
                this.$el.find('.tabs div').removeClass(this.ACTIVE_TAB_CLASS);
                $tab.addClass(this.ACTIVE_TAB_CLASS);
                $tab.html(this.tabs[tabName].title);
                $tab.show();

                this.$msgsList.html('');
                this._setLoadingState();
                this.currentActiveTabTitle = this.tabs[tabName].target;
            },

            render: function() {
                return this;
            },

            _openDialog: function(dialog){
                if (dialog.userId) {
                    this.tabs['private'] = {target: dialog.userId, title: dialog.userName};
                    this.currentActiveTabName = 'private';
                    this._setActiveTab('private');
                } else if (dialog.roomId) {
                    this.tabs['room'] = {target: dialog.roomId, title: this.locale.tabs.room};
                    this.currentActiveTabName = 'room';
                    this._setActiveTab('room');
                }

            },

            _closeDialog: function(target){
                this.currentActiveTabName = 'public';
                this._setActiveTab('public');
                this.$el.find('.tabs div[data-type="' + 'private' + '"]').hide();
                this.$el.find('.tabs div[data-type="' + 'room' + '"]').hide();
            },

            _deleteMsg: function(e) {
                var $msg, msgId;
                if (!isNaN(+e) && typeof +e === 'number') {
                    msgId = e;
                } else { //клик не по кнопке удалить
                    if (!$(e.target).hasClass(this.CLASS_DELETE_CHAT_MESSAGE)) {
                        return;
                    }
                    $msg = $(e.currentTarget);
                    msgId = $msg.attr('data-msgId')
                }
                if (msgId) {
                    this.manager.deleteMessage(parseFloat(msgId));
                }
                // если был передан id сообщения
                if (!$msg) {
                    $msg = this.$el.find('li[data-msgId="' + msgId + '"]').remove();
                }

                if (!$msg) {
                    console.warn('cannot find msg with  id', msgId, e);
                    return;
                }

                $msg.remove();
            },

            _addOneMsg: function(msg) {
                //console.log('chat message', msg);
                if (msg.target != this.currentActiveTabTitle || this.client.settings.blacklist[msg.userId]) return;
                var $msg = this.tplMsg({ msg: msg, imgDel: this.images.del, locale: this.locale });
                var fScroll = this.$messagesWrap[0].scrollHeight - this.$messagesWrap.height() - this.$messagesWrap.scrollTop() < this.SCROLL_VAL;

                if (!this.manager.last[msg.target] ||
                    this.manager.last[msg.target].d != msg.d) {
                    this.$msgsList.append(this.tplDay(msg));
                }
                this.$msgsList.append($msg);

                $msg = this.$el.find('li[data-msgId="' + msg.time + '"]');
                if (msg.admin) $msg.addClass(this.CLASS_ADMIN_MSG);

                $msg.addClass(this.CLASS_NEW_MSG);
                setTimeout(function(){
                    this.$el.find('li[data-msgId="' + msg.time + '"]').removeClass(this.CLASS_NEW_MSG);
                }.bind(this), 2500);

                //scroll down
                if (fScroll) this.$messagesWrap.scrollTop(this.$messagesWrap[0].scrollHeight)
            },

            _preaddMsgs: function(msg) {
                //console.log('pre chat message', msg);
                if (msg && (msg.target != this.currentActiveTabTitle  || this.client.settings.blacklist[msg.userId])) return;
                this._removeLoadingState();
                if (!msg) return;
                var oldScrollTop =  this.$messagesWrap.scrollTop();
                var oldScrollHeight = this.$messagesWrap[0].scrollHeight;
                var oldDay = this.$el.find('li[data-day-msgId="' + this.manager.first[msg.target].time + '"]');
                if (oldDay) oldDay.remove();
                // add day previous msg
                if (this.manager.first[msg.target].d != msg.d) {
                    this.$msgsList.prepend(this.tplDay(this.manager.first[msg.target]));
                }
                var $msg = this.tplMsg({ msg: msg, imgDel: this.images.del, locale: this.locale });
                this.$msgsList.prepend($msg);
                // add day this, now firs message
                this.$msgsList.prepend(this.tplDay(msg));
                $msg = this.$el.find('li[data-msgId="' + msg.time + '"]');
                if (msg.admin) $msg.addClass(this.CLASS_ADMIN_MSG);
                this.$messagesWrap.scrollTop(oldScrollTop + this.$messagesWrap[0].scrollHeight - oldScrollHeight);
            },

            _setLoadingState: function() {
                this.$msgsList.prepend(this.$spinnerWrap);
                this.$messagesWrap.addClass(this.CLASS_DISABLED);
            },

            _removeLoadingState: function(){
                this.$spinnerWrap.remove();
                this.$messagesWrap.removeClass(this.CLASS_DISABLED);
            }
        });
        return ChatView;
    });

define('text!tpls/v6-settingsMain.ejs',[],function () { return '    <img class="closeIcon" src="<%= close %>">\r\n    <div class="settingsContainer">\r\n        <h2> <%= locale.title %> </h2>\r\n        <div> <%= settings %> </div>\r\n    </div>\r\n    <div class="blacklistContainer">\r\n        <p> <%= locale.titleBlackList %> </p>\r\n        <div> <i> <%= locale.emptyBL %> </i> </div>\r\n    </div>\r\n    <div class="buttonsContainer">\r\n        <span class="showBlackListBtn"> <%= locale.buttons.showBL %> </span><br>\r\n        <div class="confirmBtn"> <%= locale.buttons.confirm %> </div>\r\n    </div>';});


define('text!tpls/v6-settingsDefault.ejs',[],function () { return '<p>Настройки игры</p>\r\n<div>\r\n    <div class="option">\r\n        <label><input type="checkbox" name="sounds">\r\n            Включить звук</label>\r\n    </div>\r\n    <div class="option">\r\n        <label><input type="checkbox" name="disableInvite">\r\n            Запретить приглашать меня в игру</label>\r\n    </div>\r\n</div>\r\n';});


define('text!tpls/v6-settingsBlackListUser.ejs',[],function () { return '<span class="blackListUser">\r\n    <span class="userName"> <%= user.userName %> </span>\r\n    <span class="removeBtn" data-userid="<%= user.userId %>"> <%= locale.buttons.remove %> </span>\r\n    <!--<span class="date"> </span>-->\r\n</span>';});

define('views/settings',['underscore', 'backbone', 'text!tpls/v6-settingsMain.ejs', 'text!tpls/v6-settingsDefault.ejs',
        'text!tpls/v6-settingsBlackListUser.ejs'],
    function(_, Backbone, tplMain, tplDefault, tplUser) {
        

        var SettingsView = Backbone.View.extend({
            tagName: 'div',
            id: 'v6-settings',
            tplMain: _.template(tplMain),
            tplDefault: _.template(tplDefault),
            tplUser: _.template(tplUser),
            events: {
                'click .closeIcon': 'save',
                'change input': 'changed',
                'click .confirmBtn': 'save',
                'click .removeBtn': 'removeUser',
                'click .showBlackListBtn': 'showBlackList'
            },


            initialize: function(client) {
                this.client = client;
                this.images  = client.opts.images;
                this.changedProperties = [];
                this.$el.html(this.tplMain({
                    close:this.images.close,
                    locale: client.locale.settings,
                    settings: client.opts.settingsTemplate ? _.template(client.opts.settingsTemplate)() : this.tplDefault()
                }));
                this.listenTo(client, 'login', this.load.bind(this));
                $('body').append(this.$el);
                this.$el.hide();
                this.$el.draggable();
                this.isClosed = true;
            },

            changed: function (e){
                var $target = $(e.target),
                    type = $target.prop('type'),
                    property = $target.prop('name'),
                    value = type == "radio" ? $target.val() : $target.prop('checked'),
                    settings = this.client.settings,
                    defaultSettings = this.client.defaultSettings;

                if (defaultSettings.hasOwnProperty(property)){
                    console.log('settings; changed', {property: property, value: value, type: type});
                    if (this.changedProperties.indexOf(property) == -1)this.changedProperties.push(property);
                    this.client._onSettingsChanged({property: property, value: value, type: type});
                } else {
                    console.warn('settings;', 'default settings does not have property', property);
                }
            },

            save: function () {
                this.$el.hide();
                this.isClosed = true;

                var defaultSettings = this.client.defaultSettings,
                    settings = this.client.settings,
                    value, $input;
                if (this.changedProperties.length == 0) {
                    console.log('settings; nothing changed');
                    return;
                }
                for (var property in defaultSettings) {
                    if (property != 'blacklist' && defaultSettings.hasOwnProperty(property)) {
                        value = settings[property];
                        if (typeof value == "boolean") {
                            $input = this.$el.find('input[name=' + property + ']');
                            value = $input.prop('checked');
                        }
                        else {
                            $input = this.$el.find('input[name=' + property + ']:checked');
                            value = $input.val();
                        }
                        if ($input) {
                            console.log('settings; save', property, value, $input.prop('type'));
                            settings[property] = value;
                        } else {
                            console.error('settings;', 'input element not found! ', property);
                        }
                    }
                }
                this.client.saveSettings();
            },

            load: function () {
                this.changedProperties = [];
                var defaultSettings = this.client.defaultSettings,
                    settings = this.client.settings,
                    value, $input;
                for (var property in defaultSettings){
                    if (defaultSettings.hasOwnProperty(property)){
                        value = settings[property];
                        if (property == "blacklist"){
                            this.renderBlackList(value)
                        } else {
                            if (typeof value == "boolean")
                                $input = this.$el.find('input[name=' + property + ']');
                            else
                                $input = this.$el.find('input[name=' + property + '][value=' + value + ']');
                            if ($input) {
                                console.log('settings; load', property, value, $input.prop('type'));
                                $input.prop('checked', !!value);
                            } else {
                                console.error('settings;', 'input element not found! ', property, value);
                            }
                        }
                    }
                }
            },

            cancel: function () {
                //emit changed default
                var $input, value, property, settings = this.client.settings;
                for (var i = 0; i < this.changedProperties.length; i++){
                    property = this.changedProperties[i];
                    value = settings[property];
                    if (typeof value == "boolean")
                        $input = this.$el.find('input[name=' + property + ']');
                    else
                        $input = this.$el.find('input[name=' + property + '][value=' + value + ']');
                    if ($input) {
                        console.log('settings; default', {property: property, value: value, type: $input.prop('type')});
                        this.client._onSettingsChanged({property: property, value: value, type: $input.prop('type')});
                    } else {
                        console.error('settings;', 'input element not found! ', property, value);
                    }
                }
            },


            show: function () {
                this.$el.removeClass('showBlackList').css({
                    top: ($(window).height() / 2) - (this.$el.outerHeight() / 2),
                    left: ($(window).width() / 2) - (this.$el.outerWidth() / 2)
                })
                    .show();
                this.load();
                this.isClosed = false;
            },

            showBlackList: function () {
                this.$el.addClass('showBlackList');
            },

            removeUser: function(e){
                var $target = $(e.target);
                this.client.chatManager.removeUserFromBlackList($target.attr('data-userId'));
            },

            renderBlackList: function(blacklist) {
                blacklist = blacklist || this.client.settings.blacklist;
                var block = this.$el.find('.blacklistContainer div').empty();
                if ($.isEmptyObject(blacklist)){
                    block.append('<i>' + this.client.locale.settings.emptyBL + '</i>');
                } else {
                    for (var userId in blacklist){
                        block.append(this.tplUser({
                            user: blacklist[userId],
                            locale: this.client.locale.settings
                        }));
                    }
                }
            },

            getCurrentSettings: function() {
                var defaultSettings = this.client.defaultSettings,
                    settings = $.extend({}, this.client.settings),
                    value, $input;
                for (var property in defaultSettings){
                    if (property != 'blacklist' && defaultSettings.hasOwnProperty(property)){
                        value = settings[property];
                        if (typeof value == "boolean") {
                            $input = this.$el.find('input[name=' + property + ']');
                            value = $input.prop('checked');
                        }
                        else {
                            $input = this.$el.find('input[name=' + property + ']:checked');
                            value = $input.val();
                        }
                        if ($input) {
                            settings[property] = value;
                        } else {
                            settings[property] = this.client.settings[property]
                        }
                    }
                }
                return settings;
            }

        });


        return SettingsView;
    });


define('text!tpls/v6-buttonsPanel.ejs',[],function () { return '<div class="v6-buttonsPanel">\r\n<span data-action="zoomOut" class="zoomOut"> </span>\r\n<span data-action="zoomIn" class="zoomIn"> </span>\r\n<span data-action="fullScreenOn" class="fullScreenOn switchScreen"> </span>\r\n<span data-action="soundOff" class="soundOff switchSound"> </span>\r\n</div>';});

/*!
* screenfull
* v2.0.0 - 2014-12-22
* (c) Sindre Sorhus; MIT License
*/
!function(){var a="undefined"!=typeof module&&module.exports,b="undefined"!=typeof Element&&"ALLOW_KEYBOARD_INPUT"in Element,c=function(){for(var a,b,c=[["requestFullscreen","exitFullscreen","fullscreenElement","fullscreenEnabled","fullscreenchange","fullscreenerror"],["webkitRequestFullscreen","webkitExitFullscreen","webkitFullscreenElement","webkitFullscreenEnabled","webkitfullscreenchange","webkitfullscreenerror"],["webkitRequestFullScreen","webkitCancelFullScreen","webkitCurrentFullScreenElement","webkitCancelFullScreen","webkitfullscreenchange","webkitfullscreenerror"],["mozRequestFullScreen","mozCancelFullScreen","mozFullScreenElement","mozFullScreenEnabled","mozfullscreenchange","mozfullscreenerror"],["msRequestFullscreen","msExitFullscreen","msFullscreenElement","msFullscreenEnabled","MSFullscreenChange","MSFullscreenError"]],d=0,e=c.length,f={};e>d;d++)if(a=c[d],a&&a[1]in document){for(d=0,b=a.length;b>d;d++)f[c[0][d]]=a[d];return f}return!1}(),d={request:function(a){var d=c.requestFullscreen;a=a||document.documentElement,/5\.1[\.\d]* Safari/.test(navigator.userAgent)?a[d]():a[d](b&&Element.ALLOW_KEYBOARD_INPUT)},exit:function(){document[c.exitFullscreen]()},toggle:function(a){this.isFullscreen?this.exit():this.request(a)},raw:c};return c?(Object.defineProperties(d,{isFullscreen:{get:function(){return!!document[c.fullscreenElement]}},element:{enumerable:!0,get:function(){return document[c.fullscreenElement]}},enabled:{enumerable:!0,get:function(){return!!document[c.fullscreenEnabled]}}}),void(a?module.exports=d:window.screenfull=d)):void(a?module.exports=!1:window.screenfull=!1)}();
define("screenfull", function(){});

define('views/buttons_panel',['underscore', 'backbone', 'text!tpls/v6-buttonsPanel.ejs', 'screenfull'],
    function (_, Backbone, tplMain, screenfull) {
        screenfull = window.screenfull;
        
        var ButtonsPanelView = Backbone.View.extend({
            tagName: 'div',
            id: 'v6-buttonsPanel',
            tplMain: _.template(tplMain),
            events: {
                'click  span': 'buttonClick'
            },
            buttonClick: function (e) {
                var btn = $(e.currentTarget);
                console.log(btn.attr('data-action'));
                switch (btn.attr('data-action')) {
                    case 'zoomOut':
                        this.zoom(-1);
                        break;
                    case 'zoomIn':
                        this.zoom(+1);
                        break;
                    case 'fullScreenOn':
                        this.fullScreen(true);
                        btn.attr('data-action', 'fullScreenOff');
                        break;
                    case 'fullScreenOff':
                        this.fullScreen(false);
                        btn.attr('data-action', 'fullScreenOn');
                        break;
                    case 'soundOn':
                        this.setSound(true);
                        break;
                    case 'soundOff':
                        this.setSound(false);
                        break;
                }
            },
            initialize: function (_client) {
                this.images = _client.opts.images;
                this.client = _client;
                this.locale = _client.locale.userList;
                this.$el.html(this.tplMain());
                this.listenTo(this.client, 'settings_saved', this.applySettings.bind(this));
                this.listenTo(this.client, 'login', this.applySettings.bind(this));
                document.addEventListener(screenfull.raw.fullscreenchange, this.onFullScreenChange.bind(this));
            },
            applySettings: function () {
                if (!this.client.opts.showButtonsPanel) return;
                this.setSound(this.client.settings.sounds);
            },
            setSound: function(value){
                if (!this.client.opts.showButtonsPanel) return;
                this.client.settings.sounds = value;
                var action = value ? 'soundOff' : 'soundOn'
                    ,$btn = this.$el.find('.v6-buttonsPanel .switchSound');
                $btn.removeClass('soundOff').removeClass('soundOn').addClass(action).attr('data-action', action);
            },
            zoom: function(value) {
                document.body.style['transform-origin'] = '0 0';
                var zoom = 1, delta = 0.02;
                if (document.body.style.transform && document.body.style.transform.substring(0,6) == "scale("){
                    try {
                        zoom = document.body.style.transform.substring(6);
                        zoom = parseFloat(zoom.substring(0, zoom.length - 1));
                    } catch (e){
                        console.error(e);
                        zoom = 1;
                    }
                    if (zoom < 0) zoom = 1;
                }
                if (value > 0) zoom += delta; else zoom -= delta;
                document.body.style.transform = "scale(" + zoom + ")";
            },
            fullScreen: function(value){
                if (screenfull.enabled) {
                    if (value) {
                        screenfull.request();
                    } else screenfull.exit();
                }

            },
            onFullScreenChange: function(){
                var action = screenfull.isFullscreen ? 'fullScreenOff' : 'fullScreenOn'
                    ,$btn = this.$el.find('.v6-buttonsPanel .switchScreen');
                $btn.removeClass('fullScreenOn').removeClass('fullScreenOff').addClass(action).attr('data-action', action);
                this.client.emit('full_screen', screenfull.isFullscreen);
            }
        });

        function fullScreen(o) {
            var doc = document.body;
            if(doc.requestFullscreen){
                doc.requestFullscreen();
            }
            else if(doc.mozRequestFullScreen){
                doc.mozRequestFullScreen();
            }
            else if(doc.webkitRequestFullScreen){
                doc.webkitRequestFullScreen();
            }
        }

        function fullScreenCancel() {
            if(document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if(document.webkitCancelFullScreen ) {
                document.webkitCancelFullScreen();
            } else if(document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            }
        }
        return ButtonsPanelView;
    });
define('modules/views_manager',['views/user_list', 'views/dialogs', 'views/chat', 'views/settings', 'views/buttons_panel'],
    function(userListView, dialogsView, v6ChatView, v6SettingsView, v6ButtonsView) {
    var ViewsManager = function(client){
        this.client = client;
        this.userListView = null;
        this.dialogsView = dialogsView;
        this.chat = null;

        client.on('disconnected', function () {
            this.closeAll();
        }.bind(this));
    };

    ViewsManager.prototype.init = function() {
        this.userListView = new userListView(this.client);
        this.dialogsView.init(this.client);
        this.v6ChatView = new v6ChatView(this.client);
        this.settingsView = new v6SettingsView(this.client);
        if (this.client.vkEnable) this.userListView.addInviteFriendButton();
        if (this.client.conf.showButtonsPanel) this.showButtonPanel();

        // append blocks
        if ($('#left-block').length){
            $('#left-block')
                .empty()
                .append(this.userListView.el)
                .append(this.v6ChatView.el);
        } else {

            if (this.client.opts.blocks.userListId)
                $('#'+this.client.opts.blocks.userListId).append(this.userListView.el);
            else
                $('body').append(this.userListView.el);

            if (this.client.opts.blocks.chatId)
                $('#'+this.client.opts.blocks.chatId).append(this.v6ChatView.el);
            else
                $('body').append(this.v6ChatView.el);
        }
    };

    ViewsManager.prototype.closeAll = function(){
        this.client.ratingManager.close();
        this.client.historyManager.close();
        if (!this.settingsView.isClosed) this.settingsView.save();
    };

    ViewsManager.prototype.showSettings = function () {
        if (!this.client.isLogin) return;
        this.settingsView.isClosed ? this.settingsView.show() : this.settingsView.save();
    };

    ViewsManager.prototype.showButtonPanel = function() {
        this.client.opts.showButtonsPanel = true;
        this.buttonsView = new v6ButtonsView(this.client);
        this.userListView.$el.append(this.buttonsView.$el);
    };


    ViewsManager.prototype.showUserProfile = function (userId, userName) {
        if (!this.$profileDiv) {
            this.$profileDiv = $('<div id="v6-profileDiv">');
        }
        this.$profileDiv.addClass('v6-block-border');
        this.$profileDiv.empty();
        this.$profileDiv.append('<img  class="closeIcon" src="' + this.client.opts.images.close +  '">');
        this.$profileDiv.append("<div class='stats-area-wrapper'></div>");
        this.$profileDiv.find(".stats-area-wrapper").append("<h4 style='color: #444;font-size: 10pt;padding-left: 5px; text-align: center;'>" + userName + "</h4>");
        this.closeAll();
        if (window.LogicGame && window.LogicGame.hidePanels && window.ui) {
            this.$profileDiv.find('img').click(function () {
                window.LogicGame.hidePanels();
            });
            $.post("/gw/profile/loadProfile.php", {
                sessionId: window._sessionId,
                userId: window._userId,
                playerId: userId
            }, function (data) {
                window.LogicGame.hidePanels();
                var pData = JSON.parse(data);
                if (!pData.profile.playerName) {
                    console.warn('bad profile', pData.profile);
                    return;
                }
                this.$profileDiv.find(".stats-area-wrapper").append(window.ui.userProfile.renderProfile(pData.profile));
                showProfile.bind(this)();
                window.ui.userProfile.bindActions(pData.profile);
            }.bind(this))
        } else {
            this.$profileDiv.find('img').click(function () {
                $(this.$profileDiv).hide();
            }.bind(this));
            showProfile.bind(this)();
        }

        function showProfile() {
            if (this.client.opts.blocks.profileId) {
                $('#'+ this.client.opts.blocks.profileId).append(this.$profileDiv);
            } else {
                $('body').append(this.$profileDiv);
            }
            this.client.historyManager.getProfileHistory(null, userId, 'v6-profileDiv');
            this.showPanel(this.$profileDiv);
        }
    };


    ViewsManager.prototype.showPanel = function ($panel) {
    // try use logic game show panel, auto hide others, opened the same
        try{
            if (window.ui && window.ui.showPanel) {
                window.ui.showPanel({id: $panel.attr('id')})
            } else{
                $panel.show();
            }
        } catch (e){
            console.error('views_manager;', 'show_panel', e);
        }
        if (!window._isVk)
        $('html, body').animate({
            scrollTop: $panel.offset().top - 350
        }, 500);
    };

    return ViewsManager;
});
/**
 * Obscene words detector for russian language
 *
 * @name antimat
 * @version 0.0.1
 * @license MIT License - http://www.opensource.org/licenses/mit-license.php
 * @see https://github.com/itlessons/js-antimat
 *
 * Copyright (c) 2014, www.itlessons.info
 */
(function () {

    var t = {};

    window.containsMat = function (text) {
        return t.containsMat(text);
    };

    window.antimat = t;

    t.badPatternsTrue = [
        ".*a.*p.*p.*4.*2.*1.*4.*7.*"
    ];

    t.badPatterns = [
        "^(о|а)н(о|а)нист.*",
        "^лошар.*",
        "^к(а|о)злина$",
        "^к(о|а)зел$",
        "^сволоч(ь|ъ|и|уга|ам|ами).*",
        "^лох[уеыаоэяию].*",
        ".*урод(ы|у|ам|ина|ины).*",
        ".*бля(т|д).*", ".*гандо.*",
        "^м(а|о)нд(а|о).*",
        ".*сперма.*",
        ".*[уеыаоэяию]еб$",
        "^сучк(а|у|и|е|ой|ай).*",
        "^придур(ок|ки).*",
        "^д(е|и)би(л|лы).*",
        "^сос(ать|и|ешь|у)$",
        "^залуп.*",
        "^муд(е|ил|о|а|я|еб).*",
        ".*шалав(а|ы|ам|е|ами).*",
        ".*пр(а|о)ст(и|е)т(у|е)тк(а|и|ам|е|ами).*",
        ".*шлюх(а|и|ам|е|ами).*",
        ".*ху(й|и|я|е|л(и|е)).*",
        ".*п(и|е|ы)зд.*",
        "^бл(я|т|д).*",
        "(с|сц)ук(а|о|и|у).*",
        "^еб.*",
        ".*(д(о|а)лб(о|а)|разъ|разь|за|вы|по)ебы*.*",
        ".*пид(а|о|е)р.*",
        ".*хер.*",
        // appended
        "идиот", 
        "коз(е|ё)л",
        "п(и|е)дрила",
        "лошара",
        "уе(бок|бан)",
        "сучка",
        "отсоси",
        "педик",
        "лесбиянк.*",
        "козлы",
        "говно",
        "жопа",
        "гнидовский",
        "обоссал.*"
    ];

    t.goodPatterns = [
        ".*психу.*",
        ".*плох.*",
        ".*к(о|а)манд.*",
        ".*истр(е|и)блять.*",
        ".*л(о|а)х(о|а)трон.*",
        ".*(о|а)ск(о|а)рблять.*",
        "хул(е|и)ган",
        ".*м(а|о)нд(а|о)рин.*",
        ".*р(а|о)ссл(а|о)блять.*",
        ".*п(о|а)тр(е|и)блять.*",
        ".*@.*\\.(ру|сом|нет)$"
    ];

    t.goodWords = [
        "дезмонда",
        "застрахуйте",
        "одномандатный",
        "подстрахуй",
        "психуй"
    ];

    t.letters = {
        "a": "а",
        "b": "в",
        "c": "с",
        "e": "е",
        "f": "ф",
        "g": "д",
        "h": "н",
        "i": "и",
        "k": "к",
        "l": "л",
        "m": "м",
        "n": "н",
        "o": "о",
        "p": "р",
        "r": "р",
        "s": "с",
        "t": "т",
        "u": "у",
        "v": "в",
        "x": "х",
        "y": "у",
        "w": "ш",
        "z": "з",
        "ё": "е",
        "6": "б",
        "9": "д"
    };

    t.containsMat = function (text) {

        if (t.isInBadTruePatterns(text)) return true;

        text = t.cleanBadSymbols(text.toLowerCase());

        var words = text.split(" ");

        for (var i = 0; i < words.length; i++) {

            var word = t.convertEngToRus(words[i]);

            if (t.isInGoodWords(word) && t.isInGoodPatterns(word))
                continue;

            if (t.isInBadPatterns(word))
                return true;
        }

        if (t.containsMatInSpaceWords(words))
            return true;

        return false;
    };

    t.convertEngToRus = function (word) {
        for (var j = 0; j < word.length; j++) {
            for (var key in t.letters) {
                if (word.charAt(j) == key)
                    word = word.substring(0, j) + t.letters[key] + word.substring(j + 1, word.length)
            }
        }

        return word;
    };

    t.cleanBadSymbols = function (text) {
        return text.replace(/[^a-zA-Zа-яА-Яё0-9\s]/g, "");
    };

    t.isInGoodWords = function (word) {

        for (var i = 0; i < t.goodWords.length; i++) {
            if (word == t.goodWords[i])
                return true;
        }

        return false;
    };

    t.isInGoodPatterns = function (word) {

        for (var i = 0; i < t.goodPatterns.length; i++) {
            var pattern = new RegExp(t.goodPatterns[i]);
            if (pattern.test(word))
                return true;
        }

        return false;
    };

    t.isInBadTruePatterns = function (word) {

        for (var i = 0; i < t.badPatternsTrue.length; i++) {
            var pattern = new RegExp(t.badPatternsTrue[i]);
            if (pattern.test(word))
                return true;
        }

        return false;
    };

    t.isInBadPatterns = function (word) {

        for (var i = 0; i < t.badPatterns.length; i++) {
            var pattern = new RegExp(t.badPatterns[i]);
            if (pattern.test(word))
                return true;
        }

        return false;
    };

    t.containsMatInSpaceWords = function (words) {
        var spaceWords = t.findSpaceWords(words);

        for (var i = 0; i < spaceWords.length; i++) {

            var word = t.convertEngToRus(spaceWords[i]);

            if (t.isInBadPatterns(word))
                return true;
        }

        return false;
    };

    t.findSpaceWords = function (words) {

        var out = [];
        var spaceWord = "";

        for(var i=0; i < words.length; i++ ){
            var word = words[i];

            if(word.length <= 3){
                spaceWord += word;
                continue;
            }

            if(spaceWord.length >= 3){
                out.push(spaceWord);
                spaceWord = "";
            }
        }

        return out;
    };

    t.addBadPattern = function (pattern) {
        t.badPatterns.push(pattern);
    };

    t.addGoodPattern = function (pattern) {
        t.goodPatterns.push(pattern);
    };

    t.addGoodWord = function (pattern) {
        t.goodWords.push(pattern);
    };

})();
define("antimat", function(){});

define('modules/chat_manager',['EE', 'translit', 'antimat'], function(EE, translit) {
    
    var ChatManager = function (client) {
        this.client = client;
        this.first = {};
        this.last = {};
        this.fullLoaded = {};
        this.messages = {};
        this.current = client.game;
        this.currentType = 'public';
        this.MSG_COUNT = 20;
        this.MSG_INTERVBAL = 1500;

        client.on('login', this.onLogin.bind(this));
        client.on('relogin', this.onLogin.bind(this));

        client.gameManager.on('game_start', function(room){
            if (this.client.opts.showSpectators){
                this.openDialog(room.id, 'room', true);
            }
            if (!room.isPlayer) return;
            for (var i = 0; i < room.players.length; i++){
                if (!room.players[i].isPlayer) {
                    this.openDialog(room.players[i].userId, room.players[i].userName);
                }
            }
        }.bind(this));

        client.gameManager.on('game_leave', function(room){
            if (this.client.opts.showSpectators){
                this.closeDialog(room.id, 'room');
            }
            if (!room.isPlayer) return;
            for (var i = 0; i < room.players.length; i++){
                if (!room.players[i].isPlayer) {
                    this.closeDialog(room.players[i].userId);
                }
            }
        }.bind(this));

        client.on('disconnected', function () {});
    };

    ChatManager.prototype = new EE();

    ChatManager.prototype.initMessage = function (message, player, mode) {
        if (message.userData[mode]) message.rank = message.userData[mode].rank;
        if (!message.rank || message.rank < 1) message.rank = '—';
        if (message.target == player.userId) // is private message, set target sender
        {
            message.target = message.userId;
        }

        if (message.admin) {
            message.rank = '';
            message.userId = 0;
            message.userName = 'Админ'
        }

        if (this.client.lang != 'ru'){
            message.userName = translit(message.userName);
            message.text = translit(message.text);
        }

        message.date = new Date(message.time);
        var h = message.date.getHours();
        var m = message.date.getMinutes();
        if (h < 10) h = '0' + h;
        if (m < 10) m = '0' + m;
        message.t = h + ':' + m;
        message.d = message.date.getDate() + ' ' + this.client.locale['chat']['months'][message.date.getMonth()] + ' ' + message.date.getFullYear();
        return message;
    };

    ChatManager.prototype.onLogin = function() {
        this.first = {};
        this.last = {};
        this.fullLoaded = {};
        this.messages = {};
        this.current = this.client.game;
        this.client.viewsManager.v6ChatView.setPublicTab(this.client.game);
        this.loadMessages();
    };

    ChatManager.prototype.onMessage = function (message) {
        var data = message.data, player = this.client.getPlayer(), i, cache;
        console.log('chat_manager;', 'message', message);
        switch (message.type) {
            case 'message':
                message = this.initMessage(data, player, this.client.currentMode);
                if (!this.first[message.target]) this.first[message.target] = message;

                if (!this.messages[message.target]) this.messages[message.target] = [];
                cache = this.messages[message.target];
                cache.push(message);
                if (cache.length>100) cache.shift();

                this.emit('message', message);
                this.last[message.target] = message;

                if (this.client.getUser(message.target) && message.target != this.current) this.openDialog(message.userId, message.userName);
                break;
            case 'load':
                if (!data || !data.length || data.length < 1) {
                    this.fullLoaded[this.current] = true;
                    this.emit('load', null);
                    return;
                }
                message = this.initMessage(data[0], player, this.client.currentMode);
                if (!this.messages[message.target]) this.messages[message.target] = [];
                cache = this.messages[message.target];
                for (i = 0; i < data.length; i++){
                   this.onMessageLoad(this.initMessage(data[i], player, this.client.currentMode), cache);
                }
                break;
            case 'ban':
                this.ban = message.data;
                this.emit('show_ban', message.data);
                break;
        }
    };


    ChatManager.prototype.sendMessage = function (text, target, type, admin){
        if (this.ban){
            this.emit('show_ban', this.ban);
            return;
        }
        text = text.trim();

        if (typeof text != "string" || !text.length){
            return;
        }

        if (window.containsMat(text)){
            console.warn('chat_manager; censored text', text);
            return;
        }
        if (this.lastMessageTime &&  Date.now() - this.lastMessageTime < this.MSG_INTERVBAL ){
            console.warn('chat_manager; many messages in the same time');
            return
        }
        text = text.replace(/слава.*укра[иiії]н[иеіiї]/gim, "Слава СССР");
        text = text.replace(/героям.*слава/gim, "Вам Слава");
        this.lastMessageTime = Date.now();
        var message = {
            text: text
        };
        if (admin) message.admin = true;
        if (!target) message.target = this.current;
        type = type || this.currentType;
        console.log('chat_manager;', 'send message', text, target, type, admin);
        this.client.send('chat_manager', 'message', 'server', message);
    };


    ChatManager.prototype.loadMessages = function (count, time, target, type) {
        type = type || this.currentType;
        if (this.fullLoaded[this.current]){
            console.log('chat_manager;', 'all messages loaded!', count, time, this.first);
            this.emit('load', null);
            return;
        }
        count = count || this.MSG_COUNT;
        if (!target) target = this.current;
        time = time || (this.first[target]?this.first[target].time:null);
        console.log('chat_manager;', 'loading messages', count, time, this.first, type);
        var rq = {
            count: count,
            time: time,
            target: target,
            sender: this.client.getPlayer().userId,
            type: type
        };
        if (this.client.opts.apiEnable) {
            this.client.get('chat', rq, function(data){
                this.onMessage({
                    type: 'load',
                    data: data
                })
            }.bind(this))
        } else {
            this.client.send('chat_manager', 'load', 'server', rq);
        }
    };


    ChatManager.prototype.onMessageLoad = function(message, cache){
        if (cache && cache.length<100) cache.unshift(message);
        if (!this.client.settings.blacklist[message.userId]) {
            if (!this.first[message.target]) this.first[message.target] = message;
            if (!this.last[message.target]) this.last[message.target] = message;
            this.emit('load', message);
            this.first[message.target] = message;
        }
    };


    ChatManager.prototype.openDialog = function(userId, userName, room){
        this.current = userId;
        if (room) {
            this.currentType = 'room';
            this.emit('open_dialog', { roomId: userId });
        }
        else {
            this.currentType = 'private';
            this.emit('open_dialog', { userId: userId, userName: userName });
        }
        this.loadCachedMessages(userId);
    };


    ChatManager.prototype.closeDialog = function (target){
        this.currentType = 'public';
        this.emit('close_dialog', target || this.current);
        this.loadCachedMessages(this.client.game);
    };


    ChatManager.prototype.loadCachedMessages = function (target, type){
        this.current = target;
        this.currentType = type || this.currentType;
        this.first[target] = this.last[target] = null;
        if (this.messages[target] && this.messages[target].length>0){ // load cached messages;
            for (var i = this.messages[target].length - 1; i >= 0; i-- ){
                this.onMessageLoad(this.messages[target][i]);
            }
        }
        if (this.messages[target] && this.messages[target].length > 0
            && this.messages[target].length < this.MSG_COUNT) {
            this.loadMessages(this.MSG_COUNT, this.messages[target][0].time, target);
        }  else this.loadMessages(this.MSG_COUNT, null, target);
    };


    ChatManager.prototype.addUserToBlackList = function(user){
        if (user.userId == this.client.getPlayer().userId) return;
        var blacklist = this.client.settings.blacklist;
        if (blacklist[user.userId]){
            console.warn('chat_manager;', 'addUserToBlackList', 'user ', user, 'already in list');
            return;
        }
        blacklist[user.userId] = {
            userId: user.userId,
            userName: user.userName,
            time: Date.now()
        };
        this.client._onSettingsChanged({property: 'blacklist', value: blacklist});
    };

    ChatManager.prototype.removeUserFromBlackList = function(userId){
        var blacklist = this.client.settings.blacklist;
        if (blacklist[userId]){
            delete blacklist[userId];
            this.client._onSettingsChanged({property: 'blacklist', value: blacklist});
            return;
        }
        console.warn('chat_manager;', 'removeUserFromBlackList', 'userId ', userId, 'not in list');
    };


    ChatManager.prototype.banUser = function(userId, days, reason) {
        console.log('chat_manager;', 'banUser', userId, days, reason);
        this.client.send('chat_manager', 'ban', 'server', {userId:userId, days:days, reason:reason});
    };

    ChatManager.prototype.deleteMessage = function(time) {
        console.log('chat_manager;', 'deleteMessage', time);
        this.client.send('chat_manager', 'delete', 'server', {time:time});
    };

    return ChatManager;
});

define('text!tpls/v6-historyMain.ejs',[],function () { return '<div id="v6-history" class="v6-block-border">\r\n    <div class="historyHeader">\r\n        <div class="historyFilter">\r\n            <input type="text" placeholder="<%= locale.placeholder %>" id="historyAutoComplete" value="">\r\n            <div class="delete" style="background-image: url(<%= imgDel %>)"></div>\r\n        </div>\r\n        <img class="closeIcon" src="<%= close %>" title="<%= locale.close %>">\r\n    </div>\r\n    <div class="historyWrapper">\r\n        <table class="historyTable">\r\n            <thead>\r\n                <tr></tr>\r\n            </thead>\r\n            <tbody>\r\n            </tbody>\r\n        </table>\r\n        <div id="showMore"><%= locale.showMore%></div>\r\n        <div class="noHistory"><%= locale.noHistory %></div>\r\n        <div class="loading"><img src="<%= spin %>"></div>\r\n    </div>\r\n</div>';});


define('text!tpls/v6-historyHeaderTD.ejs',[],function () { return '<td class="sessionHeader historyDate" rowspan="<%= rows %>"> <%= date %> </td>\r\n<td class="sessionHeader historyName" rowspan="<%= rows %>">\r\n    <span class="userName" data-userid="<%= userId %>"><%= userName %></span>\r\n    <span class="userRank">(<%= rank %>)</span>\r\n    <div class="userScore"><%= score %></div>\r\n    <div class="eloDiff <%= (eloDiff>-1?\'diffPositive\':\'diffNegative\')%>"><%= eloDiff ===\'\'?\'\':(eloDiff>-1?\'+\'+eloDiff:eloDiff)%></div>\r\n    <% if (rankDiff) {%><div class="userRank"><%= rankDiff %></div><%}%>\r\n</td>';});


define('text!tpls/v6-historyTH.ejs',[],function () { return '<th colspan="<%= colspan %>" title="<%= title %>"><%= value %></th>';});


define('text!tpls/v6-historyTR.ejs',[],function () { return '<tr class="<%= trclass %>" data-id="<%= id %>" ><%= value %></tr>';});


define('text!tpls/v6-ratingTab.ejs',[],function () { return '<span class="unactiveLink"  data-idtab="<%= id %>"><%= title %></span>&nbsp;&nbsp;';});

define('views/history',['underscore', 'backbone', 'text!tpls/v6-historyMain.ejs', 'text!tpls/v6-historyHeaderTD.ejs', 'text!tpls/v6-historyTH.ejs', 'text!tpls/v6-historyTR.ejs', 'text!tpls/v6-ratingTab.ejs'],
    function(_, Backbone, tplMain, tplTD, tplTH, tplTR, tplTab) {
        

        var HistoryView = Backbone.View.extend({
            tagName: 'div',
            id: 'v6History',
            tplMain: _.template(tplMain),
            tplHeadTD: _.template(tplTD),
            tplTD: function(value){return '<td>'+value+'</td>'},
            tplTH: _.template(tplTH),
            tplTR: _.template(tplTR),
            tplTRpenalty: function(date, value, columns){return '<tr class="historyPenalty"><td>'+date+'</td><td colspan="'+columns+'">'+value+'</td></tr>'},
            tplTab: _.template(tplTab),
            events: {
                'click .closeIcon': 'close',
                'click .historyTable tr': 'trClicked',
                'click .historyTable .userName': 'userClicked',
                'click .historyHeader span': 'tabClicked',
                'click #showMore': 'showMore',
                'keyup #historyAutoComplete': 'filterChanged',
                'click .delete': 'clearFilter'
            },
            initialize: function(_conf, manager) {
                this.conf = _conf;
                this._manager = manager;
                this.locale = manager.client.locale.history;
                this.tabs = _conf.tabs;
                this.columns = _conf.columns;
                this.$el.html(this.tplMain({
                    close: _conf.images.close, imgDel: _conf.images.del, spin: _conf.images.spin, locale: this.locale
                }));

                this.$head = this.$el.find('.historyHeader');
                this.$titles = $(this.$el.find('.historyTable thead tr')[0]);
                this.$tbody = $(this.$el.find('.historyTable tbody')[0]);
                this.$noHistory = $(this.$el.find('.noHistory'));
                this.$showMore = $(this.$el.find('#showMore'));
                this.$filter = $(this.$el.find('#historyAutoComplete'));

                this.ACTIVE_TAB = 'activeLink';
                this.UNACTIVE_TAB = 'unactiveLink';
                this.WIN_CLASS = 'historyWin';
                this.LOSE_CLASS = 'historyLose';
                this.DRAW_CLASS = 'historyDraw';
                this.SELECTED_CLASS = 'historySelected';

                this.renderTabs();
                this.renderHead();

                this.isClosed = false;
            },

            trClicked: function(e){
                if ($(e.target).hasClass('userName')) return;
                var id  = $(e.currentTarget).attr('data-id');
                this.$el.find('.' + this.SELECTED_CLASS).removeClass(this.SELECTED_CLASS);
                $(e.currentTarget).addClass(this.SELECTED_CLASS);
                this._manager.getGame(id);
            },

            userClicked: function (e){
                var userId  = $(e.currentTarget).attr('data-userid');
                var userName = $(e.currentTarget).html();
                this._manager.client.onShowProfile(userId, userName);
            },

            tabClicked: function(e){
                var id  = $(e.currentTarget).attr('data-idtab');
                this.setActiveTab(id);
                this._manager._getHistory(id, null, false);
            },

            filterChanged: function(e) {
                if (e.type === 'keyup')
                    if (e.keyCode == 13 || e.target.value.length == 0) {
                        this._manager._getHistory(this.currentTab.id, null, false);
                }
            },

            clearFilter: function() {
                this.setFilter('');
                this._manager._getHistory(this.currentTab.id, null, false);
            },

            close: function () {
                this.$el.hide();
                this.isClosed = true;
                this.setFilter('');
            },

            showMore:function () {
                this._manager._getHistory(this.currentTab.id, null, true);
            },

            renderTabs: function() {
                for (var i = this.tabs.length - 1; i >= 0; i--){
                    this.$head.prepend(this.tplTab(this.tabs[i]));
                    this.setActiveTab(this.tabs[0].id);
                }
                if (!this.tabs || this.tabs.length == 0) {
                    this.currentTab = {
                        id: this._manager.client.currentMode
                    }
                }
            },

            renderHead:function() {
                for (var i = 0; i < this.columns.length; i++){
                    this.$titles.append(this.tplTH({
                            title: this.columns[i].title,
                            value: this.columns[i].title,
                            colspan: this.columns[i].dynamic?2:1
                        })
                    );
                }
            },

            renderHistory: function (mode, history) {
                for (var i = 0; i < history.length; i++) {
                    this.renderSession(mode, history[i]);
                }
            },

            renderSession:function(mode, session){
                var row, trclass;
                if (session.penalty){
                    this.$tbody.append(
                        this.tplTRpenalty(session.date, session.text, this.columns.length)
                    );
                }
                for (var i = 0; i < session.length; i++){
                    row = this.renderRow(mode, session[i], i==0, session.length);
                    if (session[i].result == 'draw') trclass = this.DRAW_CLASS;
                    else if (session[i].result == 'win') trclass = this.WIN_CLASS;
                         else trclass = this.LOSE_CLASS;

                    this.$tbody.append(this.tplTR({
                        title:session[i].result,
                        trclass:trclass,
                        id:session[i].id,
                        value:row
                    }));
                }
            },

            renderRow: function(mode, row, isFirst, count){
                var columns = "", col;
                if (isFirst){
                    columns = this.tplHeadTD({
                        rows:count,
                        date:row.date,
                        userId: row.opponent.userId,
                        userName: row.opponent.userName,
                        rank: row.opponent[mode]['rank'],
                        eloDiff: count>1?row.elo.diff:'',
                        rankDiff: count>1?row.rank.before+' → '+row.rank.after:'',
                        score: row.gameScore
                    });
                }
                for (var i = 2; i < this.columns.length; i++){
                    col = row[this.columns[i].source];
                    if (col == undefined) col = this.columns[i].undef;
                    if (this.columns[i].dynamic){
                        columns += this.tplTD((col['dynamic']>-1&&col['dynamic']!==''?'+':'')+ col['dynamic']);
                        columns += this.tplTD(col['value']);
                    } else
                    columns += this.tplTD(col);
                }

                return columns;
            },

            render: function(mode, history, hideClose, showMore) {
                this.$el.show();
                this.setActiveTab(mode);

                if (this.$filter.val().length > 0) this.$filter.parent().find('.delete').show();
                else this.$filter.parent().find('.delete').hide();

                if (hideClose === true) this.$el.find('.closeIcon').hide();
                if (hideClose === false) this.$el.find('.closeIcon').show();
                if (!showMore) this.$showMore.hide(); else this.$showMore.show();

                if (!history) {
                    this.isClosed = false;
                    this.$el.find('.loading').show();
                    this.$noHistory.hide();
                }
                else {
                    this.clearHistory();
                    if (history.length == 0) this.$noHistory.show();
                    this.$el.find('.loading').hide();
                    console.log('render history', history);
                    this.renderHistory(mode, history);
                }

                return this;
            },

            clearHistory: function() {
                this.$tbody.children().remove();
            },

            setActiveTab: function(id){
                if (!id || !this.tabs || this.tabs.length < 2) return;
                for (var i = 0; i < this.tabs.length; i++){
                    this.tabs[i].active = false;
                    if (this.tabs[i].id != id)
                        this.$head.find('span[data-idtab="'+this.tabs[i].id+'"]').removeClass(this.ACTIVE_TAB).addClass(this.UNACTIVE_TAB);
                    else {
                        this.$head.find('span[data-idtab="'+this.tabs[i].id+'"]').removeClass(this.UNACTIVE_TAB).addClass(this.ACTIVE_TAB);
                        this.currentTab = this.tabs[i];
                    }
                }
            },


            setFilter: function(filter) {
                this.$filter.val(filter);
            },

            getFilter: function() {
                return this.$filter.val();
            }

        });
        return HistoryView;
    });
define('modules/history_manager',['EE', 'translit', 'views/history', 'instances/turn', 'instances/game_event', 'instances/time'],
    function(EE, translit, HistoryView, Turn, GameEvent, Time) {
    

    var locale;
    var HistoryManager = function (client) {
        this.client = client;
        locale = client.locale['history'];
        this.conf = {
            tabs:[],
            subTabs:[],
            columns:[
                {  id:'date',       source:'date',      title: locale.columns.date },
                {  id:'opponent',   source:'opponent',  title: locale.columns.opponent },
                {  id:'elo',        source:'elo',       title: locale.columns.elo, dynamic:true, startValue:1600 },
                {  id:'time',       source:'time',      title: locale.columns.time    },
                {  id:'number',     source:'number',    title: locale.columns.number }
            ]
        };

        if (typeof client.opts.initHistory== "function") this.conf =  client.opts.initHistory(this.conf, this.client);
        this.conf.images = client.opts.images;

        this.$container = (client.opts.blocks.historyId?$('#'+client.opts.blocks.historyId):$('body'));
        this.isCancel = false;
        this.userId = false;
        this.currentMode = false;
        this.maxCount = 100;
        this.count = 0;
        this.history = [];

        client.on('disconnected', function () {
            // TODO: clear all
        })
    };

    HistoryManager.prototype = new EE();


    HistoryManager.prototype.init = function(){
        this.conf.tabs = [];
        if (this.client.modes.length > 1)
            for (var i = 0 ; i < this.client.modes.length; i++)
                this.conf.tabs.push({id:this.client.modes[i], title: this.client.getModeAlias(this.client.modes[i])});
        if (this.historyView && this.historyView.$el){
            this.historyView.$el.remove();
            this.historyView.remove();
        }
        this.historyView = new HistoryView(this.conf, this);
    };


    HistoryManager.prototype.onMessage = function (message) {
        var data = message.data;
        console.log('history_manager;', 'message', message);
        switch (message.type) {
            case 'history': this.onHistoryLoad(data['mode'], data['history'], data['penalties'], data.userId); break;
            case 'game': this.onGameLoad(data.mode, data.game); break;
        }
    };


    HistoryManager.prototype.onHistoryLoad = function (mode, history, penalties, userId){
        console.log('history_manager;', 'history load', userId, history, penalties);
        penalties = penalties || [];
        if (!this.historyView.isClosed) {
            var histTable = [], penalty;
            this.userId = userId;
            this.currentMode = mode;
            this.history = this.history.concat(history);
            var count = this.history.length;
            var player = this.client.userList.getUser(userId);
            if (player) count = player[mode]['games'];
            for (var i = this.history.length - 1; i > -1; i--) {

                if (i == this.history.length - 1) {// first game
                    for (var j = 0; j < penalties.length; j++) { // add penalties
                        penalty = penalties[j];
                        if (penalty.time <= this.history[i].timeEnd) { // find previous penalties
                            histTable.push(this.formatPenaltyRow(penalty));
                            break;
                        }
                    }
                } else {
                    for (j = penalties.length - 1; j > -1; j--) { // add penalties
                        penalty = penalties[j];
                        if (penalty.time < this.history[i].timeEnd && penalty.time >= this.history[i + 1].timeEnd) {
                            histTable.unshift(this.formatPenaltyRow(penalty));
                        }
                    }
                }

                this.formatHistoryRow(this.history[i], histTable, mode, count - i, userId);

                for (j = penalties.length - 1; j > -1; j--) { // add penalties
                    penalty = penalties[j];
                    if (i == 0) {    // last game
                        if (penalty.time >= this.history[i].timeEnd) { // find next penalties
                            histTable.unshift(this.formatPenaltyRow(penalty));
                        }
                    }
                }
            }
            this.$container.append(this.historyView.render(mode, histTable, null, history && history.length == this.maxCount).$el);
        }
    };


    HistoryManager.prototype.onGameLoad = function (mode, game){
        console.log('history_manager;', 'game load', game, 'time:', Date.now() - this.startTime);
        var players = [], i, player;
        if (game) {
            this.client.setMode(mode);
            game.history = '[' + game.history + ']';
            game.history = game.history.replace(new RegExp('@', 'g'), ',');
            game.history = JSON.parse(game.history);
            game.initData = JSON.parse(game.initData);
            game.userData = JSON.parse(game.userData);
            game.isPlayer = false;
            for (i = 0; i < game.players.length; i++) {
                player = this.client.userList.createUser(game.userData[game.players[i]]);
                players.push(player);
                if (player.userId == this.userId) {
                    game.player = player;
                    if (player.userId == this.client.getPlayer().userId) {
                        game.isPlayer = true;
                    }
                }
            }
            if (players.length != players.length) throw new Error('UserData and players are different!');
            game.players = players;
            if (!game.winner){
                game.result = 'draw';
            } else {
                if (game.winner == game.player.userId){
                    game.result = 'win';
                } else {
                    game.result = 'lose';
                }
            }
            game.message = this.getResultMessages(game);

            game.initData.timeMode = game.initData.timeMode || 'reset_every_switch';
            game.initData.timeStartMode = game.initData.timeStartMode || 'after_switch';

            if (this.client.opts.newGameFormat){
                game.initData.first = getPlayer(game.initData.first);
                game.winner = getPlayer(game.winner);
                var current = game.initData.first,
                    times = {}, // contain users total time
                    history = [],
                    turnTime = game.initData.turnTime,
                    totalTime = 0;
                for (i = 0; i < game.history.length; i++){
                    history = history.concat(parseTurn(game.history[i]));
                    if (history[i] instanceof Turn || (history[i] instanceof GameEvent && history[i].event.type == 'timeout')){
                        // init user time
                        // userTurnTime - time remain for turn, userTime - time user turn
                        // clear first turn time; first turn time = turn time - round start time
                        if (game.initData.timeStartMode != 'after_round_start' && $.isEmptyObject(times)){
                            history[i].userTime = 0;
                        }
                        history[i].userTime = history[i].userTime || 0;
                        if (history[i].userTime != null){
                            totalTime += history[i].userTime;
                            if (game.initData.timeMode == 'dont_reset'){ // blitz
                                history[i].userTime = new Time((times[history[i].user.userId] || turnTime) - history[i].userTime || turnTime, turnTime);
                                history[i].userTotalTime = new Time(times[history[i].user.userId] || turnTime, turnTime);

                                // turn contain time for turn for next player
                                history[i].userTurnTime =  history[i].userTurnTime < 0 ? 0 : history[i].userTurnTime;
                                if (history[i].nextPlayer){
                                    times[history[i].nextPlayer.userId] = history[i].userTurnTime
                                } else {
                                    times[history[i].user.userId] = history[i].userTurnTime
                                }
                            } else {
                                times[history[i].user.userId] = times[history[i].user.userId] ? times[history[i].user.userId] + history[i].userTime : history[i].userTime;
                                history[i].userTotalTime = new Time(times[history[i].user.userId] || 0);
                                history[i].userTime = new Time(history[i].userTime);
                            }

                        }
                    }
                }
                game.roundTime = new Time(game.timeEnd - game.timeStart);
                game.totalTime = (totalTime ? new Time(totalTime) : game.roundTime);
                game.history = history;
            }
            console.log('history_manager;', 'game parsed', game);

        }
        if (!this.isCancel) this.emit('game_load', game);

        function getPlayer(id){
            for (var i = 0; i < players.length; i++){
                if (players[i].userId == id) return players[i];
            }
            return null;
        }

        function parseTurn(turn){
            // parse array of user turns
            if (turn.length){
                for (var j = 0; j < turn.length; j++){
                    turn[j] = parseTurn(turn[j]);
                }
            } else { // parse single user turn or game event
                if (turn.type || turn.action == 'timeout'){ // event
                    turn.user = getPlayer(turn.user) || undefined;
                    turn.nextPlayer = getPlayer(turn.nextPlayer) || undefined;
                    turn.target = getPlayer(turn.target) || undefined;
                    turn = new GameEvent(turn);
                } else { // turn
                    turn.nextPlayer = getPlayer(turn.nextPlayer) || undefined;
                    turn = new Turn(turn, current, turn.nextPlayer);
                }
                if (turn.nextPlayer){
                    current = turn.nextPlayer;
                }
            }

            return turn;
        }
    };


    HistoryManager.prototype.getResultMessages = function(game){
        var locale = this.client.locale['game']['resultMessages'], loser, winner, winnerId,
            message = {
                resultMessage: locale[game.result],
                resultComment: ""
            };
        if (game.result != 'draw'){
            if (game.isPlayer){
                if (game.result == 'lose'){
                    switch  (game.action){
                        case 'timeout': message.resultComment =  locale['playerTimeout']; break;
                        case 'user_leave': message.resultComment = locale['playerLeave']; break;
                        case 'throw': message.resultComment = locale['playerThrow']; break;
                    }
                } else { // win
                    switch (game.action) {
                        case 'timeout':
                            message.resultComment = locale['opponentTimeoutPre'] + locale['opponentTimeout'];
                            break;
                        case 'user_leave':
                            message.resultComment = locale['opponent'] + locale['opponentLeave'];
                            break;
                        case 'throw':
                            message.resultComment = locale['opponent'] + locale['opponentThrow'];
                            break;
                    }
                }
            } else{ // spectator
                winnerId = game.winner.userId || game.winner;
                winner = (winnerId == game.players[0].userId ? game.players[0] : game.players[1]);
                loser = (winnerId == game.players[0].userId ? game.players[1] : game.players[0]);
                message.resultMessage = locale['wins'] + winner.userName;

                switch (game.action) {
                    case 'timeout':
                        message.resultComment = locale['timeoutPre'] + loser.userName + locale['opponentTimeout'];
                        break;
                    case 'user_leave':
                        message.resultComment = loser.userName + locale['opponentLeave'];
                        break;
                    case 'throw':
                        message.resultComment = loser.userName + locale['opponentThrow'];
                        break;
                }
            }
        }
        return message;
    };


    HistoryManager.prototype.formatHistoryRow = function(hrow, history, mode, number, userId){
        var rows, row = {win:0, lose:0, id:hrow['_id'], number:number}, prev, userData = JSON.parse(hrow.userData), opponentId;
        //previous game
        if (history.length == 0) {
            rows = [];
            prev = null
        } else {
            rows = history[0];
            prev = rows[0];
        }
        opponentId =  userId == hrow.players[0]? hrow.players[1] : hrow.players[0];
        for (var i = 0; i < this.conf.columns.length; i++){
            var col = this.conf.columns[i];
            if (['date', 'opponent', 'time', 'number', 'elo'].indexOf(col.id) == -1){
                row[col.source] = userData[userId][mode][col.source];
            }
        }
        row.opponent = userData[opponentId];
        if (this.client.lang != 'ru'){
            row.opponent.userName = translit(row.opponent.userName);
        }
        row.date = formatDate(hrow.timeEnd);
        row.time = formatTime(hrow.timeEnd);
        // compute game score
        if (!hrow.winner) row.result = 'draw';
        else {
            if (hrow.winner == userId) {
                row.result = 'win';
                row.win++;
            } else {
                row.result = 'lose';
                row.lose++;
            }
        }
        if (prev && prev.date == row.date && prev.opponent.userId == row.opponent.userId){
            row.win += prev.win;
            row.lose += prev.lose;
        }
        row.gameScore = row.win + ':' + row.lose;
        //compute elo
        row.elo = {
            value:userData[userId][mode]['ratingElo']
        };
        row.rank = {};
        //TODO: dynamic columns
        row.elo.dynamic = prev ? row.elo.value - prev.elo.value : '';
        if (!prev || prev.date != row.date || prev.opponent.userId != row.opponent.userId){ // add new session game
            row.elo.diff = row.elo.dynamic||0;
            row.rank.before =  userData[userId][mode]['rank'];
            row.rank.after = row.rank.before;
            rows = [];
            rows.unshift(row);
            history.unshift([]);
            history[0] = rows
        } else {
            row.rank.before = prev.rank.before;
            row.rank.after = userData[userId][mode]['rank'];
            row.elo.diff = prev.elo.diff + row.elo.dynamic;
            rows.unshift(row);
        }
    };


    HistoryManager.prototype.formatPenaltyRow = function(penalty){
        var hpen = {
            penalty: true,
            time: penalty.time,
            date: formatDate(penalty.time),
            type: penalty.type,
            text: typeof this.client.opts.generatePenaltyText == "function" ? this.client.opts.generatePenaltyText(penalty) : (penalty.value < 0 ? 'штраф в ' : 'бонус в ') + Math.abs(penalty.value) + ' очков',
            value: penalty.value,
            elo: {value: penalty.ratingElo}
        };
        console.log(hpen);
        return hpen
    };


    HistoryManager.prototype.getHistory = function(mode){
        if (!this.client.isLogin) return;
        this.historyView.clearHistory();
        var gm = this.client.gameManager;
        if (this.client.gameManager.inGame()){
            var filter = gm.currentRoom.players[0].isPlayer ? gm.currentRoom.players[1].userName :  gm.currentRoom.players[0].userName;
            if (filter) this.historyView.setFilter(filter);
        }
        this.$container = (this.client.opts.blocks.historyId?$('#'+this.client.opts.blocks.historyId):$('body'));
        this.userId = this.client.getPlayer().userId;
        this._getHistory(mode, false);
        this.client.viewsManager.showPanel(this.historyView.$el);
    };

    HistoryManager.prototype.getProfileHistory = function(mode, userId, blockId){
        if (!this.client.isLogin) return;
        this.historyView.clearHistory();
        this.historyView.setFilter('');
        if (blockId) this.$container = $('#'+blockId);
        if (!this.$container) throw new Error('wrong history container id! ' + blockId);
        this.userId = userId;
        this._getHistory(mode, true);
        this.historyView.delegateEvents();
    };


    HistoryManager.prototype._getHistory = function(mode, hideClose, append){
        if (!append) {
            this.count = 0;
            this.history = [];
        }
        mode = mode || this.client.currentMode;
        this.$container.append(this.historyView.render(mode, false, hideClose).$el);
        var rq = {
            mode:   mode,
            userId: this.userId,
            count:  this.maxCount,
            offset: this.history.length,
            filter: this.historyView.getFilter()
        };
        if (this.client.opts.apiEnable) {
            this.client.get('history', rq, function(data){
                this.onHistoryLoad(data['mode'], data['history'], data['penalties'], data.userId);
            }.bind(this))
        } else {
            this.client.send('history_manager', 'history', 'server', rq);
        }
    };


    HistoryManager.prototype.getGame = function (id, userId, mode) {
        if (this.client.gameManager.inGame()){
            return;
        }
        if (this.client.gameManager.currentRoom){
            this.client.gameManager.leaveGame();
        }
        userId = userId || this.userId || this.client.getPlayer().userId;
        mode = mode || this.currentMode || this.client.currentMode;
        this.isCancel = false;
        if (this.client.opts.apiEnable) {
            this.client.get('history', { mode: mode, gameId: id, userId: userId }, function(data){
                this.onGameLoad(data.mode, data.game);
            }.bind(this))
        } else {
            this.client.send('history_manager', 'game', 'server', { mode: mode, id: id, userId: userId });
        }
        this.startTime = Date.now();
    };


    HistoryManager.prototype.close = function(){
      if (this.historyView){
          this.historyView.close();
      }
    };

    function formatDate(time) {
        var months = locale.months;
        var date = new Date(time);
        var day = date.getDate();
        var month = months[date.getMonth()];
        var year = date.getFullYear();
        if (day < 10) day = '0' + day;
        return day + " " + month + " "  + year;
    }

    function formatTime(time) {
        var date =  new Date(time);
        var h = date.getHours();
        var m = date.getMinutes();
        if (h < 10) h = '0' + h;
        if (m < 10) m = '0' + m;
        return  h + ':' + m;
    }

   return HistoryManager;
});

define('text!tpls/v6-ratingMain.ejs',[],function () { return '<div id="v6-rating" class="v6-block-border">\r\n    <img class="closeIcon" src="<%= close %>" title="<%= locale.close %>">\r\n    <div>\r\n        <!-- rating filter panel -->\r\n        <div class="filterPanel">\r\n            <div style="margin-left: 8px;">\r\n\r\n            </div>\r\n        </div>\r\n        <div class="loading"><img src="<%= spin %>"></div>\r\n        <!-- rating table -->\r\n        <table class="ratingTable" cellspacing="0">\r\n            <thead>\r\n                <tr class="headTitles">\r\n\r\n                </tr>\r\n                <tr class="headIcons">\r\n\r\n                </tr>\r\n            </thead>\r\n            <tbody class="ratingTBody">\r\n\r\n            </tbody>\r\n        </table>\r\n\r\n        <!-- div show more -->\r\n        <div class="chat-button chat-post" id="ratingShowMore">\r\n            <span><%= locale.showMore %></span>\r\n        </div>\r\n\r\n        <!-- div bottom buttons -->\r\n        <div class="footButtons">\r\n            <div style="float:left"><span class="activeLink" id="jumpTop">[<%= locale.jumpTop%>]</span></div>\r\n            <div style="float:right"><span class="activeLink" id="closeRatingBtn">[<%= locale.close %>]</span> </div>\r\n        </div>\r\n    </div>\r\n</div>';});


define('text!tpls/v6-ratingTD.ejs',[],function () { return '<td data-idcol="<%= id %>" class="rating<%= id %>"><div><%= value %><sup class="greenSup"><%= sup %></sup></div></td>';});


define('text!tpls/v6-ratingTH.ejs',[],function () { return '<th data-idcol="<%= id %>" class="ratingTH<%= id %>" title="<%= title %>"><%= value %></th>';});


define('text!tpls/v6-ratingTR.ejs',[],function () { return '<tr class="<%= trclass %>" data-userId="<%= userId %>" data-userName="<%= userName %>"><%= value %></tr>';});


define('text!tpls/v6-ratingSearch.ejs',[],function () { return '<div style="padding-bottom:2px; position: relative;">\r\n    <div style="float:left;margin-top:4px;"><%= locale.search %>:</div>\r\n    <input type="text" placeholder="<%= locale.placeholder %>" id="ratingAutoComplete" value="">\r\n    <div class="delete" style="background-image: url(<%= imgDel %>)"></div>\r\n</div>';});


define('text!tpls/v6-ratingPhoto.ejs',[],function () { return '<div style="float:right;margin-top:2px;">\r\n    <a href="<%= photo %>" rel="lightbox" data-lightbox="<%= photo %>"><img src="i/camera.png"></a>\r\n</div>';});


define('text!tpls/v6-ratingUser.ejs',[],function () { return '<span class="userName" data-userid="<%= userId %>"><%= userName %></span>';});

define('views/rating',['underscore', 'backbone', 'text!tpls/v6-ratingMain.ejs', 'text!tpls/v6-ratingTD.ejs', 'text!tpls/v6-ratingTH.ejs',
        'text!tpls/v6-ratingTR.ejs', 'text!tpls/v6-ratingTab.ejs', 'text!tpls/v6-ratingSearch.ejs',
        'text!tpls/v6-ratingPhoto.ejs', 'text!tpls/v6-ratingUser.ejs'],
    function(_, Backbone, tplMain, tplTD, tplTH, tplTR, tplTab, tplSearch, tplPhoto, tplUser) {
        

        var RatingView = Backbone.View.extend({
            tagName: 'div',
            id: 'v6Rating',
            tplMain: _.template(tplMain),
            tplTD: _.template(tplTD),
            tplTH: _.template(tplTH),
            tplTR: _.template(tplTR),
            tplTab: _.template(tplTab),
            tplSearch: _.template(tplSearch),
            tplUser: _.template(tplUser),
            tplPhoto: _.template(tplPhoto),
            events: {
                'click .closeIcon': 'close',
                'click #closeRatingBtn': 'close',
                'click .headTitles th': 'thClicked',
                'click .headIcons th': 'thClicked',
                'click .filterPanel span': 'tabClicked',
                'click .ratingTable .userName': 'userClicked',
                'click #ratingShowMore': 'showMore',
                'keyup #ratingAutoComplete': 'filterChanged',
                'click .delete': 'clearFilter',
                'click #jumpTop': 'scrollTop'
            },

            thClicked: function(e){
                var id = $(e.currentTarget).attr('data-idcol');
                for (var i = 0; i < this.columns.length; i++){
                    if (this.columns[i].id == id && this.columns[i].canOrder){
                        this.setColumnOrder(id);
                        console.log('log; rating col clicked',this.columns[i]);
                        this.getRatings();
                        break;
                    }
                }
            },

            tabClicked: function (e){
                var id = $(e.currentTarget).attr('data-idtab');
                for (var i = 0; i < this.subTabs.length; i++){
                    if (this.subTabs[i].id == id){
                        this.setActiveSubTab(id);
                        this.getRatings();
                        return;
                    }
                }
            },

            userClicked: function (e){
                var userId = $(e.currentTarget).attr('data-userid');
                var userName = $(e.currentTarget).html();
                this.manager.client.onShowProfile(userId, userName);
            },

            showMore: function() {
                this.getRatings(true);
            },

            filterChanged: function(e) {
                if (e.type === 'keyup')
                    if (e.keyCode == 13 || e.target.value.length == 0) {
                        this.getRatings();
                    }
            },

            clearFilter: function() {
                this.$filter.val('');
                this.getRatings();
            },

            getRatings: function(showmore) {
                this.manager.getRatings(this.currentSubTab.id, this.currentCollumn.id,
                    this.currentCollumn.order < 0? 'desc':'asc', this.$filter.val(), !!showmore);
            },

            scrollTop: function(){
                $('html,body').animate({
                    scrollTop: this.$el.offset().top
                }, 300);
            },

            initialize: function(_conf, _manager) {
                this.conf = _conf;
                this.manager = _manager;
                this.locale = _manager.client.locale.rating;
                this.tabs = _conf.tabs;
                this.subTabs = _conf.subTabs;
                this.columns = _conf.columns;
                this.$el.html(this.tplMain({
                    close:this.conf.images.close, spin: this.conf.images.spin, locale: this.locale
                }));

                this.$tabs = $(this.$el.find('.filterPanel').children()[0]);
                this.$titles = this.$el.find('.headTitles');
                this.$icons = this.$el.find('.headIcons');
                this.$head = this.$icons.parent();
                this.$tbody = $(this.$el.find('.ratingTable tbody')[0]);
                this.$showMore = $(this.$el.find('#ratingShowMore'));


                this.NOVICE = '<span style="color: #C42E21 !important;">' + this.locale['novice'] + '</span>';
                this.IMG_BOTH = '<img src="' + _conf.images.sortBoth + '">';
                this.IMG_ASC= '<img src="' + _conf.images.sortAsc + '">';
                this.IMG_DESC = '<img src="' + _conf.images.sortDesc + '">';
                this.ACTIVE_TAB = 'activeLink';
                this.UNACTIVE_TAB = 'unactiveLink';
                this.SORT = 'sorted';
                this.YOU = this.locale['you'] + ':';
                this.HEAD_USER_CLASS = 'headUser';
                this.ACTIVE_CLASS = 'active';
                this.ONLINE_CLASS = 'online';
                this.USER_CLASS = 'user';

                this.renderTabs();
                this.renderHead();
                this.isClosed = false;
            },

            close: function () {
                this.$el.hide();
                this.isClosed = true;
            },

            renderTabs: function() {
                for (var i in this.tabs){
                    this.$tabs.append(this.tplTab(this.tabs[i]));
                    this.setActiveTab(this.tabs[0].id);
                }
                if (this.subTabs.length > 1) {
                    this.$tabs.append('<br>');
                    for (var i in this.subTabs){
                        this.$tabs.append(this.tplTab(this.subTabs[i]));
                        this.setActiveSubTab(this.subTabs[0].id);
                    }
                }
            },

            renderHead:function() {
                var col, th;
                for (var i in this.columns) {
                    col = this.columns[i];
                    if (col.canOrder) {
                        if (col.id == 'ratingElo') col.order = 1;
                        else col.order = 0;
                    }
                    th = {
                        id: col.id,
                        title: col.topTitle||'',
                        value: col.title
                    };
                    this.$titles.append(this.tplTH(th));
                    th.value = col.canOrder?this.IMG_BOTH:'';
                    if (col.id == 'rank') th.value= "";
                    if (col.id == 'userName') {
                        th.value = this.tplSearch({
                            imgDel: this.conf.images.del, locale: this.locale
                        });
                    }
                    this.$icons.append(this.tplTH(th));
                }
                this.setColumnOrder('ratingElo');
                this.$filter = $(this.$el.find('#ratingAutoComplete'));
            },

            renderRatings: function (ratings) {
                var row;
                if (ratings.infoUser) {
                    row = ratings.infoUser;
                    this.$head.append(this.tplTR({
                        trclass: this.HEAD_USER_CLASS,
                        userId: row.userId,
                        userName: row.userName,
                        value: this.renderRow(row, true)
                    }));
                }
                if (!ratings.allUsers) return;
                for (var i = 0; i < ratings.allUsers.length; i++) {
                    row = ratings.allUsers[i];
                    var trclass = '';
                    if (row.user) trclass += this.USER_CLASS + ' ';
                    if (row.active) trclass += this.ACTIVE_CLASS;
                    else if (row.online) trclass += this.ONLINE_CLASS;
                    this.$tbody.append(this.tplTR({
                        trclass: trclass,
                        userId: row.userId,
                        userName: row.userName,
                        value: this.renderRow(row)
                    }));
                }
            },

            renderRow: function(row, isUser){
                var columns = ""; var col;
                for (var i = 0; i < this.columns.length; i++){
                    if (row[this.columns[i].source] == null) row[this.columns[i].source] = this.columns[i].undef;
                    col = {
                        id: this.columns[i].id,
                        value: row[this.columns[i].source],
                        sup: ''
                    };
                    if (typeof this.columns[i].func == "function"){
                        col.value = this.columns[i].func(col.value);
                    }
                    if (col.id == 'userName') col.value = this.tplUser({
                        userName: row.userName,
                        userId: row.userId
                    });
                    if (isUser){ // Render user rating row (infoUser)
                        if (col.id == 'rank') col.value = this.YOU;
                        if (col.id == 'userName') col.value += ' ('+(row.rank>0 ? row.rank : '-' ) + this.locale['place'] + ')';
                    }
                    if (col.id == 'userName' && row.photo) col.value += this.tplPhoto(row.photo); //TODO: photo, photo link
                    columns += this.tplTD(col);
                }
                return columns;
            },

            setActiveTab: function(id){
                for (var i = 0; i < this.tabs.length; i++){
                    this.tabs[i].active = false;
                    if (this.tabs[i].id != id)
                        this.$tabs.find('span[data-idtab="'+this.tabs[i].id+'"]').removeClass(this.ACTIVE_TAB).addClass(this.UNACTIVE_TAB);
                    else {
                        this.$tabs.find('span[data-idtab="'+this.tabs[i].id+'"]').removeClass(this.UNACTIVE_TAB).addClass(this.ACTIVE_TAB);
                        this.currentTab = this.tabs[i];
                    }
                }
            },

            setActiveSubTab: function(id){
                for (var i = 0; i < this.subTabs.length; i++){
                    this.subTabs[i].active = false;
                    if (this.subTabs[i].id != id)
                        this.$tabs.find('span[data-idtab="'+this.subTabs[i].id+'"]').removeClass(this.ACTIVE_TAB).addClass(this.UNACTIVE_TAB);
                    else {
                        this.$tabs.find('span[data-idtab="'+this.subTabs[i].id+'"]').removeClass(this.UNACTIVE_TAB).addClass(this.ACTIVE_TAB);
                        this.currentSubTab = this.subTabs[i];
                    }
                }
            },

            setColumnOrder: function (id, order){
                for (var i = 2; i < this.columns.length; i++){
                    if (this.columns[i].id != id) {
                        this.columns[i].order = 0;
                        this.$titles.find('th[data-idcol="'+this.columns[i].id+'"]').removeClass(this.SORT);
                        this.$icons.find('th[data-idcol="'+this.columns[i].id+'"]').removeClass(this.SORT).html(this.columns[i].canOrder?this.IMG_BOTH:'');
                    } else {
                        this.currentCollumn = this.columns[i];
                        if (!order) {
                            if (this.columns[i].order < 1) this.columns[i].order = 1;
                            else this.columns[i].order = -1;
                        } else {
                            this.columns[i].order = order == 'desc' ? -1 : 1;
                        }

                        this.$titles.find('th[data-idcol="' + this.columns[i].id + '"]').addClass(this.SORT);
                        this.$icons.find('th[data-idcol="' + this.columns[i].id + '"]').addClass(this.SORT).html(this.columns[i].order>0?this.IMG_ASC:this.IMG_DESC);
                    }
                }
            },

            render: function(ratings, mode, column, order, append, showMore) {
                this.$el.show();
                this.setColumnOrder(column, order);

                if (this.$filter.val() && this.$filter.val().length > 0) this.$filter.parent().find('.delete').show();
                else this.$filter.parent().find('.delete').hide();

                if (!showMore) this.$showMore.hide(); else this.$showMore.show();
                if (mode) this.setActiveSubTab(mode);
                if (!ratings) {
                    this.isClosed = false;
                    this.$el.find('.loading').show();
                }
                else {
                    this.$el.find('.loading').hide();
                    this.$head.find('.'+this.HEAD_USER_CLASS).remove();
                    if (!append) this.$tbody.children().remove();
                    console.log('render ratings', ratings);
                    this.renderRatings(ratings);
                }

                if (this.manager.client.isAdmin && !this.$tabs.find('.adminLink').length){
                    var $span = $('<span>').html('<a href="/admin">Админка</a>')
                        .addClass('adminLink').appendTo(this.$tabs);
                }

                return this;
            }


        });
        return RatingView;
    });
define('modules/rating_manager',['EE', 'translit', 'views/rating'], function(EE, translit, RatingView) {
    

    var locale;
    var RatingManager = function (client) {
        this.client = client;
        locale = client.locale['rating'];
        this.conf = {
            tabs:[
                {id: 'all_players', title: locale.tabs['allPlayers']}
            ],
            subTabs:[
            ],
            columns:[
                {  id:'rank',           source:'rank',        title: locale.columns.rank,       canOrder:false },
                {  id:'userName',       source:'userName',    title: locale.columns.userName,   canOrder:false },
                {  id:'ratingElo',      source:'ratingElo',   title: locale.columns.ratingElo,  canOrder:true },
                {  id:'win',            source:'win',         title: locale.columns.win,        canOrder:true },
                {  id:'lose',           source:'lose',        title: locale.columns.lose,       canOrder:false },
                {  id:'dateCreate',     source:'dateCreate',  title: locale.columns.dateCreate, canOrder:true }
            ]
        };

        if (client.isAdmin) this.conf.columns.push({  id:'timeLastGame',     source:'timeLastGame',  title: locale.columns.dateLastGame, canOrder:true });

        if (typeof client.opts.initRating == "function") this.conf =  client.opts.initRating(this.conf, this.client);
        this.conf.images = client.opts.images;

        this.$container = (client.opts.blocks.ratingId?$('#'+client.opts.blocks.ratingId):$('body'));
        this.maxCount = 500;
        this.count = 0;

        client.on('disconnected', function () {})
    };

    RatingManager.prototype = new EE();


    RatingManager.prototype.init = function(conf){
        this.conf.subTabs = [];
        for (var i = 0 ; i < this.client.modes.length; i++)
            this.conf.subTabs.push({id:this.client.modes[i], title:this.client.getModeAlias(this.client.modes[i])});
        if (this.ratingView && this.ratingView.$el){
            this.ratingView.$el.remove();
            this.ratingView.remove();
        }
        this.ratingView = new RatingView(this.conf, this);
    };


    RatingManager.prototype.onMessage = function (message) {
        var data = message.data, i;
        console.log('rating_manager;', 'message', message);
        switch (message.type) {
            case 'ratings': this.onRatingsLoad(data.mode, data.ratings, data.column, data.order); break;
        }
    };


    RatingManager.prototype.onRatingsLoad = function (mode, ratings, column, order){
        var rank = false;
        if (this.ratingView.isClosed) return;
        if (ratings.infoUser) {
            ratings.infoUser = this.formatRatingsRow(mode, ratings.infoUser, ratings.infoUser[mode].rank);
        }
        for (var i = 0; i < ratings.allUsers.length; i++) {
            if (!this.filter && column == 'ratingElo' && order == 'desc') {
                rank = i + 1 + this.count;
            } else {
                if (this.client.opts.loadRanksInRating){
                    rank =  ratings.allUsers[i][mode]['rank'] || false;
                }
            }
            ratings.allUsers[i] = this.formatRatingsRow(mode, ratings.allUsers[i], rank);
        }

        this.$container.append(this.ratingView.render(ratings, mode, column, order, this.count != 0, ratings.allUsers.length == this.maxCount).$el);
        this.count += ratings.allUsers.length;
    };


    RatingManager.prototype.formatRatingsRow = function(mode, info, rank){
        var row = {
            userId: info.userId,
            userName: info.userName,
            photo: undefined
        };
        if (this.client.lang != 'ru'){
            row.userName = translit(row.userName);
        }
        for (var i in info[mode]){
            row[i] = info[mode][i];
        }
        if (rank !== false) row.rank = rank; // set rank on order
        else row.rank = '';
        if (this.client.getPlayer() && info.userId == this.client.getPlayer().userId) row.user = true;
        if (this.client.userList.getUser(info.userId)) {
            row.online = true;
            if (this.client.userList.getUser(info.userId).isActive) row.active = true;

        }
        row.percent = (row.games>0?Math.floor(row.win/row.games*100):0);
        if (Date.now() - info.dateCreate < 86400000)
            row.dateCreate = this.ratingView.NOVICE;
        else
            row.dateCreate = formatDate(info.dateCreate);
        row.timeLastGame = formatDate(row.timeLastGame);
        return row;
    };


    RatingManager.prototype.getRatings = function(mode, column, order, filter, showMore){
        if (!this.client.isLogin) return;
        if (!showMore) this.count = 0;
        this.$container.append(this.ratingView.render(false).$el);
        this.filter = filter;
        var rq = {
            mode: mode||this.client.currentMode,
            column: column,
            order: order,
            filter: filter,
            count: this.maxCount,
            offset: this.count
        };
        if (this.client.opts.apiEnable){
            this.client.get('ratings', rq, function(data){
                data['ratings']['infoUser'] = this.client.getPlayer();
                this.onRatingsLoad(data.mode, data.ratings, data.column, data.order == 1 ? 'asc' : 'desc');
            }.bind(this))
        } else{
            this.client.send('rating_manager', 'ratings', 'server', rq);
        }
        this.client.viewsManager.showPanel(this.ratingView.$el);
    };

    RatingManager.prototype.close = function(){
        if (this.ratingView){
            this.ratingView.close();
        }
    };

    function formatDate(time) {
        var date = new Date(time);
        var day = date.getDate();
        var month = date.getMonth() + 1;
        var year = ("" + date.getFullYear()).substr(2, 2);
        return ext(day, 2, "0") + "." + ext(month, 2, "0") + "."  + year;
        function ext(str, len, char) {
            //char = typeof (char) == "undefined" ? "&nbsp;" : char;
            str = "" + str;
            while (str.length < len) {
                str = char + str;
            }
            return str;
        }
    }

    RatingManager.prototype.testRatings = {"allUsers":[{"userId":"95514","userName":"us_95514","dateCreate":1423486149906,"mode1":{"win":2,"lose":0,"draw":0,"games":2,"rank":1,"ratingElo":1627},"mode2":{"win":1,"lose":0,"draw":0,"games":1,"rank":1,"ratingElo":1615}},{"userId":"93361","userName":"us_93361","dateCreate":1423486098554,"mode1":{"win":1,"lose":0,"draw":0,"games":1,"rank":2,"ratingElo":1615},"mode2":{"win":0,"lose":0,"draw":0,"games":0,"rank":0,"ratingElo":1600}},{"userId":"99937","userName":"us_99937","dateCreate":1423486099570,"mode1":{"win":0,"lose":3,"draw":0,"games":3,"rank":3,"ratingElo":1561},"mode2":{"win":0,"lose":1,"draw":0,"games":1,"rank":2,"ratingElo":1586}}],"infoUser":{"userId":"99937","userName":"us_99937","dateCreate":1423486099570,"mode1":{"win":0,"lose":3,"draw":0,"games":3,"rank":3,"ratingElo":1561},"mode2":{"win":0,"lose":1,"draw":0,"games":1,"rank":2,"ratingElo":1586}}};
    return RatingManager;
});
define('modules/sound_manager',['EE', 'underscore'], function(EE, _) {
    

    var SoundManager = function (client) {
        this.client = client;
        this.soundsList = client.opts.sounds || {};
        this.sounds = {};
        this.initSounds();
        this.volume = 1;
        this.sound = null;
        this.msAlerTimeBound = 16000;
        this.timePlayTimeout = null;

        this.client.gameManager.on('game_start', function(room){
            if (room.isPlayer) this._playSound('start');
        }.bind(this));

        this.client.gameManager.on('turn', function(){
            this._playSound('turn');
        }.bind(this));

        this.client.inviteManager.on('new_invite', function(data){
            this._playSound('invite');
        }.bind(this));

        this.client.gameManager.on('time', function (data) {
            var interval = 1000;
            if (data.user == this.client.getPlayer() && data.userTimeMS < this.msAlerTimeBound && data.userTimeMS > 1000 && data.turnTime > 20000) {
                if (Date.now() - this.timePlayTimeout >= interval){
                    this._playSound('timeout', 0.3 + (this.msAlerTimeBound - data.userTimeMS) / this.msAlerTimeBound / 4);
                    this.timePlayTimeout = Date.now();
                }
            }
        }.bind(this))
    };

    SoundManager.prototype = new EE();


    SoundManager.prototype.initSounds = function(){
        for (var id in this.soundsList) {
            if (this.soundsList.hasOwnProperty(id))
                this.sounds[id] = new Sound(this.soundsList[id], id);
        }
    };


    SoundManager.prototype._playSound = function(id, volume){
        // check auto play sound enable
        if (this.sounds[id] && this.sounds[id].enable)
            this.playSound(id, volume);
    };


    SoundManager.prototype.playSound = function(id, volume){
        if (!this.client.settings.sounds) return;
        volume = volume || this.volume;
        if (!this.sounds[id]){
            console.error('sound_manager;', 'wrong sound id', id);
            return;
        }
        if (this.sound)
            this.sound.stop();
        this.sound = this.sounds[id].play(volume);
        this.emit('play', id);
    };


    var Sound = function (data, id){
        this.volume = data.volume || 1;
        this.sound = document.createElement('audio');
        this.sound.id = 'sound-'+id;
        this.sound.src = data.src;
        this.enable = data.enable !== false;
        document.body.appendChild(this.sound);
    };

    Sound.prototype.play = function(volume) {
        volume *= this.volume;
        if (volume < 0 || volume > 1) volume = 1;
        try {
            this.sound.currentTime = 0;
            this.sound.volume = volume;
            this.sound.play();
            return this;
        } catch (e) {
            console.error('sound;', 'sound play error', e);
            return null;
        }
    };

    Sound.prototype.stop = function() {
        try {
            this.sound.pause()
        } catch (e) {
            console.error('sound;', 'sound stop error', e);
        }
    };

    return SoundManager;
});
define('modules/admin_manager',['EE'], function(EE) {
    var AdminManager = function(client){
        this.client = client;

    };

    AdminManager.prototype  = new EE();

    AdminManager.prototype.onMessage = function(message) {
        var data = message.data;
        console.log('admin_manager;', 'message', message);
        switch (message.type) {
            case 'message':
                this.client.viewsManager.dialogsView.showDialog(data,{}, true, false, false);
                break;
            case 'enable_games':
                this.client.gameManager.enableGames = data['flag'];
                break;
            case 'reload':
                this.client.forceReload = true;
                location.reload();
                break;
            case 'get_config':
                console.log('admin;', 'config', data);
        }
    };


    AdminManager.prototype.send = function(type, data, pass){
        this.client.send('admin', type, 'server', {pass: pass, data:data})
    };


    return AdminManager;
});


define('text!localization/ru.JSON',[],function () { return '{\r\n  "name": "ru",\r\n  "userList":{\r\n    "tabs":{\r\n      "free":"Свободны",\r\n      "inGame":"Играют",\r\n      "spectators": "Смотрят"\r\n    },\r\n    "disconnected": {\r\n      "text": "Соединение с сервером отсутствует",\r\n      "button": "Переподключиться",\r\n      "status": "Загрузка.."\r\n    },\r\n    "search": "Имя игрока",\r\n    "disableInvite": "Вы запретили приглашать себя в игру",\r\n    "playerDisableInvite": "Игрок запретил приглашать себя в игру",\r\n    "buttons":{\r\n      "playRandom": "Играть с любым",\r\n      "cancelPlayRandom": "Идет подбор игрока...",\r\n      "invite": "Пригласить",\r\n      "cancel": "Отмена"\r\n    },\r\n    "rankPlace": "Место в рейтинге",\r\n    "rankPlaceShort": "Место",\r\n    "ratingShort": "Рейтинг"\r\n  },\r\n  "chat":{\r\n    "tabs":{\r\n      "main": "Общий",\r\n      "room": "Стол"\r\n    },\r\n    "inputPlaceholder": "Введите ваше сообщение",\r\n    "templateMessages": {\r\n      "header": "Готовые сообщения"\r\n    },\r\n    "buttons":{\r\n      "removeMessage": "Удалить сообщение",\r\n      "send": "Отправить",\r\n      "chatRules": "Правила чата",\r\n      "hideChat": "Скрыть чат",\r\n      "showChat": "Показать чат"\r\n    },\r\n    "menu":{\r\n      "answer": "Ответить",\r\n      "showProfile": "Показать профиль",\r\n      "invite": "Пригласить в игру",\r\n      "blackList": "В черный список",\r\n      "ban": "Забанить в чате"\r\n    },\r\n    "rankPlace": "место в рейтинге",\r\n    "months": ["Января", "Февраля", "Марта", "Апреля", "Мая", "Июня", "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря"]\r\n  },\r\n  "settings":{\r\n    "title": "Настройки",\r\n    "titleBlackList": "Черный список",\r\n    "emptyBL": "Черный список пуст (чтобы добавить игрока в черный список кликнете по нему и выберите пункт в меню \'В черный список\')",\r\n    "buttons":{\r\n      "confirm": "OK",\r\n      "showBL": "Показать черный список",\r\n      "hideBL": "Скрыть черный список",\r\n      "remove": "Удалить"\r\n    }\r\n  },\r\n  "dialogs":{\r\n    "invite": " предлагает сыграть партию ",\r\n    "placeRating": " место в рейтинге",\r\n    "ratingElo": "с рейтингом ",\r\n    "inviteTime": "Осталось: ",\r\n    "user": "Пользователь",\r\n    "player": "Игрок",\r\n    "rejectInvite": " отклонил ваше приглашение",\r\n    "timeoutInvite": " превысил лимит ожидания в ",\r\n    "seconds": " секунд",\r\n    "askDraw": " предлагает ничью",\r\n    "cancelDraw": "отклонил ваше предложение о ничье",\r\n    "askTakeBack": "просит отменить ход. Разрешить ему?",\r\n    "cancelTakeBack": " отклонил ваше просьбу отменить ход",\r\n    "accept": "Принять",\r\n    "decline": "Отклонить",\r\n    "yes": "Да",\r\n    "no": "Нет",\r\n    "win": "Победа.",\r\n    "lose": "Поражение.",\r\n    "draw": "Ничья.",\r\n    "gameOver": "Игра окончена.",\r\n    "scores": "очков",\r\n    "opponentTimeout": "У соперника закончилось время",\r\n    "playerTimeout": "У Вас закончилось время",\r\n    "opponentThrow": "Соперник сдался",\r\n    "playerThrow": "Вы сдались",\r\n    "ratingUp": "Вы поднялись с ",\r\n    "ratingPlace": "Вы занимаете ",\r\n    "on": " на ",\r\n    "of": " в ",\r\n    "place": " место в общем рейтинге",\r\n    "dialogPlayAgain": "Сыграть с соперником еще раз?",\r\n    "playAgain": "Да, начать новую игру",\r\n    "leave": "Нет, выйти",\r\n    "waitingOpponent": "Ожидание соперника..",\r\n    "waitingTimeout": "Время ожидания истекло",\r\n    "opponentLeave": "покинул игру",\r\n    "banMessage": "Вы не можете писать сообщения в чате, т.к. добавлены в черный список ",\r\n    "banReason": "за употребление нецензурных выражений и/или спам  ",\r\n    "loginError": "Ошибка авторизации. Обновите страницу",\r\n    "loseOnLeave": "Вам будет засчитано поражение"\r\n  },\r\n  "history": {\r\n    "columns": {\r\n      "date": "Дата",\r\n      "opponent": "Противник",\r\n      "time": "Время",\r\n      "number": "№",\r\n      "elo": "Рейтинг"\r\n    },\r\n    "close": "Закрыть окно истории",\r\n    "showMore": "Показать еще",\r\n    "noHistory": "Сохранения отсутствуют",\r\n    "placeholder": "Поиск по имени",\r\n    "months": ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]\r\n  },\r\n  "rating": {\r\n    "tabs": {\r\n      "allPlayers": "все игроки"\r\n    },\r\n    "columns": {\r\n      "rank": "Место",\r\n      "userName": "Имя",\r\n      "ratingElo": "Рейтинг <br> Эло",\r\n      "win": "Выиграл",\r\n      "lose": "Проиграл",\r\n      "dateCreate": "Дата <br> регистрации",\r\n      "dateLastGame": "Дата <br> последней игры"\r\n    },\r\n    "close": "Закрыть окно рейтинга",\r\n    "placeholder": "Поиск по имени",\r\n    "showMore": "Ещё 500 игроков",\r\n    "jumpTop": "в начало рейтинга",\r\n    "place": " место",\r\n    "you": "Вы",\r\n    "search": "Поиск",\r\n    "novice": "новичок"\r\n  },\r\n  "game": {\r\n    "resultMessages":{\r\n      "win": "Победа",\r\n      "wins": "Победил ",\r\n      "lose": "Поражение",\r\n      "draw": "Ничья",\r\n      "opponent": "Соперник",\r\n      "player": "Игрок",\r\n      "opponentThrow": " сдался",\r\n      "playerThrow": "Вы сдались",\r\n      "opponentTimeoutPre": "У соперника",\r\n      "timeoutPre": "У ",\r\n      "opponentTimeout": " закончилось время",\r\n      "playerTimeout": "У Вас закончилось время",\r\n      "opponentLeave": " покинул игру",\r\n      "playerLeave": "Вы покинули игру"\r\n    }\r\n  }\r\n}';});


define('text!localization/en.JSON',[],function () { return '{\r\n  "name": "en",\r\n  "userList":{\r\n    "tabs":{\r\n      "free":"Free",\r\n      "inGame":"In Game",\r\n      "spectators": "Spectators"\r\n    },\r\n    "disconnected": {\r\n      "text": "No connection",\r\n      "button": "Reconnect",\r\n      "status": "Loading.."\r\n    },\r\n    "search": "Search",\r\n    "disableInvite": "Invites disable",\r\n    "playerDisableInvite": "Invites disable",\r\n    "buttons":{\r\n      "playRandom": "Play with a anyone",\r\n      "cancelPlayRandom": "Waiting a opponent...",\r\n      "invite": "Invite",\r\n      "cancel": "Cancel"\r\n    },\r\n    "rankPlace": "place in ranking",\r\n    "rankPlaceShort": "Place",\r\n    "ratingShort": "Rating"\r\n  },\r\n  "chat":{\r\n    "tabs":{\r\n      "main": "Main",\r\n      "room": "Room"\r\n    },\r\n    "inputPlaceholder": "Type your message",\r\n    "templateMessages": {\r\n      "header": "Template messages"\r\n    },\r\n    "buttons":{\r\n      "removeMessage": "Remove message",\r\n      "send": "Send",\r\n      "chatRules": "Chat rules",\r\n      "hideChat": "Hide Chat",\r\n      "showChat": "Show Chat"\r\n    },\r\n    "menu":{\r\n      "answer": "Answer",\r\n      "showProfile": "Show profile",\r\n      "invite": "Send invite",\r\n      "blackList": "To black list",\r\n      "ban": "ban"\r\n    },\r\n    "rankPlace": "place in ranking",\r\n    "months": ["Января", "Февраля", "Марта", "Апреля", "Мая", "Июня", "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря"]\r\n  },\r\n  "settings":{\r\n    "title": "Settings",\r\n    "titleBlackList": "Black list",\r\n    "emptyBL": "Black list is empty",\r\n    "buttons":{\r\n      "confirm": "OK",\r\n      "showBL": "Show black list",\r\n      "hideBL": "Hide black list"\r\n    }\r\n  },\r\n  "dialogs":{\r\n    "invite": "You are invited to play by ",\r\n    "placeRating": " place in the rating",\r\n    "ratingElo": "with the rating ",\r\n    "inviteTime": "Remaining: ",\r\n    "user": "User",\r\n    "player": "The player",\r\n    "rejectInvite": " has declined your invitation",\r\n    "timeoutInvite": " limit exceeded expectations ",\r\n    "seconds": " seconds",\r\n    "askDraw": " offers a draw",\r\n    "cancelDraw": "declined your proposal for a draw",\r\n    "askTakeBack": "asks to cancel turn. Allow him?",\r\n    "cancelTakeBack": " declined your request to cancel turn",\r\n    "accept": "Accept",\r\n    "decline": "Decline",\r\n    "yes": "Yes",\r\n    "no": "No",\r\n    "win": "Win.",\r\n    "lose": "Lose.",\r\n    "draw": "Draw.",\r\n    "gameOver": "Game over.",\r\n    "scores": "scores",\r\n    "opponentTimeout": "Opponent time is over",\r\n    "playerTimeout": "Your time is over",\r\n    "opponentThrow": "Opponent surrendered",\r\n    "playerThrow": "You surrendered",\r\n    "ratingUp": "You have risen in the overall ranking from ",\r\n    "ratingPlace": "You take ",\r\n    "on": " to ",\r\n    "of": " of ",\r\n    "place": " place in ranking",\r\n    "dialogPlayAgain": "Play with your opponent again?",\r\n    "playAgain": "Yes, play again",\r\n    "leave": "No, leave",\r\n    "waitingOpponent": "Waiting for opponent..",\r\n    "waitingTimeout": "Timeout",\r\n    "opponentLeave": "left the game",\r\n    "banMessage": "You can not write messages in chat since added to the black list ",\r\n    "banReason": "for the use of foul language and / or spam  ",\r\n    "loginError": "Authorisation Error. Refresh the page",\r\n    "loseOnLeave": "You will lose"\r\n  },\r\n  "history": {\r\n    "columns": {\r\n      "date": "Date",\r\n      "opponent": "Opponent",\r\n      "time": "Time",\r\n      "number": "#",\r\n      "elo": "Rating"\r\n    },\r\n    "close": "Close history window",\r\n    "showMore": "Show more",\r\n    "noHistory": "no history",\r\n    "placeholder": "Search by name",\r\n    "months": ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]\r\n  },\r\n  "rating": {\r\n    "tabs": {\r\n      "allPlayers": "All players"\r\n    },\r\n    "columns": {\r\n      "rank": "Place",\r\n      "userName": "Name",\r\n      "ratingElo": "Rating <br> Elo",\r\n      "win": "Win",\r\n      "lose": "Lose",\r\n      "dateCreate": "Registration <br> date",\r\n      "dateLastGame": "Last game"\r\n    },\r\n    "close": "Close rating window",\r\n    "placeholder": "Search by name",\r\n    "showMore": "More 500 players",\r\n    "jumpTop": "to rating top",\r\n    "place": " rank",\r\n    "you": "You",\r\n    "search": "Search",\r\n    "novice": "novice",\r\n    "months": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]\r\n  },\r\n  "game": {\r\n    "resultMessages":{\r\n      "win": "Win",\r\n      "wins": "Win ",\r\n      "lose": "Lose",\r\n      "draw": "Draw",\r\n      "opponent": "Opponent",\r\n      "player": "Player",\r\n      "opponentThrow": " surrendered",\r\n      "playerThrow": "You surrendered",\r\n      "opponentTimeoutPre": "Opponent",\r\n      "timeoutPre": "",\r\n      "opponentTimeout": " time is over",\r\n      "playerTimeout": "Your time is over",\r\n      "opponentLeave": " leave game",\r\n      "playerLeave": "You leave game"\r\n    }\r\n  }\r\n}';});

define('modules/localization_manager',['EE', 'text!localization/ru.JSON', 'text!localization/en.JSON'],
function(EE, RU, EN) {
    

    var LocalizationManager = function(client) {
        this.client = client;

        this.localization = localization;

        if (typeof this.client.lang != 'string') this.client.lang = false;

        this.client.lang = this.initLanguage();
        console.log('localization_manager;', 'lang', this.client.lang);
        this.client.locale = this.initLocalization();
        console.log('localization_manager;', 'locale', this.client.locale);
    };

    LocalizationManager.prototype.initLanguage = function(){
        // get client language or ru default
        var navigator = window.navigator,
            lang = this.client.lang || (navigator.languages ? navigator.languages[0] : (navigator.language || navigator.userLanguage)) || 'ru';
        try {
            lang = lang.substr(0,2).toLocaleLowerCase();
        } catch (e) {
            console.error('localization_manager;', 'initLanguage', e)
        }
        if (typeof lang != 'string' || lang.length != 2) lang = 'ru';
        return lang
    };

    LocalizationManager.prototype.initLocalization = function(){
        // init client lang locale or en default
        this.localization['ru'] = JSON.parse(RU);
        this.localization['en'] = JSON.parse(EN);
        this.localization = $.extend(true, this.localization, this.client.opts.localization);
        var locale = this.localization[this.client.lang] || this.localization['en'];
        locale = $.extend(true, {}, this.localization[this.localization.default], locale);
        locale.get = localization._get;
        return locale;
    };

    var localization = {
        "default": 'ru',
        "_get": function(desc) {
            var arr = desc.split("."),
                obj = this;
            while(arr.length && (obj = obj[arr.shift()]));
            return obj;
        }
    };

    return LocalizationManager;
});
/*! Idle Timer v1.0.1 2014-03-21 | https://github.com/thorst/jquery-idletimer | (c) 2014 Paul Irish | Licensed MIT */
!function(a){a.idleTimer=function(b,c){var d;"object"==typeof b?(d=b,b=null):"number"==typeof b&&(d={timeout:b},b=null),c=c||document,d=a.extend({idle:!1,timeout:3e4,events:"mousemove keydown wheel DOMMouseScroll mousewheel mousedown touchstart touchmove MSPointerDown MSPointerMove"},d);var e=a(c),f=e.data("idleTimerObj")||{},g=function(b){var d=a.data(c,"idleTimerObj")||{};d.idle=!d.idle,d.olddate=+new Date;var e=a.Event((d.idle?"idle":"active")+".idleTimer");a(c).trigger(e,[c,a.extend({},d),b])},h=function(b){var d=a.data(c,"idleTimerObj")||{};if(null==d.remaining){if("mousemove"===b.type){if(b.pageX===d.pageX&&b.pageY===d.pageY)return;if("undefined"==typeof b.pageX&&"undefined"==typeof b.pageY)return;var e=+new Date-d.olddate;if(200>e)return}clearTimeout(d.tId),d.idle&&g(b),d.lastActive=+new Date,d.pageX=b.pageX,d.pageY=b.pageY,d.tId=setTimeout(g,d.timeout)}},i=function(){var b=a.data(c,"idleTimerObj")||{};b.idle=b.idleBackup,b.olddate=+new Date,b.lastActive=b.olddate,b.remaining=null,clearTimeout(b.tId),b.idle||(b.tId=setTimeout(g,b.timeout))},j=function(){var b=a.data(c,"idleTimerObj")||{};null==b.remaining&&(b.remaining=b.timeout-(+new Date-b.olddate),clearTimeout(b.tId))},k=function(){var b=a.data(c,"idleTimerObj")||{};null!=b.remaining&&(b.idle||(b.tId=setTimeout(g,b.remaining)),b.remaining=null)},l=function(){var b=a.data(c,"idleTimerObj")||{};clearTimeout(b.tId),e.removeData("idleTimerObj"),e.off("._idleTimer")},m=function(){var b=a.data(c,"idleTimerObj")||{};if(b.idle)return 0;if(null!=b.remaining)return b.remaining;var d=b.timeout-(+new Date-b.lastActive);return 0>d&&(d=0),d};if(null===b&&"undefined"!=typeof f.idle)return i(),e;if(null===b);else{if(null!==b&&"undefined"==typeof f.idle)return!1;if("destroy"===b)return l(),e;if("pause"===b)return j(),e;if("resume"===b)return k(),e;if("reset"===b)return i(),e;if("getRemainingTime"===b)return m();if("getElapsedTime"===b)return+new Date-f.olddate;if("getLastActiveTime"===b)return f.lastActive;if("isIdle"===b)return f.idle}return e.on(a.trim((d.events+" ").split(" ").join("._idleTimer ")),function(a){h(a)}),f=a.extend({},{olddate:+new Date,lastActive:+new Date,idle:d.idle,idleBackup:d.idle,timeout:d.timeout,remaining:null,tId:null,pageX:null,pageY:null}),f.idle||(f.tId=setTimeout(g,f.timeout)),a.data(c,"idleTimerObj",f),e},a.fn.idleTimer=function(b){return this[0]?a.idleTimer(b,this[0]):this}}(jQuery);
define("idleTimer", function(){});

define('client',['modules/game_manager', 'modules/invite_manager', 'modules/user_list', 'modules/socket', 'modules/views_manager',
        'modules/chat_manager', 'modules/history_manager', 'modules/rating_manager', 'modules/sound_manager', 'modules/admin_manager',
        'modules/localization_manager', 'EE', 'idleTimer'],
function(GameManager, InviteManager, UserList, Socket, ViewsManager, ChatManager, HistoryManager, RatingManager,
         SoundManager, AdminManager, LocalizationManager, EE) {
    
    var Client = function(opts) {
        this.version = "0.9.59";
        opts.resultDialogDelay = opts.resultDialogDelay || 0;
        opts.modes = opts.modes || opts.gameModes || ['default'];
        opts.reload = false;
        opts.turnTime = opts.turnTime || 60;
        opts.blocks = opts.blocks || {};
        opts.images = defaultImages;
        opts.sounds = $.extend({}, defaultSounds, opts.sounds || {});
        opts.autoReconnect = opts.autoReconnect != false;
        opts.idleTimeout = 1000 * (opts.idleTimeout || 60);
        opts.loadRanksInRating = false;
        opts.autoShowProfile = !!opts.autoShowProfile || false;
        opts.shortGuestNames = !!opts.shortGuestNames || false;
        opts.newGameFormat = !!opts.newGameFormat || false;
        opts.vk = opts.vk || {};
        opts.showSpectators =  opts.showSpectators || false;
        opts.showButtonsPanel = opts.showButtonsPanel || false;
        opts.localization = opts.localization || {};
        opts.enableConsole = opts.enableConsole || false;
        opts.showHidden = false;
        opts.showCheaters = false;
        opts.apiEnable = !!opts.game && opts.apiEnable;
        opts.api = "//" + (opts.api ?  opts.api : document.domain + "/api/");
        opts.showRank = 'place';

        try{
            this.isAdmin = opts.isAdmin || window.LogicGame.isSuperUser();
            // disable console on production
            if (!opts.enableConsole && !this.isAdmin && window.location.hostname == "logic-games.spb.ru") {
                this.disableConsole();
            }
        }catch (e){
            this.isAdmin = false;
            console.error(e);
        }

        var self = this;

        this.opts = this.conf = opts;
        this.game = opts.game || 'test';
        this.defaultSettings = $.extend(true, {}, defaultSettings, opts.settings || {});
        this.settings = $.extend(true, {}, this.defaultSettings);
        this.lang = opts.lang || 'ru';
        this.locale = opts.localization;
        this.modesAlias = {};
        this.localizationManager = new LocalizationManager(this);
        this.gameManager = new GameManager(this);
        this.userList = new UserList(this);
        this.inviteManager = new InviteManager(this);
        this.chatManager = new ChatManager(this);
        this.viewsManager = new ViewsManager(this);
        this.historyManager = new HistoryManager(this);
        this.ratingManager = new RatingManager(this);
        this.soundManager = new SoundManager(this);
        this.adminManager = new AdminManager(this);

        this.vkWallPost = (opts.vk.url ? this.checkVKWallPostEnabled() : false);
        this.vkEnable =  (window.VK && window.VK.api && window._isVk);

        this.currentMode = null;
        this.reconnectTimeout = null;
        this.timeoutUserChanged = null;
        this.lastTimeUserChanged = 0;
        this.isFocused = true;

        this.TIME_BETWEEN_RECONNECTION = 2000;

        this.socket = new Socket(opts);
        this.socket.on("connection", function () {
            console.log('client;', 'socket connected');
            clearTimeout(self.reconnectTimeout);
            self.relogin = self.reconnection;
            self.isLogin = false;
            self.socket.send({
                module:'server',
                type:'login',
                target:'server',
                data: self.loginData
            });
            self.reconnection = false;
        });

        this.socket.on("disconnection", function() {
            console.log('client;', 'socket disconnected');
            self.reconnection = false;
            self.isLogin = false;
            self.emit('disconnected');
            if (!self.closedByServer && self.opts.autoReconnect){
                self.reconnectTimeout = setTimeout(self.reconnect.bind(self), self.socket.connectionCount  < 2 ? 100 : self.TIME_BETWEEN_RECONNECTION);
            }
        });

        this.socket.on("failed", function() {
            console.log('client;', 'socket connection failed');
            self.reconnection = false;
            self.emit('disconnected');
            if (!self.closedByServer && self.opts.autoReconnect){
                self.reconnectTimeout = setTimeout(self.reconnect.bind(self), self.TIME_BETWEEN_RECONNECTION * 5);
            }
        });

        this.socket.on("message", function(message) {
            console.log('client;', "socket message", message);
            self.onMessage(message);
        });

        this.getUser = this.userList.getUser.bind(this.userList);

        this.unload = false;
        this.confirmUnload = false;
        window.onbeforeunload = this.onBeforeUnload.bind(this);
        window.onunload = this.onUnload.bind(this);
        // idle timer // fire when user become idle or active
        if (opts.idleTimeout > 0)
            $( document ).idleTimer(opts.idleTimeout);
        $( document ).on( "idle.idleTimer", function(){
            self.isActive = false;
            self.sendChanged();
        });
        $( document ).on( "active.idleTimer", function(){
            self.isActive = true;
            self.sendChanged();
        });

        this.lastKey = this.lastKeyTime = null;
        $(document).on("keydown", function(e) {
            this.lastKey = e.which;
            this.lastKeyTime = Date.now();
        }.bind(this));
    };

    Client.prototype  = new EE();

    Client.prototype.init = function(user){
        user = user || {};
        var userId = (user.userId || window._userId).toString(),
            userName = (user.userName || window._username).toString(),
            sign = (user.sign || window._sign).toString(),
            game = this.game || '';
        if (typeof userName != "string" || typeof userId != "string" || typeof sign !="string" || typeof  game != "string"){
            throw new Error('Client init error, wrong user parameters'
                            + ' userId: ' + user.userId, ' userName: ' + user.userName + ' sign' + user.sign) ;
        }
        document.cookie = '_userId=' + user.userId + "; path=/;";
        this.loginData = {
            userId: userId, userName: userName, sign: sign, game: game
        };
        this.socket.init();
        this.viewsManager.init();
        console.log('client;', 'init version:', this.version);
        return this;
    };


    Client.prototype.reconnect = function(force){
        clearTimeout(this.reconnectTimeout);
        var deltaTime = Date.now() - this.socket.timeConnection;
        console.log('client;', 'reconnect, last was', deltaTime, 'ms ago');
        if (deltaTime < this.TIME_BETWEEN_RECONNECTION){
            this.reconnectTimeout = setTimeout(this.reconnect.bind(this), this.TIME_BETWEEN_RECONNECTION - deltaTime);
            return;
        }
        if (this.isLogin && !force){
            console.log('client;', 'connected!');
            return;
        }
        if (this.socket.connectionCount > 10 || this.opts.reload) {
            this.forceReload = true;
            location.reload();
            return;
        }
        this.reconnection = true;
        this.socket.init();
    };


    Client.prototype.onMessage = function(message){
        switch (message.module){
            case 'server': this.onServerMessage(message); break;
            case 'invite_manager': this.inviteManager.onMessage(message); break;
            case 'game_manager': this.gameManager.onMessage(message); break;
            case 'chat_manager': this.chatManager.onMessage(message); break;
            case 'history_manager': this.historyManager.onMessage(message); break;
            case 'rating_manager': this.ratingManager.onMessage(message); break;
            case 'admin': this.adminManager.onMessage(message); break;
        }
    };


    Client.prototype.onServerMessage = function(message){
        var data = message.data;
        switch (message.type){
            case 'login':
                this.onLogin(data);
                break;
            case 'user_relogin':
                var user = this.userList.getUser(data.userId);
                console.log('client;', 'user relogin', user);
                if (user) this.emit('user_relogin', user);
                break;
            case 'user_login':
                this.userList.onUserLogin(data);
                break;
            case 'user_leave':
                this.userList.onUserLeave(data);
                break;
            case 'user_changed':
                this.userList.onUserChanged(data);
                break;
            case 'new_game':
                this.userList.onGameStart(data.room, data.players, data.mode);
                this.gameManager.onMessage(message);
                break;
            case 'end_game':
                this.userList.onGameEnd(data.room, data.players);
                break;
            case 'error':
                this.onError(data);
                break;
        }
    };

    Client.prototype.onLogin = function(data){
        var user = data.you, userlist = data.userlist, rooms = data.rooms, ban = data.ban,
            settings = data.settings, opts = data.opts, waiting = data.waiting;
        console.log('client;', 'login', user, userlist, rooms, opts, ban, settings, waiting);
        settings = settings || {};
        this.game = this.opts.game = opts.game;
        this.modes = this.opts.modes = opts.modes;
        this.modesAlias = this.opts.modesAlias = opts.modesAlias || this.modesAlias;
        this.locale.modes = $.extend(true, this.modesAlias, this.locale.modes);
        this.opts.turnTime = opts.turnTime;
        this.opts.loadRanksInRating = !!opts.loadRanksInRating;
        this.chatManager.ban = ban;
        this.currentMode = this.modes[0];
        this.settings = $.extend({},this.defaultSettings, settings);
        console.log('client;', 'settings',  this.settings);

        this.userList.onUserLogin(user, true);
        for (var i = 0; i < userlist.length; i++) this.userList.onUserLogin(userlist[i]);
        this.userList.onWaiting(waiting);
        for (i = 0; i< rooms.length; i++) this.userList.onGameStart(rooms[i].room, rooms[i].players, rooms[i].mode);
        this.isLogin = true;

        this.emit(this.relogin ? 'relogin':'login', user);

        this.ratingManager.init();
        this.historyManager.init();
        this.relogin = false;
    };


    Client.prototype.send = function (module, type, target, data) {
        if (!this.socket.isConnected){
            console.error('Client can not send message, socket is not connected!');
            return;
        }
        if (!this.isLogin){
            console.error('Client can not send message, client is not login!');
            return;
        }
        if (typeof module == "object" && module.module && module.type && module.data) {
            type = module.type;
            data = module.data;
            target = module.target;
            module = module.module;
        }
        if (!module || !type || !data || !target){
            console.warn('client;', "some arguments undefined!", module, type, target, data);
            return;
        }
        if (target != 'server'){
            if (!this.userList.getUser(target)) console.warn('client;', 'send message to offline user!', target);
        }
        this.socket.send({
            module:module,
            type:type,
            target:target,
            data:data
        });
    };

    Client.prototype.setMode = function (mode){
        if (!this.socket.isConnected || !this.isLogin){
            console.error('Client can set mode, socket is not connected!');
            return;
        }
        if (!this.modes|| this.modes.length<1){
            console.error('Client can set mode, no modes!');
            return;
        }
        if (this.modes[mode] &&  this.currentMode != this.modes[mode]) {
            this.currentMode = this.modes[mode];
            this.emit('mode_switch', this.currentMode);
            return
        }
        else {
            for (var i = 0; i < this.modes.length; i++){
                if (this.modes[i] == mode) {
                    this.currentMode = mode;
                    this.emit('mode_switch', this.currentMode);
                    return;
                }
            }
        }
        console.error('wrong mode:', mode, 'client modes:',  this.modes)
    };

    Client.prototype.onError = function (error) {
        console.error('client;', 'server error', error);
        switch (error){
            case 'login_error':
                this.emit('login_error');
                this.socket.ws.close();
                break;
            case 'new_connection':
                this.viewsManager.dialogsView.showDialog('Запущена еще одна копия игры', {});
                this.closedByServer = true;
                break;
        }
        if (error == 'login_error') {

        }
    };


    Client.prototype.onShowProfile = function(userId, userName){
        if (!this.isLogin) return;
        if (!userName) {
            var user = this.userList.getUser(userId);
            if (!user) {
                console.error('client;', 'user', userId, ' is not online!, can not get his name');
                return;
            }
            userName = user.fullName;
        }
        this.emit('show_profile', {userId:userId, userName:userName});
        if (this.opts.autoShowProfile) {
            this.viewsManager.showUserProfile(userId, userName);
        }
    };


    Client.prototype.getPlayer = function(){
        return this.userList.player;
    };


    Client.prototype.getModeAlias = function(mode){
        if (this.modesAlias[mode]) return this.modesAlias[mode];
        else return mode;
    };

    Client.prototype.onBeforeUnload = function(){
        this.unload = true;
        console.log(this.lastKey, Date.now() - this.lastKeyTime);
        if (this.forceReload || (Date.now() - this.lastKeyTime < 100 && (this.lastKey == 82 || this.lastKey == 116))){
            this.confirmUnload = false;
        } else {
            this.confirmUnload = true;
            if (this.gameManager.isPlaying()) return this.locale['dialogs']['loseOnLeave'];
        }
    };


    Client.prototype.onUnload = function(){
        if (this.confirmUnload && this.gameManager.isPlaying()){
            this.gameManager.leaveGame();
        }
    };


    Client.prototype.saveSettings = function(settings){
        settings = settings || this.settings;
        var saveSettings = {};
        for (var prop in this.defaultSettings){
            if (this.defaultSettings.hasOwnProperty(prop))
                saveSettings[prop] = settings[prop];
        }
        console.log('client;', 'save settings:', saveSettings);
        this.send('server', 'settings', 'server', saveSettings);
        this.emit('settings_saved', settings);
        if (this.viewsManager.settingsView.changedProperties.indexOf('disableInvite' != -1)) { // user enable/disable invites
            this.sendChanged();
        }
    };


    Client.prototype.sendChanged = function(){
        if (Date.now() - this.lastTimeUserChanged > 1000) {
            clearTimeout(this.timeoutUserChanged);
            this.lastTimeUserChanged = Date.now();
            this.send('server', 'changed', 'server', {
                isActive: this.isActive
            });
        } else {
            console.log('client;','user_changed!', 'to fast to send user changed!');
            setTimeout(this.sendChanged.bind(this), 1100 - (Date.now() - this.lastTimeUserChanged))
        }
    };


    Client.prototype._onSettingsChanged = function(data){
        this.emit('settings_changed', data);
        switch (data.property){
            case 'disableInvite':
                this.getPlayer().disableInvite = data.value;
                this.userList.onUserChanged(this.getPlayer());
                break;
            case 'blacklist':
                this.saveSettings();
                this.viewsManager.userListView.render();
                this.viewsManager.settingsView.renderBlackList();
                this.viewsManager.v6ChatView.reload();
                break;
        }
    };


    Client.prototype.checkVKWallPostEnabled = function () {
        this.vkWallPost = false;
        if (!this.vkEnable) return;
        window.VK.api('account.getAppPermissions', function(r) {
            if (r && r.response)
                console.log('client; checkVKWallPostEnabled; permissions', r.response);
                this.vkWallPost = !!(r.response & 8192);
        }.bind(this))
    };


    Client.prototype.vkInviteFriend = function () {
        if (!this.vkEnable) return;
        window.VK.callMethod('showInviteBox')
    };


    Client.prototype.vkWallPostResult = function (text) {
        console.log('client;', 'vkWallPostResult', text);
        if (this.opts.vk.title){
            text  += ' в ' + this.opts.vk.title;
        }
        var attachments = (this.opts.vk.photo || '') + ',' + (this.opts.vk.url || '');
        try{
            VK.api('wall.post', {message: text, attachments:attachments}, function(r) {console.log(r)})
        } catch (e) {
            console.log('client;', 'vkWallPostResult', e);
        }
    };

    Client.prototype.showCheaters = function(){
        this.opts.showCheaters = true;
        for (var i = 0; i < this.userList.users.length; i++) {
            for (var j = 0; j < this.modes.length; j++)
                if (this.userList.users[i][this.modes[j]].timeLastCheatGame) {
                    this.userList.users[i].userName = 'cheater!' + this.userList.users[i].userName;
                    break;
                }
        }
    };


    Client.prototype.disableConsole = function(){
        if (!window.console || !window.console.log) return;
        if (!this.console) {
            this.console = {
                    log: window.console.log,
                    error: window.console.error,
                    warn: window.console.warn
                }
        }
        window.console.log = window.console.error =  window.console.warn = function(){}
    };

    Client.prototype.enableConsole = function(){
        if (!window.console || !this.console) return;
        window.console.log = this.console.log;
        window.console.error = this.console.error;
        window.console.warn = this.console.warn;
    };

    Client.prototype.get = function(target, params, callback) {
        //this.xhr = this.xhr || new XMLHttpRequest();
        var xhr = new XMLHttpRequest(),
            url = this.opts.api + target + '?game='+this.game;
        //xhr.abort();
        for (var p in params) url += '&' + p +'='+params[p];

        console.log('client;', 'get', url);
        xhr.open('GET', url, true);
        xhr.send();
        xhr.onreadystatechange = function() {
            if (xhr.readyState != 4) return;
            console.log('client;', 'get', url, 'done', xhr.responseText);
            if (typeof callback != "function") return;
            if (xhr.status != 200) {
                callback(null);
            } else {
                callback(JSON.parse(xhr.responseText))
            }
        }
    };


    var defaultSettings = {
        blacklist: {},
        disableInvite: false,
        sounds: true
    };

    var defaultImages = {
        close:      '//logic-games.spb.ru/v6-game-client/app/i/close.png',
        spin:       '//logic-games.spb.ru/v6-game-client/app/i/spin.gif',
        sortAsc:    '//logic-games.spb.ru/v6-game-client/app/i/sort-asc.png',
        sortDesc:   '//logic-games.spb.ru/v6-game-client/app/i/sort-desc.png',
        sortBoth:   '//logic-games.spb.ru/v6-game-client/app/i/sort-both.png',
        del:        '//logic-games.spb.ru/v6-game-client/app/i/delete.png',
        block:      '//logic-games.spb.ru/v6-game-client/app/i/stop.png'
    };

    var defaultSounds = {
        start: {
            src: '//logic-games.spb.ru/v6-game-client/app/audio/v6-game-start.ogg',
            volume: 0.5
        },
        turn: {
            src: '//logic-games.spb.ru/v6-game-client/app/audio/v6-game-turn.ogg',
            enable: false
        },
        win: {
            src: '//logic-games.spb.ru/v6-game-client/app/audio/v6-game-win.ogg',
            volume: 0.5,
            enable: false
        },
        lose: {
            src: '//logic-games.spb.ru/v6-game-client/app/audio/v6-game-lose.ogg',
            volume: 0.5,
            enable: false
        },
        invite: {
            src: '//logic-games.spb.ru/v6-game-client/app/audio/v6-invite.ogg'
        },
        timeout: {
            src: '//logic-games.spb.ru/v6-game-client/app/audio/v6-timeout.ogg'
        }
    };

    return Client;
});
define('v6-game-client',['client'], function(Client) {
    // TODO client is global(make singleton)
    // TODO css images not found)
    

    console.log('main;', new Date(), 'ready');

    return Client;
});
define('main.js',['v6-game-client'], function (Client) {
    return Client;
});

define('require-cnf',[],function() {});
define('jquery', function() {return jQuery});
define('jquery-ui', function() {return jQuery});
define('underscore', function() {return Underscore});
define('backbone', function() {return Backbone});
require(['require-cnf'], function() {
        require(['v6-game-client'], function(Client) {
            console.log('app v6-game-client start');
            window.Client = Client;
        }, undefined, true);
}, undefined, true);
}($, _, Backbone));