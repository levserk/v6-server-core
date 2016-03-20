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

        this.games = this.server.conf.games;

        log(`constructor`, `userManager created, conf: ${JSON.stringify(conf)}`);
    }

    init() {
        let self = this;
        return co(function* () {
            let test = yield self.test();
            yield self.subscribe(`socket_send`, self.onSocketMessage.bind(self));
            yield self.subscribe(`socket_disconnect`, (task) => {
                if (task.socket) {
                    return self.onSocketDisconnect(task.socket);
                }
                if (task.sockets) {
                    let promises = [];
                    for (let socketId of task.sockets) {
                        promises.push(self.onSocketDisconnect({
                            socketId: socketId,
                            serverId: task.serverId
                        }));
                    }
                    return Promise.all(promises);
                }
                return Promise.reject(`wrong task: ${oo.serialize(task)}`);
            });
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

    onSocketMessage(task) {
        let self = this;
        log(`onSocketMessage`, `message: ${task.message}`);
        return co(function* () {
            let socket = task.socket,
                message = JSON.parse(task.message),
                socketData = null, user = null, game = null;

            if (typeof message.type !== "string" || typeof message.module !== "string" || !message.data || !message.target) {
                wrn('onSocketMessage', `wrong income message: ${message} socket: ${socket}`, 1);
                return false;
            }

            // get userId for this socket
            socketData = yield self.getSocketData(socket.socketId);
            if (socketData) {
                user = {
                    userId: socketData['userId'],
                    userName: socketData['userName']
                };
                game = socketData['game'];
            }

            if (message.type === 'login') {
                if (user) {
                    wrn(`onSocketMessage`, `user ${user.userId}, ${user.userName} already auth in game ${game}`);
                    return false;
                }
                game = message.data.game;
                socket.userId = message.data.userId;
                if (!game || !socket.userId){
                    wrn(`onSocketMessage`, ` can not login user ${socket.socketId}, message: ${JSON.stringify(message.data)}`);
                    return false;
                }
                message.game = game;
                message.user = socket;
                message.sender = SENDER_USER;
            } else {
                if (user && user.userId && game) {
                    message.game = game;
                    message.user = user;
                    message.sender = SENDER_USER;
                } else {
                    wrn(`onSocketMessage`, `user ${JSON.stringify(socket)} message ${message.type} without auth, game: ${game}, userId: ${user.userId}`);
                    return false;
                }
            }

            switch (message.module) {
                case 'server':
                    return self.onNewMessage(message);
                case 'chat_manager':
                    return self.server.chatManager.onNewMessage(message);
                case 'invite_manager':
                    return self.server.inviteManager.onNewMessage(message);
                case 'game_manager':
                    return self.server.gameManager.onNewMessage(message);
                //default:
                //    return self.publish(`user_send_${message.module}`, {
                //        socket: socket,
                //        user: user,
                //        game: game,
                //        message: task.message
                //    });
            }
        });
    }

    onSocketDisconnect(socket) {
        let self = this;
        log(`onSocketDisconnect`, `socket: ${socket.socketId}, serverId: ${socket.serverId}`);
        return co(function* () {
            let socketData = yield self.getSocketData(socket.socketId);
            if (!socketData) {
                log(`onSocketDisconnect`, `no user for socket ${socket.socketId}`);
                return true;
            }

            yield self.removeSocketData(socket.socketId);

            yield self.onNewMessage({
                game: socketData.game,
                user: {
                    userId: socketData.userId,
                    userName: socketData.userName
                },
                sender: SENDER_SERVER,
                type: 'disconnect',
                data: socket
            });

            return true;
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
                user = yield self.getUser(game, message.user.userId);
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
            let user = yield self.getUser(game, userId);
            if (user) {
                return self.onUserRelogin(socket, user, loginData);
            } else {
                yield self.setSocketData(socket.socketId, socket.serverId, loginData.userId, loginData.userName, loginData.game);
                let userData = yield self.loadUserData(loginData.userId, loginData.userName, loginData.game);
                user = new User(userData, game, self.games[game].modes);
                let userlist = yield self.getUserList(game);
                yield self.addUser(game, user);
                // enter room
                yield self.setUserSocket(game, userId, socket.socketId, socket.serverId);
                yield self.sendUserLoginData(socket, game, user.getDataToSend(), userlist);
                yield self.sendToSockets(game, `{ "module":"server", "type": "user_login", "data": ${user.getDataToSend(true)} }`);

                log(`onUserLogin`, `userData: ${oo.serialize(userData)}`);
            }
        });
    }

    onUserRelogin(socket, user, loginData) {
        let self = this, userId = loginData.userId, userName = loginData.userName, game = loginData.game;
        log(`onUserRelogin`, `userId: ${userId} `);
        return co(function* () {
            // update user data
            let oldSocket = yield self.getUserSocket(game, userId);
            log(`onUserRelogin`, `oldSocket: ${JSON.stringify(oldSocket)}`);
            if (oldSocket) {
                yield self.removeSocketData(oldSocket.socketId);
                // close old socket
                yield self.sendToSocket(oldSocket, {
                    module: 'server',
                    type: 'error',
                    data: 'new_connection'
                });
                // TODO: close old socket from oldSocket.server;
            }
            yield self.setSocketData(socket.socketId, socket.serverId, user.userId, user.userName, user.game);
            yield self.setUserSocket(game, userId, socket.socketId, socket.serverId);

            let userlist = yield self.getUserList(game);
            yield self.sendUserLoginData(socket, game, user.getDataToSend(), userlist);
            yield self.server.gameManager.onNewMessage({
                game: game,
                type: 'relogin',
                user: user.getDataToSend(),
                sender: SENDER_SERVER
            });
        });
    }

    onUserDisconnect(user, game, socket) {
        let self = this;
        log(`onUserDisconnect`, `game: ${game}, user: ${user.userId}, socketId: ${socket.socketId}`);
        return co(function* () {
            // get user socket and check
            yield self.removeUserSocket(game, user.userId);

            let userRoom = yield self.server.getUserRoom(game, user.userId);
            let inGame = false;
            if (userRoom) {
                yield self.server.gameManager.onNewMessage({
                    user: user,
                    sender: SENDER_SERVER,
                    game: user.game,
                    userRoom: userRoom,
                    type: 'disconnect' //disconnect
                });
            } else {
                // remove from userlist
                yield self.removeUser(game, user.userId);
                // leave game room
                yield self.sendToSockets(game, `{"module":"server", "type": "user_leave", "data": "${user.userId}"}`);
            }
        });
    }

    onUserLeaveGame(user, game) {
        let self = this, userId = user.userId;
        log(`onUserLeaveGame`, `game: ${game}, userId: ${userId}`);

        return co(function* () {
            let socketData = yield self.getUserSocket(game, userId);

            if (socketData) {
                return false;
            }

            // remove from userlist
            yield self.removeUser(game, user.userId);
            // leave game room
            yield self.sendToSockets(game, `{"module":"server", "type": "user_leave", "data": "${user.userId}"}`);
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
            user = yield self.getUser(game, userId);
            if (!user) {
                wrn(`onUserChanged`, `user ${userId}, not exists`);
                return false;
            }
            yield self.sendUserInfo(game, user);
        });
    }

    sendUserLoginData(socket, game, userData, userlist) {
        let self = this;
        return co(function* () {
            log(`sendUserLoginData`, `userlist: ${userlist}`);
            let waiting = yield self.server.inviteManager.getWaitingUsers(game) || {};
            let message = JSON.stringify({
                "module": "server",
                "type": "login",
                "data": {
                    "you": userData,
                    "userlist": userlist,
                    "rooms": [],
                    "waiting": waiting,
                    "settings": {},
                    "opts": { "modes": ["default"], "game": game },
                    "ban": null
                }
            });
            return self.sendToSocket(socket, message);
        });
    }

    sendUserInfo(game, user) {
        return this.sendToSockets(game, {
            module: "server",
            type: "user_changed",
            data: user.getDataToSend()
        });
    }

    sendToSockets(game, message) {
        let self = this;
        return co(function* () {
            if (typeof message !== "string") {
                message = JSON.stringify(message);
            }
            let sockets = yield self.getGameSockets(game);
            log(`sendToSockets`, `game: ${game}, ${oo.serialize(sockets)}`);
            for (let socket in sockets) {
                if (sockets.hasOwnProperty(socket)) {
                    yield self.sendToSocket(JSON.parse(sockets[socket]), message);
                }
            }
            return true;
        });
    }

    sendToSocket(socket, message) {
        //TODO: check socket server and id;
        log(`sendToSocket`, `socket:  ${oo.serialize(socket)}, ${socket.serverId}`, 3);
        return this.publish(`send_to_socket_${socket.serverId}`, {
            socket: socket,
            //message: `{ "module": "server","type": "error","data": "${error}" }`
            message: message
        });
    }

    sendToUser(game, userId, message) {
        log(`sendToUser`, `userId:  ${userId}, game: ${game}`, 3);
        return this.getUserSocket(game, userId)
            .then((socketData)=> {
                if (socketData) {
                    if (typeof message !== "string") {
                        message = JSON.stringify(message);
                    }
                    return this.publish(`send_to_socket_${socketData.serverId}`, {
                        socket: socketData,
                        message: message
                    });
                }
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
        return this.storage.loadUserData(userId, game)
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

    getUserList(game) {
        let self = this;
        return co(function* () {
            let users = yield self.memory.hashGetAll(`user_sockets:${game}`);
            let userlist = [];
            log(`getUserList`, `!! users: ${oo.serialize(users)}`);
            for (let userId in users) {
                if (users.hasOwnProperty(userId)) {
                    let user = yield self.getUser(game, userId);
                    userlist.push(user.getDataToSend());
                }
            }
            return userlist;
        });
    }

    addUser(game, user) {
        return this.memory.hashSet(`user_data:${game}:${user.userId}`, user.getDataToSave());
    }

    updateUserRating(game, mode, user) {
        let ratingData = JSON.stringify(user.getMode(mode));
        return this.memory.hashAdd(`user_data:${game}:${user.userId}`, mode, ratingData);
    }

    getUser(game, userId) {
        let self = this;
        return self.memory.hashGetAll(`user_data:${game}:${userId}`).then((userData) => {
            if (!userData) {
                return false;
            }
            return new User(userData, game, self.games[game].modes);
        });
    }

    removeUser(game, userId) {
        return this.memory.del(`user_data:${game}:${userId}`);
    }

    setSocketData(socketId, serverId, userId, userName, game) {
        return this.memory.hashSet(`sockets:${socketId}`, {
            "serverId": serverId,
            "userId": userId,
            "userName": userName,
            "game": game
        });
    }

    getSocketData(socketId) {
        return this.memory.hashGetAll(`sockets:${socketId}`);
    }

    removeSocketData(socketId) {
        return this.memory.del(`sockets:${socketId}`);
    }

    setUserSocket(game, userId, socketId, serverId) {
        log(`setUserSocket`, `game: ${game}, userId: ${userId}`);
        return this.memory.hashAdd(`user_sockets:${game}`, userId,
            `{"socketId": "${socketId}", "serverId": "${serverId}"}`);
    }

    getUserSocket(game, userId) {
        return this.memory.hashGet(`user_sockets:${game}`, userId).then((socket) => {
            if (socket) {
                socket = JSON.parse(socket);
            }
            return socket;
        });
    }

    getGameSockets(game) {
        return this.memory.hashGetAll(`user_sockets:${game}`);
    }

    removeUserSocket(game, userId) {
        log(`removeUserSocket`, `game: ${game}, userId: ${userId}`);
        return this.memory.hashRemove(`user_sockets:${game}`, userId);
    }
};

function wait(ms) {
    return new Promise((res) => {
        setTimeout(()=> {
            res();
        }, ms);
    });
}