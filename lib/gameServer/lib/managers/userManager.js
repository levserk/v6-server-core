'use strict';

//require
let Manager = require('../../../lib/manager.js');
let User = require('../instances/user.js');
let co = require('co');
let oo = require('json8');

let moduleName = 'UserManager';
let logger, log, err, wrn;

const SENDER_USER = 'user';
const SENDER_SERVER = 'server';

let defaultConf = {
    checkAuth: function (userId, userName, game, sign) {
        return (userId && userName && sign);
    }
};

module.exports = class UserManager extends Manager {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        conf = Object.assign(defaultConf, conf);
        super(server, conf);

        this.dispatcher = server.dispatcher;
        this.games = this.server.conf.games;

        log(`constructor`, `userManager created, conf: ${JSON.stringify(conf)}`);
    }

    init() {
        let self = this;
        return co(function* () {
            let test = yield self.test();
            self.dispatcher.on(`game.user_message.user_manager`, self.onNewMessage.bind(self));
            self.dispatcher.on(`system.socket_disconnect`, self.onNewMessage.bind(self));
            return true;
        })
            .then(() => {
                self.isRunning = true;
                log(`init`, `init success`);

                return true;
            })
            .catch((e) => {
                this.isRunning = false;
                err(`init, error: ${e.stack}`);
                throw Error(`init failed`);
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
        let self = this, game = message.game, userId = message.user.userId;
        return co(function* () {
            message = JSON.stringify(message);
            log(`addToList`, `obj: ${message}`);
            yield self.memory.listAdd(`user_messages_list:${game}:${userId}`, message);
            return self.getCurrentMessage(game, userId);
        });
    }

    getCurrentMessage(game, userId) {
        return this.memory.listGet(`user_messages_list:${game}:${userId}`, `user_messages_current:${game}:${userId}`)
            .then((message) => {
            if (message) {
                message = JSON.parse(message);
            }
            return message;
        });
    }

    onMessage(message) {
        let self = this, game = message.game, userId = message.user.userId, data = message.data;
        log(`onMessage`, `game: ${JSON.stringify(message)}`);
        return co(function* () {
            let user;
            if (message.type !== 'login') {
                user = yield self.memory.getUser(game, message.user.userId);
                if (!user) {
                    yield self.memory.del(`user_messages_current:${game}:${userId}`);
                    yield self.memory.del(`user_messages_list:${game}:${userId}`);
                    wrn(`onMessage`, ` no user data, userId: ${message.user.userId}, game: ${message.game}`);
                    return false;
                }
            }

            switch (message.type) {
                case 'login':
                    yield self.onUserLogin(message.user, data);
                    break;
                case 'settings': // player ready to play
                    yield self.onUserChanged(user, game, data);
                    //this.storage.saveUserSettings(message.sender, message.data);
                    break;
                case 'changed':
                    yield self.onUserChanged(user, game, data);
                    break;
                case 'disconnect':
                    yield self.onUserDisconnect(user, game, data);
                    break;
                case 'leave':
                    yield self.onUserLeaveGame(user, game, data);
            }

            // get next user message
            yield self.memory.del(`user_messages_current:${game}:${userId}`);
            message = yield self.getCurrentMessage(game, userId);
            if (!message) {
                return true;
            }
            else {
                return self.onMessage(message);
            }
        });
    }

    onUserLogin(socket, loginData) {
        let self = this, userId = loginData.userId, userName = loginData.userName, game = loginData.game;

        log(`onUserLogin`, `new login, socketId: ${socket.socketId}, userId: ${userId}, game: ${game}, sign: ${loginData.sign}`);
        if (!socket.socketId || !socket.serverId || !loginData.userId || loginData.userId === "undefined") {
            err(`onUserLogin`, `wrong socket ${socket}`);
            return Promise.resolve(false);
        }

        if (!this.checkLoginData(loginData)) {
            return Promise.resolve(false);
        }

        if (!this.games[loginData.game]) {
            err(`onUserLogin`, `wrong game to login, ${loginData.game}`);
            return Promise.resolve(false);
        }
        return co(function* () {
            let user = yield self.memory.getUser(game, userId);
            if (user) {
                return self.onUserRelogin(socket, user, loginData);
            } else {
                yield self.memory.setSocketData(socket.socketId, socket.serverId, loginData.userId, loginData.userName, loginData.game);
                let userData = yield self.loadUserData(loginData.userId, loginData.userName, loginData.game);
                user = new User(userData, game, self.games[game].modes);
                yield self.memory.addUser(game, user);
                // enter room
                yield self.memory.setUserSocket(game, userId, socket.socketId, socket.serverId);

                yield self.sendUserLoginData(socket, game, user);

                yield self.dispatcher.emit(`system.send_to_sockets`, game, `{ "module":"server", "type": "user_login", "data": ${user.getDataToSend(true)} }`);

                log(`onUserLogin`, `userData: ${oo.serialize(userData)}`);
            }
        });
    }

    onUserRelogin(socket, user, loginData) {
        let self = this, userId = loginData.userId, userName = loginData.userName, game = loginData.game;
        log(`onUserRelogin`, `userId: ${userId} `);
        return co(function* () {
            // update user data
            let oldSocket = yield self.memory.getUserSocket(game, userId);
            log(`onUserRelogin`, `oldSocket: ${JSON.stringify(oldSocket)}`);
            if (oldSocket) {
                yield self.memory.removeSocketData(oldSocket.socketId);
                // close old socket
                yield self.dispatcher.emit(`system.send_to_socket`,oldSocket, {
                    module: 'server',
                    type: 'error',
                    data: 'new_connection'
                });
                // TODO: close old socket from oldSocket.server;
            }
            yield self.memory.setSocketData(socket.socketId, socket.serverId, user.userId, user.userName, user.game);
            yield self.memory.setUserSocket(game, userId, socket.socketId, socket.serverId);

            yield self.sendUserLoginData(socket, game, user);

            yield self.dispatcher.emit(`system.user_relogin`, game, user.getDataToSend());
        });
    }

    onUserDisconnect(user, game, socket) {
        let self = this;
        log(`onUserDisconnect`, `game: ${game}, user: ${user.userId}, socketId: ${socket.socketId}`);
        return co(function* () {
            // get user socket and check
            yield self.memory.removeUserSocket(game, user.userId);

            let userRoom = yield self.memory.getUserRoom(game, user.userId);
            let inGame = false;
            if (userRoom) {
                yield self.dispatcher.emit(`system.user_disconnect`, user, userRoom);
            } else {
                // remove from userlist
                yield self.memory.removeUser(game, user.userId);
                // leave game room
                yield self.dispatcher.emit(`system.send_to_sockets`, game, `{"module":"server", "type": "user_leave", "data": "${user.userId}"}`);
            }
        });
    }

    onUserLeaveGame(user, game) {
        let self = this, userId = user.userId;
        log(`onUserLeaveGame`, `game: ${game}, userId: ${userId}`);

        return co(function* () {
            let socketData = yield self.memory.getUserSocket(game, userId);

            if (socketData) {
                return false;
            }

            // remove from userlist
            yield self.memory.removeUser(game, user.userId);
            // leave game room
            yield self.dispatcher.emit(`system.send_to_sockets`, game, `{"module":"server", "type": "user_leave", "data": "${user.userId}"}`);
        });
    }

    onUserChanged(user, game, data) {
        data = data || {};
        log(`onUserChanged`, `user  ${user.userId}, ${game}, changed, ${oo.serialize(data)}`, 1);
        let self = this, userId = user.userId;
        return co(function* () {
            // update user data active
            if (typeof data.isActive === "boolean") {
                yield self.memory.hashAdd(`user_data:${game}:${userId}`, 'isActive', data.isActive.toString());
            }
            if (typeof data.disableInvite === "boolean") {
                yield self.memory.hashAdd(`user_data:${game}:${userId}`, 'disableInvite', data.disableInvite.toString());
            }
            user = yield self.memory.getUser(game, userId);
            if (!user) {
                wrn(`onUserChanged`, `user ${userId}, not exists`);
                return false;
            }
            yield self.sendUserInfo(game, user);
        });
    }

    sendUserLoginData(socket, game, user) {
        let self = this;
        return co(function* () {
            let userlist = yield self.memory.getUserList(game),
                waiting = yield self.memory.getWaitingUsers(game),
                rooms = yield self.memory.getRooms(game),
                userData = user.getDataToSend();

            let message = JSON.stringify({
                "module": "server",
                "type": "login",
                "data": {
                    "you": userData,
                    "userlist": userlist,
                    "rooms": rooms,
                    "waiting": waiting,
                    "settings": {},
                    "opts": { "modes": ["default"], "game": game },
                    "ban": null
                }
            });
            yield self.dispatcher.emit(`system.send_to_socket`, socket, message);
        });
    }

    sendUserInfo(game, user) {
        return this.dispatcher.emit(`system.send_to_sockets`, game, {
            module: "server",
            type: "user_changed",
            data: user.getDataToSend()
        });
    }

    checkLoginData(loginData) {
        if (!loginData.userId || !loginData.userName || !loginData.sign || !loginData.game) {
            wrn(`checkLoginData`, `wrong loginData: ${loginData.userId}, ${loginData.userName}, ${loginData.sign}, ${loginData.game}`);
            return false;
        } else {
            return this.conf.checkAuth(loginData.userId, loginData.userName, loginData.game, loginData.sign);
        }
    }

    loadUserData(userId, userName, game) {
        let defaultData = this.games[game];
        return this.dispatcher.trigger(`system.load_user_data`, userId, game)
        //this.storage.loadUserData(userId, game)
            .then((loadedUserData) => {
                loadedUserData = loadedUserData || {};
                let userData = {
                    userId: userId, userName: userName
                };
                userData.dateCreate = loadedUserData.dateCreate || Date.now();
                userData.isActive = true;
                userData.disableInvite = false;
                let modes = defaultData.modes;
                for (let mode of Object.keys(modes)) {
                    if (!loadedUserData[mode]) {
                        // no saved user data in mode
                        userData[mode] = modes[mode];
                    } else {
                        userData[mode] = {};
                        for (let prop of Object.keys(modes[mode])) {
                            userData[mode][prop] = loadedUserData[mode][prop] || modes[mode][prop];
                        }
                    }
                }
                return userData;
            });
    }
};