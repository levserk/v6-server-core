'use strict';

//require
let Manager = require('./manager.js');
let Room = require('../instances/room.js');
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
        log(`constructor`, `${moduleName} created, conf: ${JSON.stringify(conf)}`);
    }

    init() {
        let self = this;
        return co(function* (){
                    let test = yield self.test();
                    for (let game of Object.keys(self.games)){
                        yield self.memory.del(`invites_current:${game}`);
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
                return e;
            });
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
        let self = this, game = message.game, room = message.room;
        log(`onMessage`, `game: ${JSON.stringify(message)}`);
        return co(function* (){
            switch (message.type) {
                case 'ready': // player ready to play
                    if (room.role == 'player'){

                    }
                    //this.setUserReady(room, message.sender, message.data);
                    break;
                case 'turn': // all players turns
                    if (room.role == 'player'){}
                    //this.onUserTurn(room, message.sender, message.data);
                    break;
                case 'event': // all events, draw, throw, turn back, others
                    if (room.role == 'player'){}
                    //this.onUserEvent(room, message.sender, message.data);
                    break;
                case 'spectate': // user begin spectate
                    if (room.role == 'spectate'){}
                    //this.onUserSpectate(room, message.sender);
                    break;
                case 'leave': // user leave room
                    if (room.role == 'player'){}
                    else {}
                    //if (room.players.indexOf(message.sender) != -1)
                    //    this.onUserLeave(room, message.sender);
                    //else
                    //if (room.spectators.indexOf(message.sender) != -1) this.onSpectatorLeave(room, message.sender);
                    //else logger.err('GameManager.onMessage leave', 'user not a player and not a spectator in room', room.id, 1);
                    break;
            }
            yield self.memory.del(`game_events_current:${game}:${room.roomId}`);
            message = yield self.getCurrentMessage(game, room.roomId);
            if (!message) return true;
            else return self.onMessage(message)
        });
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
            let room = Room.load(roomData);
        })
    }
};


let defaultConf = {

};