'use strict';

//require
let Manager = require('./manager.js');
let Room = require('../instances/room.js');
let co = require('co');

let moduleName = 'InviteManager';
let logger, log, err, wrn;

module.exports = class InviteManager extends Manager {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log; wrn = logger.wrn; err = logger.err;

        conf = Object.assign(defaultConf, conf);
        super(server, conf);

        this.games = this.server.conf.games;
        log(`constructor`, `inviteManager created, conf: ${JSON.stringify(conf)}`);
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
        let self = this, game = message.game;
        log(`onMessage`, `game: ${JSON.stringify(message)}`);
        return co(function* (){
            switch (message.type){
                case "invite": yield self.onInvite(message.sender, message.target, message.game, message.data); break;
                case "cancel": yield self.onInviteCancel(message.sender, message.target, message.game, message.data); break;
                case "accept": yield self.onInviteAccepted(message.sender, message.target, message.game, message.data); break;
                case "reject": yield self.onInviteRejected(message.sender, message.target, message.game, message.data); break;
                case "random": yield self.onPlayRandom(message.sender, message.game, message.data); break;
                case "user_leave": yield self.onUserLeave(message.user, message.game); break;
            }
            yield self.memory.del(`invites_current:${game}`);
            message = yield self.getCurrentMessage(game);
            if (!message) return true;
            else return self.onMessage(message)
        });
    };

    addToList(message) {
        let self = this, game = message.game;
        return co(function* () {
            message = JSON.stringify(message);
            log(`addToList`, `obj: ${message}`);
            yield self.memory.listAdd(`invites_list:${game}`, message);
            return self.getCurrentMessage(game);
        })
    }

    getCurrentMessage(game){
        return this.memory.listGet(`invites_list:${game}`, `invites_current:${game}`).then((message) => {
            if (message) message = JSON.parse(message);
            return message
        })
    }

    onInvite (user, target, game, invite){
        log(`onInvite`,` user ${user.userId}, target: ${target}, invite: ${JSON.stringify(invite)}`);
        let self = this, gameModes = this.games[game].modes, defaultMode = Object.keys(gameModes)[0];
        return co(function* (){
            if (target == user.userId){
                wrn('onInvite', `user invite himself, ${user.userId}`, 1);
                return true;
            }
            invite = invite || {};
            invite.mode = invite.mode || defaultMode;
            invite.from = user.userId;
            let socket = yield self.server.userManager.getUserSocket(game, invite.target);
            if (!socket) {
                return false;
            }
            // check user not in game
            yield self.memory.set(`invites:${game}:${user.userId}`, JSON.stringify(invite));
            return self.server.userManager.sendToSocket(socket, JSON.stringify({
                module : "invite_manager",
                type: "invite",
                data: invite
            }))
        });
    };


    onInviteCancel (user, target, game, invite){
        log(`onInviteCancel`,` user ${user.userId}, target: ${target}, invite: ${JSON.stringify(invite)}`);
        let self = this, gameModes = this.games[game].modes, defaultMode = Object.keys(gameModes)[0];
        return co(function*() {
            yield self.memory.del(`invites:${game}:${user.userId}`);
            // todo: load this;
            invite = invite || {};
            invite.mode = invite.mode || defaultMode;
            invite.from = user.userId;
            let socket = yield self.server.userManager.getUserSocket(game, target);
            if (!socket) {
                return false;
            }
            return self.server.userManager.sendToSocket(socket, JSON.stringify({
                module : "invite_manager",
                type: "cancel",
                data: invite
            }));
        });
    };


    onInviteAccepted (user, targetId, game, invite){
        log(`onInviteAccepted`,` user ${user.userId}, target: ${targetId}, invite: ${JSON.stringify(invite)}`);
        let self = this, gameModes = this.games[game].modes, defaultMode = Object.keys(gameModes)[0];
        return co(function* (){
            // get invitedata
            yield self.memory.del(`invites:${game}:${targetId}`);
            let targetSocket = yield self.server.userManager.getUserSocket(game, targetId);
            let userSocket = yield self.server.userManager.getUserSocket(game, user.userId);
            if (!targetSocket || !userSocket) {
                if (targetSocket) return self.server.userManager.sendToSocket(targetSocket, JSON.stringify({
                    module : "invite_manager",
                    type: "reject",
                    data: invite
                }));
                return false;
            }
            yield self.removeWaitingUser(targetId, game);
            yield self.removeWaitingUser(user.userId, game);
            yield self.createRoom(game, targetSocket, targetId, [targetId, user.userId], invite, 'multi');

            log(`onInviteAccepted`, `start game!!`);
        });
    };


    onInviteRejected (user, target, game, invite){
        log(`onInviteRejected`,` user ${user.userId}, target: ${target}, invite: ${JSON.stringify(invite)}`);
        let self = this, gameModes = this.games[game].modes, defaultMode = Object.keys(gameModes)[0];
        return co(function* (){
            yield self.memory.del(`invites:${game}:${target}`);
            invite = invite || {};
            invite.target = user.userId;
            let socket = yield self.server.userManager.getUserSocket(game, target);
            if (!socket) {
                return false;
            }
            return self.server.userManager.sendToSocket(socket, JSON.stringify({
                module : "invite_manager",
                type: "reject",
                data: invite
            }));
        });
    };


    onPlayRandom (user, game, data){
        log(`onPlayRandom`,` user ${user.userId}, game: ${game}, data: ${JSON.stringify(data)}`);
        let self = this, gameModes = this.games[game].modes, defaultMode = Object.keys(gameModes)[0];
        return co(function* (){
            if (!user || !user.userId || !data || !game) {
                return false;
            }
            let modeBefore = yield self.removeWaitingUser(user.userId, game);
            if (modeBefore == data.mode || data == 'off'){
                return true;
            }
            // todo: check user in room
            if (!gameModes[data.mode]){
                err(`onPlayRandom`, `InviteManager.onRandomPlay wrong game mode: ${data.mode} `, 1);
                return false;
            }

            let waitingId = yield self.memory.hashGet(`waiting:${game}`, data.mode);
            if (waitingId) {
                // todo: check waiting in room and remove he
                yield self.removeWaitingUser(waitingId, game);
                let targetSocket = yield self.server.userManager.getUserSocket(game, waitingId);
                let userSocket = yield self.server.userManager.getUserSocket(game, user.userId);
                if (!targetSocket || !userSocket)return false;
                yield self.createRoom(game, targetSocket, waitingId, [waitingId, user.userId], data, 'multi');
                log(`onPlayRandom`, `start game!!`);
            } else {
                let sendData = {};
                sendData[data.mode] = user.userId;
                yield self.memory.hashAdd(`waiting:${game}`, data.mode, user.userId);
                yield self.server.userManager.sendToSockets(game, JSON.stringify({
                    module : "invite_manager",
                    type: "random_wait",
                    data: sendData
                }));
            }
        });
    };

    onStartSingle(user, game, data) {
        log(`onStartSingle`,` user ${user.userId}, game: ${game}, data: ${JSON.stringify(data)}`);
        let self = this, gameModes = this.games[game].modes, defaultMode = Object.keys(gameModes)[0];
        return co(function* (){
            if (!user || !user.userId || !data || !game) {
                return false;
            }

            // todo: check user in room

            if (!gameModes[data.mode]){
                err(`onStartSingle`, `wrong game mode: ${data.mode} `, 1);
                return false;
            }

            let userSocket = yield self.server.userManager.getUserSocket(game, user.userId);
            if (!userSocket)return false;
            yield self.createRoom(game, userSocket, user.userId, [user.userId], data, 'single');
            log(`onPlayRandom`, `start game!!`);

        });
    };

    removeWaitingUser (userId, game){
        log(`removeWaitingUser`,` user ${userId}, game: ${game}`);
        let self = this, gameModes = this.games[game].modes, defaultMode = Object.keys(gameModes)[0];
        return co(function* (){
            let waiting = yield self.memory.hashGetAll(`waiting:${game}`);
            log(`removeWaitingUser`,` waiting: ${JSON.stringify(waiting)}, game: ${game}`);
            if (!waiting) return false;
            for (let mode of Object.keys(gameModes)){
                if (waiting[mode] == userId) {
                    let sendData = {};
                    sendData[mode] = null;
                    yield self.memory.hashRemove(`waiting:${game}`, mode);
                    yield self.server.userManager.sendToSockets(game, JSON.stringify({
                        module : "invite_manager",
                        type: "random_cancel",
                        data: sendData
                    }));
                    return mode;
                }
            }
            return false;
        });
    };

    getWaitingUsers(game) {
        return this.memory.hashGetAll(`waiting:${game}`);
    };

    onUserLeave(user, game) {
        log(`onUserLeave`, `user: ${user.userId}, game: ${game}`);
        let self = this;
        return co(function* (){
            yield self.memory.del(`invites:${game}:${user.userId}`);
            yield self.removeWaitingUser(user.userId, game);
            let room = yield self.getUserRoom(user.userId, game);
            log(`onUserLeave`, `room: ${JSON.stringify(room)}`);
            // TODO send to GM;
            if (!room) return true;
            if (room) {
                // send game manager user leave
                return yield self.closeRoom(game, room.roomId)
            }
        });
    }

    createRoom(game, socketId, ownerId, players, inviteData, type) {
        log(`createRoom`, `invite: ${JSON.stringify(inviteData)}, game: ${game}`);
        let self = this, initData = self.games[game].initData;
        let room = Room.create(game, socketId, ownerId, players, initData, inviteData, type);
        return co(function* (){
            // check players in room
            for (let userId of players) {
                let room = yield self.getUserRoom(userId, game);
                if (!room) continue;

                //check room closed, or created wrong and not exists
                let roomData = yield self.memory.hashGet(`rooms:${game}`, room.roomId);
                if (!roomData){

                }
                if (room.role == 'player') {
                    wrn(`onInviteAccepted`, `user ${userId} already in room, ${room.roomId}`, 2);
                    return false;
                } else {
                    // leave spectator
                    wrn(`onInviteAccepted`, `user ${userId} spectate in room, ${room.roomId}`, 2);
                    //send game manager spectate leave
                    yield self.memory.del(`user_room:${game}:${userId}`)
                }
            }

            yield self.memory.hashAdd(`rooms:${game}`, room.id, room.getDataToSave());

            for (let userId of players){
                yield self.memory.hashSet(`user_room:${game}:${userId}`, room.getPlayerRoom('player'));
                yield self.memory.hashSet(`user_room:${game}:${userId}`, room.getPlayerRoom('player'));
            }

            yield self.server.userManager.sendToSockets(game, {
                module: 'server',
                type: 'new_game',
                data: room.getInfo()
            });

            return room;
        })
    }

    leaveRoom(userId, game) {
        let self = this;
        return co(function* () {
            let room = yield self.getUserRoom(userId, game);
            if (!room) return true;
            if (room.role == 'player') return false;
            else {
                yield gameManager.onNewMessage({
                    sender: user.userId,
                    game: game,
                    room: room.roomId,
                    type: 'leave'
                });
                // todo: remove user room
                return true;
            }
        })
    }

    getUserRoom(userId, game) {
        return this.memory.hashGetAll(`user_room:${game}:${userId}`)
    }

    closeRoom(game, roomId) {
        let self = this;
        log(`closeRoom`, `game: ${game}, roomId: ${roomId}`);
        return co(function* (){
            let roomData = yield self.memory.hashGet(`rooms:${game}`, roomId);
            yield self.memory.hashRemove(`rooms:${game}`, roomId);
            if (!roomData) {
                wrn(`closeRoom`, `no room!, game: ${game}, roomId: ${roomId}`, 1);
                return false;
            }
            let room = Room.load(roomData);

            for (let playerId of room.players){
                yield self.memory.del(`user_room:${game}:${playerId}`);
                yield self.memory.del(`user_room:${game}:${playerId}`);
            }

            yield self.server.userManager.sendToSockets(game, {
                module: 'server',
                type: 'end_game',
                data: { players: room.players, room: room.id }
            });
        })
    }
};


let defaultConf = {

};