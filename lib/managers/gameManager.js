'use strict';

//require
let Manager = require('./manager.js');
let Room = require('../instances/room.js');
let Engine = require('../engine.js');
let co = require('co');

let moduleName = 'GameManager';
let logger, log, err, wrn;

let defaultConf = {
    games: {},
    defaultGameConf: {}
};

const TYPE_MULTI = 'multi';
const TYPE_SINGLE = 'single';
const ROLE_PLAYER = 'player';
const ROLE_SPECTATOR = 'spectator';

module.exports = class GameManager extends Manager {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        conf = Object.assign(defaultConf, conf);
        super(server, conf);

        this.games = this.server.conf.games;
        this.gamesEngines = {};
        this.gamesConf = {};
        log(`constructor`, `${moduleName} created, conf: ${JSON.stringify(conf)}`);
    }

    init() {
        let self = this;
        return co(function* () {
            let test = yield self.test();

            // init engine and conf for each game
            for (let game of Object.keys(self.games)) {
                let conf = self.conf.games[game] ? self.conf.games[game].conf : {},
                    engine = self.conf.games[game] ? self.conf.games[game].engine : false;
                self.gamesConf[game] = Object.assign(self.conf.defaultGameConf, conf);
                self.gamesEngines[game] = yield self.initGameEngine(engine, self.games[game].conf);
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

    initGameEngine(engineClass, conf) {
        engineClass = engineClass || Engine;
        let engine = new engineClass(this, conf);
        return engine.init().then(()=> {
            return engine;
        });
    }

    test() {
        log(`test`, `start test`);
        return super.test()
            .then(res => {
                return res;
            });
    }

    onNewMessage(message) {
        let self = this;
        return co(function* () {
            message = yield self.addToList(message);
            if (!message) {
                return true;
            }
            else {
                return self.onMessage(message);
            }
        });
    }

    addToList(message) {
        let self = this, game = message.game, userRoom;
        return co(function* () {
            switch (message.type) {
                case 'spectate':
                    userRoom = { roomId: message.data.roomId, role: 'spectator' };
                    break;
                case 'leaved':
                    //TODO: check userRoom
                    userRoom = message.userRoom;
                    break;
                default:
                    userRoom = yield self.getUserRoom(message.sender.userId, game);
            }
            if (!userRoom || !userRoom.roomId) {
                err(`addToList`, `no room, message: ${JSON.stringify(message)}`);
                return false;
            }
            message.userRoom = userRoom;
            message = JSON.stringify(message);
            log(`addToList`, `obj: ${message}`);
            yield self.memory.listAdd(`game_events_list:${game}:${userRoom.roomId}`, message);
            return self.getCurrentMessage(game, userRoom.roomId);
        });
    }

    getCurrentMessage(game, roomId) {
        return this.memory.listGet(`game_events_list:${game}:${roomId}`, `game_events_current:${game}:${roomId}`).then((message) => {
            if (message) {
                message = JSON.parse(message);
            }
            return message;
        });
    }

    onMessage(message) {
        let self = this,
            game = message.game,
            userRoom = message.userRoom,
            data = message.data,
            room = null,
            user = message.sender,
            engine = self.gamesEngines[game];

        log(`onMessage`, `message: ${JSON.stringify(message)}`);
        return co(function* () {

            //load room
            if (userRoom.role === 'player' || message.type === 'leave' || message.type === 'leaved') {
                room = yield self.loadRoom(game, userRoom.roomId);
                if (!room) {
                    throw Error(`no room ${game}, ${userRoom.roomId}`);
                }
            }

            log(`onMessage`, `start processing message ${message.type}, in room: ${room.id}`);

            switch (message.type) {
                case 'ready': // player ready to play
                    if (userRoom.role === 'player') {
                        yield self.onUserReady(engine, room, user, data);
                    }
                    break;
                case 'turn': // all players turns
                    if (userRoom.role === 'player') {
                        log();
                    }
                    //this.onUserTurn(room, message.sender, message.data);
                    break;
                case 'event': // all events, draw, throw, turn back, others
                    if (userRoom.role === 'player') {
                        log();
                    }
                    //this.onUserEvent(room, message.sender, message.data);
                    break;
                case 'spectate': // user begin spectate
                    if (userRoom.role === 'spectate') {
                        log();
                    }
                    //this.onUserSpectate(room, message.sender);
                    break;
                case 'leave': // user leave room
                    if (userRoom.role === 'player') {
                        return self.onUserLeave(engine, room, user);
                    }
                    else {
                        // spectator leave;
                        return self.onSpectatorLeave(engine, room, user);
                    }
                    break;
                case 'leaved':
                    if (userRoom.role === 'player') {
                        return self.onUserLeave(engine, room, user);
                    }
                    else {
                        // spectator leave;
                        return self.onSpectatorLeave(engine, room, user);
                    }
                    break;
            }

            log(`onMessage`, `complete, message ${message.type}, in room: ${room.id}`);

            //save room
            yield self.saveRoom(room);

            //get next message in room
            yield self.memory.del(`game_events_current:${game}:${userRoom.roomId}`);
            message = yield self.getCurrentMessage(game, userRoom.roomId);
            if (!message) {
                return true;
            }
            else {
                return self.onMessage(message);
            }
        }).catch((e) => {
            err(`onMessage`, `error: ${e.stack || e}`);
            return self.server.closeRoom(game, userRoom.roomId);
        });
    }

    getUserRoom(userId, game) {
        return this.memory.hashGetAll(`user_room:${game}:${userId}`);
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
        });
    }

    saveRoom(room) {
        if (!room) {
            return Promise.resolve(false);
        }
        return this.memory.hashAdd(`rooms:${room.game}`, room.id, room.getDataToSave());
    }

    onUserReady(engine, room, user, ready) {
        log(`onUserReady`, `roomId: ${room.id}, userId: ${user.userId} room: ${JSON.stringify(room.getDataToSave())}`);
        if (!room.isGameStateWaiting()) {
            wrn(`onUserReady`, `game already started!, ${room.roomId}, ${user.userId}`, 1);
            return Promise.resolve(true);
        }
        return engine.onMessage(Engine.USER_READY, room, user, ready);
    }

    onUserTurn() {

    }

    onUserEvent() {

    }

    onUserTimeout() {

    }

    onUserLeave(engine, room, user) {
        let self = this, game = room.game;
        if (!room.leaveSpectator(user.userId)) {
            return Promise.resolve(false);
        }
        return co(function* () {
            yield engine.onMessage(Engine.USER_LEAVE, room, user);
            return self.server.leaveUserRoom(user.userId, game, room.id);
        });
    }

    onSpectatorLeave(engine, room, user) {
        let self = this, game = room.game;
        if (!room.leaveSpectator(user.userId)) {
            return Promise.resolve(false);
        }
        return co(function* () {
            yield self.server.userManager.sendToSockets(game, {
                module: 'game_manager',
                type: 'spectator_leave',
                data: {
                    user: user.userId,
                    room: room.id
                }
            });
            // unset user current room
            yield self.server.leaveUserRoom(user.userId, game, room.id);
        });
    }

    sendUserReady(room, user, data) {
        return this.sendInRoom(room, {
            module: 'game_manager',
            type: 'ready',
            data: data
        });
    }

    sendRoundStart(room) {
        return this.sendInRoom(room, {
            module: 'game_manager',
            type: 'round_start',
            data: room.getInitData()
        });
    }

    sendUserTurn() {

    }

    sendUserEvent() {

    }

    sendEvent() {

    }

    sendRoundEnd() {

    }

    sendGameEnd(room) {
        return this.server.closeRoom(room.game, room.id);
    }

    sendInRoom(room, message) {
        let self = this, game = room.game;
        message = JSON.stringify(message);
        log(`sendInRoom`, `${game}, ${room.id}, message: ${message}`);
        return co(function*() {
            for (let userId of room.players) {
                yield self.server.userManager.sendToUser(game, userId, message);
            }
            for (let userId of room.spectators) {
                yield self.server.userManager.sendToUser(game, userId, message);
            }
            return true;
        });
    }

};