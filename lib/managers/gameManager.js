'use strict';

//require
let Manager = require('./manager.js');
let Room = require('../instances/room.js');
let Engine = require('../engine.js');
let co = require('co');


let moduleName = 'GameManager';
let logger, log, err, wrn;

module.exports = class GameManager extends Manager {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log; wrn = logger.wrn; err = logger.err;

        conf = Object.assign(defaultConf, conf);
        super(server, conf);

        this.games = this.server.conf.games;
        this.gamesEngines = {};
        this.gamesConf = {};
        log(`constructor`, `${moduleName} created, conf: ${JSON.stringify(conf)}`);
    }

    init() {
        let self = this;
        return co(function* (){
                    let test = yield self.test();
                    for (let game of Object.keys(self.games)){
                        let conf = self.conf.games[game] ?  self.conf.games[game].conf : {},
                            engine = self.conf.games[game] ? self.conf.games[game].engine : false;
                        self.gamesConf[game] = Object.assign(self.conf.defaultGameConf, conf);
                        self.gamesEngines[game] = yield self.initGameEngine(engine, self.games[game].conf)

                    }
                    return true;
                })
            .then(() => {
                self.isRunning = true;
                log(`init`, `init success`);
                return true;
            })
            .catch((e) => {
                this.isRunning = false;
                err(`init`, `error: ${e}, stack: ${e.stack}`);
                throw e;
            });
    }

    initGameEngine(engineClass, conf){
        engineClass = engineClass || Engine;
        let engine = new engineClass(this, conf);
        return engine.init().then(()=>{return engine})
    }

    test() {
        log(`test`, `start test`);
        return super.test()
            .then(res => {
                return res;
            });
    }

    onNewMessage (message) {
        let self = this;
        return co(function* (){
            message = yield self.addToList(message);
            if (!message) return true;
            else return self.onMessage(message)
        })
    };

    onMessage (message){
        let self = this,
            game = message.game,
            roomInfo = message.room,
            data = message.data,
            room = null,
            user = message.sender,
            engine = self.gamesEngines[game];

        log(`onMessage`, `message: ${JSON.stringify(message)}`);
        return co(function* (){
            if (roomInfo.role == 'player' || type == 'leave'){
                room = yield self.loadRoom(game, roomInfo.roomId);
                if (!room){
                    throw new Error(`no room ${game}, ${roomInfo.roomId}`)
                }
            }
            switch (message.type) {
                case 'ready': // player ready to play
                    if (roomInfo.role == 'player'){
                        yield self.onUserReady(engine, room, user, data);
                    }
                    break;
                case 'turn': // all players turns
                    if (roomInfo.role == 'player'){}
                    //this.onUserTurn(room, message.sender, message.data);
                    break;
                case 'event': // all events, draw, throw, turn back, others
                    if (roomInfo.role == 'player'){}
                    //this.onUserEvent(room, message.sender, message.data);
                    break;
                case 'spectate': // user begin spectate
                    if (roomInfo.role == 'spectate'){}
                    //this.onUserSpectate(room, message.sender);
                    break;
                case 'leave': // user leave room
                    if (roomInfo.role == 'player'){}
                    else {}
                    //if (room.players.indexOf(message.sender) != -1)
                    //    this.onUserLeave(room, message.sender);
                    //else
                    //if (room.spectators.indexOf(message.sender) != -1) this.onSpectatorLeave(room, message.sender);
                    //else logger.err('GameManager.onMessage leave', 'user not a player and not a spectator in room', room.id, 1);
                    break;
            }
            yield self.memory.del(`game_events_current:${game}:${roomInfo.roomId}`);
            message = yield self.getCurrentMessage(game, roomInfo.roomId);
            if (!message) return true;
            else return self.onMessage(message)
        }).catch((e) => {
            err(`onMessage`, `error: ${e.stack || e}`);
            return self.server.inviteManager.closeRoom(game, roomInfo.roomId);
        })
    };

    addToList(message) {
        let self = this, game = message.game, room;
        return co(function* () {
            if (message.type == 'spectate' && message.data.roomId) {
                room = {roomId: message.data.roomId, role: 'spectator'}
            } else {
                room = yield self.getUserRoom(message.sender.userId, game);
            }
            if (!room){
                err(`addToList`, `no room, message: ${JSON.stringify(message)}`);
                return false;
            }
            message.room = room;
            message = JSON.stringify(message);
            log(`addToList`, `obj: ${message}`);
            yield self.memory.listAdd(`game_events_list:${game}:${room.roomId}`, message);
            return self.getCurrentMessage(game, room.roomId);
        })
    }

    getCurrentMessage(game, roomId){
        return this.memory.listGet(`game_events_list:${game}:${roomId}`, `game_events_current:${game}:${roomId}`).then((message) => {
            if (message) message = JSON.parse(message);
            return message
        })
    }

    getUserRoom(userId, game) {
        return this.memory.hashGetAll(`user_room:${game}:${userId}`)
    }

    loadRoom(game, roomId) {
        let self = this;
        return co(function*() {
            let roomData = yield self.memory.hashGet(`rooms:${game}`, roomId);
            if (!roomData) {
                err(`loadRoom`, `no room!, game: ${game}, roomId: ${roomId}`, 1);
                return false;
            }
            log(`loadRoom`, `room: ${JSON.stringify(roomData)}`);
            return Room.load(roomData);
        })
    }

    onUserReady(engine, room, user, ready){
        log(`onUserReady`, `roomId: ${room.id}, userId: ${user.userId} room: ${JSON.stringify(room.getDataToSave())}`);
        if (!room.isGameStateWaiting()){
            wrn(`onUserReady`, `game already started!, ${room.roomId}, ${user.userId}`, 1);
            return Promise.resolve(true);
        }
        return engine.onMessage(Engine.USER_READY, room, user, ready)
    }

    onUserTurn(){

    }

    onUserEvent(){

    }

    onUserTimeout(){

    }

    onUserLeave(){

    }

    sendUserReady(room, user, data){
        return this.sendInRoom(room, {
            module: 'game_manager',
            type: 'ready',
            data: data
        })
    }

    sendRoundStart(){

    }

    sendUserTurn(){

    }

    sendUserEvent(){

    }

    sendEvent(){

    }

    sendRoundEnd(){

    }

    sendInRoom(room, message){
        let self = this, game = room.game;
        message = JSON.stringify(message);
        log(`sendInRoom`, `${game}, ${room.id}, message: ${message}`);
        return co(function*() {
            for (let userId of room.players){
                yield self.server.userManager.sendToUser(game, userId, message);
            }
            for (let userId of room.spectators){
                yield self.server.userManager.sendToUser(game, userId, message);
            }
        })
    }

};


let defaultConf = {
    games:{},
    defaultGameConf: {}
};