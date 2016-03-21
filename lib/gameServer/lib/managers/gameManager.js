'use strict';

//require
let Manager = require('../../../lib/manager.js');
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
            yield self.addToList(message);
        });
    }

    addToList(message) {
        let self = this, game = message.game, userRoom;
        return co(function* () {
            switch (message.type) {
                case 'spectate':
                    userRoom = {roomId: message.data.roomId, role: 'spectator'};
                    break;
                case 'leaved':
                    //TODO: check userRoom
                    userRoom = message.userRoom;
                    break;
                case 'timeout':
                    if (message.user) { // timeout not from server!! skip
                        yield self.removeCurrentMessage(game, message.roomId);
                        return self.doNextMessage(game, message.roomId);
                    }
                    userRoom = message.userRoom;
                    break;
                default:
                    userRoom = yield self.getUserRoom(message.user.userId, game);
            }
            if (!userRoom || !userRoom.roomId) {
                if (message.type !== 'relogin') {
                    err(`addToList`, `no room, message: ${JSON.stringify(message)}`);
                }
                return false;
            }
            message.userRoom = userRoom;
            message = JSON.stringify(message);

            log(`addToList`, `obj: ${message}`);
            yield self.memory.listAdd(`game_events_list:${game}:${userRoom.roomId}`, message);

            return self.doNextMessage(game, userRoom.roomId);
        });
    }

    doNextMessage(game, roomId) {
        let self = this;
        return co(function* () {
            let message;
            while ((message = yield self.getCurrentMessage(game, roomId)) !== false) {
                if (message) {
                    yield self.onMessage(message);
                    yield self.removeCurrentMessage(game, roomId);
                }
            }
        });
    }

    getCurrentMessage(game, roomId) {
        log(`getCurrentMessage`, `game: ${game}, roomId: ${roomId} `);
        return this.memory.listGet(`game_events_list:${game}:${roomId}`, `game_events_current:${game}:${roomId}`)
            .then((message) => {
                if (message) {
                    message = JSON.parse(message);
                }
                return message ? message : false;
            });
    }

    removeCurrentMessage(game, roomId) {
        log(`removeCurrentMessage`, `game: ${game}, roomId: ${roomId} `);
        return this.memory.del(`game_events_current:${game}:${roomId}`);
    }

    onMessage(message) {
        let self = this,
            game = message.game,
            userRoom = message.userRoom,
            data = message.data,
            room = null,
            user = message.user,
            sender = message.sender,
            engine = self.gamesEngines[game];

        log(`onMessage`, `message: ${JSON.stringify(message)}`);
        return co(function* () {

            //load room
            if (message.type === 'leave' || message.type === 'leaved' ||
                message.type === 'timeout' || userRoom.role === 'player') {
                room = yield self.loadRoom(game, userRoom.roomId);
                if (!room) {
                    if (message.type !== 'timeout') {
                        // something going wrong
                        throw Error(`no room ${game}, ${userRoom.roomId}`);
                    } else {
                        // room closed
                        return false;
                    }
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
                        yield self.onUserTurn(engine, room, user, data);
                    }
                    break;
                case 'event': // all events, draw, throw, turn back, others
                    if (userRoom.role === 'player') {
                        yield self.onUserEvent(engine, room, user, data);
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
                        yield self.onUserLeave(engine, room, user);
                    }
                    else {
                        // spectator leave;
                        yield self.onSpectatorLeave(engine, room, user);
                    }
                    break;
                case 'leaved':
                    if (userRoom.role === 'player') {
                        yield self.onUserLeave(engine, room, user);
                    }
                    else {
                        // spectator leave;
                        yield self.onSpectatorLeave(engine, room, user);
                    }
                    break;
                case 'disconnect':
                    if (userRoom.role === 'player') {
                        yield self.onUserDisconnect(engine, room, user);
                    }
                    else {
                        // spectator leave;
                        yield self.onSpectatorLeave(engine, room, user);
                    }
                    break;
                case 'relogin':
                        yield self.onUserRelogin(engine, room, user);
                    break;
                case 'timeout':
                    yield self.onUserTimeout(engine, room, data);
                    break;
            }

            log(`onMessage`, `complete, message ${message.type}, in room: ${room.id}`);

            //save room
            yield self.saveRoom(room);

            return true;
        }).catch((e) => {
            err(`onMessage`, `error on message!
            message: ${JSON.stringify(message)},
            error: ${e.stack || e}`);
            // clear messages list
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
            let room = Room.load(roomData);
            log(`loadRoom`, `room.timeout: ${room.timeout}`);
            return room;
        });
    }

    saveRoom(room) {
        if (!room || room.isGameStateClosing()) {
            return Promise.resolve(false);
        }
        log(`saveRoom`, ` room.timeout: ${room.timeout}`);
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

    onUserTurn(engine, room, user, turn) {
        let self = this, game = room.game, userId = user.userId;
        return co(function* () {
            if (!room.isGameStatePlaying()) {
                err(`onUserTurn`, `turn in not started game, room: ${room.id}, userId: ${user.userId}`, 1);
                yield self.sendError(game, user, 'turn in not started game, room: ' + room.id);
                return false;
            }

            if (room.currentId !== userId) {
                err(`onUserTurn`, `not_your_turn, room: ${room.id}, userId: ${user.userId}`, 1);
                yield self.sendError(game, user, 'not_your_turn, room: ' + room.id);
                return false;
            }

            if (turn.action === 'timeout' || turn.type || turn.nextPlayer || turn.userTurnTime) {
                wrn(`onUserTurn`, `usage some reserved properties in turn: ${turn}, ${userId}`, 1);
            }

            // remove server properties
            if (turn.action === 'timeout') {
                delete turn.action;
            }
            if (turn.userTurnTime) {
                delete turn.userTurnTime;
            }
            if (turn.nextPlayer) {
                delete turn.nextPlayer;
            }
            if (turn.type) {
                delete turn.type;
            }

            return engine.onMessage(Engine.USER_TURN, room, user, turn);
        });
    }

    onUserEvent(engine, room, user, event) {
        let game = room.game;
        if (!room.isGameStatePlaying()) {
            err(`onUserEvent`, `event in not started game room: ${room.id}, userId: ${user.userId}`, 1);
            this.sendError(game, user, 'event in not started game room: ' + room.id);
            return Promise.resolve(false);
        }
        if (!event.type) {
            err(`onUserEvent`, `wrong event type,room: ${room.id}, user: ${user.userId}`, 1);
            this.sendError(game, user, 'wrong event type room: ' + room.id);
            return Promise.resolve(false);
        }
        return engine.onMessage(Engine.USER_EVENT, room, user, event);
    }

    setTimeout(room, userId) {
        let time = room.getTurnTime(), game = room.game, userRoom = room.getPlayerRoom('player');
        log(`setTimeout`, `room: ${room.id}, ${userId}, ${room.currentId}, ${time}, ${room.timeout}`);
        setTimeout(()=> {
            this.onMessage({
                type: 'timeout',
                game: game,
                userRoom: userRoom,
                roomId: room.id,
                sender: 'server',
                data: {
                    turnStartTime: room.turnStartTime,
                    userId: userId,
                    roomId: room.id
                }
            });
        }, time);
        return Promise.resolve(true);
    }

    onUserTimeout(engine, room, timeout) {
        log(`onUserTimeout`, `room: ${room.id}, ${room.currentId}, ${room.turnStartTime},
        timeout: ${timeout.turnStartTime}, ${timeout.userId}`);
        if (!room.isGameStatePlaying()) {
            return Promise.resolve(false);
        }
        if (room.turnStartTime !== timeout.turnStartTime) {
            // old timeOut
            return Promise.resolve(false);
        } else {
            return engine.onMessage(Engine.USER_TIMEOUT, room, timeout.userId, timeout);
        }
    }

    onUserLeave(engine, room, user) {
        log(`onUserLeave`, `user: ${user.userId}`);
        let self = this, game = room.game;

        if (!room.hasPlayer(user.userId)) {
            return Promise.resolve(false);
        }

        return co(function* () {
            yield engine.onMessage(Engine.USER_LEAVE, room, user);
            //yield self.server.leaveUserRoom(game, user.userId, room.id);
        });
    }

    onSpectatorLeave(engine, room, user) {
        let self = this, game = room.game;
        if (!room.leaveSpectator(user.userId)) {
            return Promise.resolve(false);
        }
        return co(function* () {
            yield self.server.sendInRoom(room, {
                module: 'game_manager',
                type: 'spectator_leave',
                data: {
                    user: user.userId,
                    room: room.id
                }
            });
            // unset user current room
            yield self.server.leaveUserRoom(game, user.userId, room.id);
        });
    }

    onUserDisconnect(engine, room, user) {
        let self = this;
        log(`onUserDisconnect`, `room: ${room.id}, userId: ${user.userId}`);
        //return co(function* () {
            if (room.isGameStateWaiting()) {
                return self.onUserLeave(engine, room, user);
            } else {
                return Promise.resolve(true);
            }
            //TODO: engine on user disconnect
            //TODO send user offline
        //});
    }

    onUserRelogin(engine, room, user) {
        let self = this;
        return co(function* () {
            yield self.server.sendToUser(room.game, user.userId, {
                module: 'game_manager',
                type: 'game_restart',
                data: room.getGameData()
            });
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

    sendUserTurn(room, user, userTurn) {
        return this.sendInRoom(room, {
            module: 'game_manager',
            type: 'turn',
            data: {user: user.userId, turn: userTurn}
        });
    }

    sendUserEvent() {

    }

    sendEvent() {

    }

    sendRoundEnd(room, result, players) {
        let self = this, game = room.game, mode = room.mode;
        return co(function* () {
            result.score = room.getScore();
            result.saveHistory = room.saveHistory;
            result.saveRating = room.saveRating;

            // TODO replace this in room
            for (let userId of room.players) {
                room.userData[userId].ready = false;
                room.userData[userId].timeouts = 0;
                room.userData[userId].takeBacks = 0;
            }

            for (let user of players) {
                yield self.server.saveUser(game, mode, user);
            }

            yield self.saveGame(room, result);

            yield self.sendInRoom(room, {
                module: 'game_manager',
                type: 'round_end',
                data: result
            });

            //if (room.hasOnlinePlayer() || room.spectators.length > 0) // check room isn't empty
            //    try{ // users can leave room and room will be closed before round result send
            //        this.server.router.send({
            //            module: 'game_manager',
            //            type: 'round_end',
            //            target: room,
            //            data: result
            //        });
            //    } catch (e) {
            //        logger.err('GameManager.sendGameResult, err:', e, 1);
            //    }
            //else {
            //    logger.warn('GameManager.sendGameResult, room:', room.id, 'no players online', 1);
            //}
            //
            //if (callback) callback();
            //for (i = 0; i < room.players.length; i++) {
            //    if (!room.players[i].isConnected && !room.players[i].isRemoved) this.server.onUserLeave(room.players[i]);
            //}
        });
    }

    saveGame(room, result) {
        return Promise.resolve(result);
    }

    sendUserLeave(room, user) {
        let self = this, game = room.game;
        return co(function* () {
            yield self.sendInRoom(room, {
                module: 'game_manager',
                type: 'user_leave',
                data: user.userId
            });
        });
    }

    sendGameEnd(room) {
        log(`sendGameEnd`, `room: ${room.id}, players: ${JSON.stringify(room.players)}`);
        let self = this;
        return co(function* () {
            room.gameState = 'closing';
            yield self.server.closeRoom(room.game, room.id);
            for (let userId of room.players){
                yield self.server.leaveUserRoom(room.game, userId, room.id);
            }
        });

    }

    sendError(game, user, error) {
        return this.server.sendToUser(game, user.userId, {
            module: 'game_manager',
            type: 'error',
            data: error
        });
    }

    sendInRoom(room, message) {
        let self = this, game = room.game;
        message = JSON.stringify(message);
        log(`sendInRoom`, `${game}, ${room.id}, message: ${message}`);
        return co(function*() {
            for (let userId of room.players) {
                yield self.server.sendToUser(game, userId, message);
            }
            for (let userId of room.spectators) {
                yield self.server.sendToUser(game, userId, message);
            }
            return true;
        });
    }
};