'use strict';

//require
let Manager = require('./manager.js');
let User = require('../instances/user.js');
let co = require('co');
let oo = require('json8');

let moduleName = 'UserManager';
let logger, log, err, wrn;

module.exports = class UserManager extends Manager {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log; wrn = logger.wrn; err = logger.err;

        conf = Object.assign(defaultConf, conf);
        super(server, conf);

        this.games = this.server.conf.games;
        log(`!!`, `${ oo.serialize(this.games) }`);
        log(`!!`, `${ oo.serialize(this.games['test2']) }`);

        log(`constructor`, `userManager created, conf: ${JSON.stringify(conf)}`);
    }

    init() {
        let self = this;
        return co(function* (){
                    let test = yield self.test();
                    yield self.subscribe(`socket_send`, self.onSocketMessage.bind(self));
                    yield self.subscribe(`socket_disconnect`, (task) => {
                        if (task.socket){
                            return self.onSocketDisconnect(task.socket);
                        }
                        if (task.sockets){
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

            if (typeof message.type != "string" || typeof message.module != "string" || !message.data || !message.target) {
                wrn('onSocketMessage', `wrong income message: ${message} socket: ${socket}`, 1);
                return false;
            }

            socketData = yield self.getSocketData(socket.socketId);
            if (socketData) {
                user = {
                    userId: socketData['userId'],
                    userName: socketData['userName']
                };
                game = socketData['game'];
            }

            if (message.type == 'login'){
                if (socketData) {
                    wrn(`onSocketMessage`, `user ${user.userId}, ${user.userName} already auth with socket: ${socket} in game ${game}`);
                    //TODO relogin
                    return self.sendToSocket(socket, `{ "module": "server","type": "error","data": "already_login" }`);
                } else {
                    return self.onUserLogin(socket, message.data)
                }
            } else {
                if(!socketData){
                    wrn(`onSocketMessage`, `socket ${socket} message ${message} without auth`);
                    return self.sendToSocket(socket, `{ "module": "server","type": "error","data": "not_login" }`);
                } else {
                    user = yield self.getUser(game, user.userId);
                    message.sender = user.getDataToSend();
                    message.game = game;
                    switch (message.module){
                        case 'server':
                            return self.onMessage(user, game, message.data, message.type);
                        case 'chat_manager':
                            return self.server.chatManager.onMessage(message);
                            break;
                        case 'invite_manager':
                            return self.server.inviteManager.onNewMessage(message);
                            break;
                        case 'game_manager':
                            return self.server.gameManager.onNewMessage(message);
                            break;
                        default:
                            return self.publish(`user_send_${message.module}`, {
                                socket: socket,
                                user: user,
                                game: game,
                                message: task.message
                            })
                    }
                }
            }
        })
    }

    onSocketDisconnect(socket){
        let self = this;
        log(`onSocketDisconnect`, `socket: ${socket.socketId}, serverId: ${socket.serverId}`);
        return co(function* (){
            let socketData = yield self.getSocketData(socket.socketId);
            if (!socketData) {
                log(`onSocketDisconnect`, `no user for socket ${socket.socketId}`);
                return true;
            }
            let currentSocket = yield self.getUserSocket(socketData.game, socketData.userId);
            yield self.removeSocketData(socket.socketId);

            try {
                // check if user reconnect while processed disconnect
                let currentUserSocketId = currentSocket.socketId;
                if (currentUserSocketId != socket.socketId){
                    wrn(`onSocketDisconnect`, `user: ${socketData.userId}, ${socketData.userName}, ${socketData.game} `
                        + `connected with other socket: ${currentUserSocketId}`);
                    return true;
                }
            } catch (error) {
                err(`onSocketDisconnect`, `error with user socket: ${error.stack || error}`)
            }
            // remove from userlist
            yield self.removeUser(socketData.game, socketData.userId);
            // leave game room
            yield self.server.inviteManager.onNewMessage({user: socketData, game: socketData.game, type: 'user_leave'});
            yield self.removeUserSocket(socketData.game, socketData.userId);
            yield self.sendToSockets(socketData.game, `{"module":"server", "type": "user_leave", "data": "${socketData.userId}"}`);
        })
    }

    onMessage(user, game, message, type) {
        log(`onMessage`, `user: ${user}, game: ${game} message: ${oo.serialize(message)}, type: ${type}`);
        switch (type) {
            case 'settings': // player ready to play
                return this.onUserChanged(user, game, message);
                //this.storage.saveUserSettings(message.sender, message.data);
                break;
            case 'changed':
                return this.onUserChanged(user, game, message);
                break;
        }
    }

    onUserLogin(socket, loginData){
        log(`onUserLogin`, `socketId: ${socket.socketId}, userId: ${loginData.userId}, game: ${loginData.game}, sign: ${loginData.sign}`);
        if (!socket.socketId || !socket.serverId){ throw Error(`wrong socket ${socket}`) }

        if (!this.checkLoginData(loginData)){
            return Promise.resolve(false);
        }

        if(!this.games[loginData.game]){
            err(`onUserLogin`, `wrong game to login, ${loginData.game}`);
            return Promise.resolve(false);
        }

        let self = this, userId = loginData.userId, userName = loginData.userName, game = loginData.game;
        return co(function* (){
            let oldSocket = yield self.getUserSocket(game, userId);
            if (oldSocket) {
                // TODO: close old or current socket
                err(`onUserLogin`, `old socket ${oldSocket}, for :${game}:${userId}`);
                return false
            } else {
                yield self.setSocketData(socket.socketId, socket.serverId, loginData.userId, loginData.userName, loginData.game);
                let userData = yield self.loadUserData(loginData.userId, loginData.userName, loginData.game);
                let user = new User(userData, game, self.games[game].modes);
                let userlist = yield self.getUserList(game);
                yield self.addUser(game, user);
                // enter room
                yield self.setUserSocket(game, userId, socket.socketId, socket.serverId);
                yield self.sendUserLoginData(socket, game, user.getDataToSend(), userlist);
                yield self.sendToSockets(game, `{ "module":"server", "type": "user_login", "data": ${user.getDataToSend(true)} }`);

                log(`onUserLogin`, `userData: ${oo.serialize(userData)}`);
            }
        })
    }

    onUserChanged(user, game, data){
        data = data || {};
        log(`onUserChanged`, `user  ${user.userId}, ${game}, changed, ${oo.serialize(data)}`, 1);
        let self = this, userId = user.userId;
        return co(function* (){
            // update user data active
            if (typeof data.isActive == "boolean")
                yield self.memory.hashAdd(`user_data:${game}:${userId}`, 'isActive', data.isActive.toString());
            if (typeof data.disableInvite == "boolean")
                yield self.memory.hashAdd(`user_data:${game}:${userId}`, 'disableInvite', data.disableInvite.toString());
            user = yield self.getUser(game, userId);
            if (!user) {
                wrn(`onUserChanged`, `user ${userId}, not exists`);
                return false;
            }
            yield self.sendUserInfo(game, user);
        });
    };

    sendUserLoginData(socket, game, userData, userlist){
        let self = this;
        return co(function* (){
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
                    "opts": {"modes": ["default"], "game": game},
                    "ban": null
                }
            });
            return self.sendToSocket(socket, message)
        })
    };

    sendUserInfo(game, user) {
        return this.sendToSockets(game, {
            module: "server",
            type: "user_changed",
            data: user.getDataToSend()
        });
    };

    sendToSockets(game, message) {
        let self = this;
        return co(function* (){
            if (typeof message != "string") message = JSON.stringify(message);
            let sockets = yield self.getGameSockets(game);
            log(`sendToSockets`, `game: ${game}, ${oo.serialize(sockets)}`);
            for (let socket in sockets){
                if (sockets.hasOwnProperty(socket)){
                    yield self.sendToSocket(JSON.parse(sockets[socket]), message)
                }
            }
            return true;
        })
    }

    sendToSocket(socket,  message) {
        //TODO: check socket server and id;
        log(`sendToSocket`, `socket:  ${oo.serialize(socket)}, ${socket.serverId}`, 3);
        return this.publish(`send_to_socket_${socket.serverId}`, {
            socket: socket,
            //message: `{ "module": "server","type": "error","data": "${error}" }`
            message: message
        })
    }

    sendToUser(game, userId, message) {
        log(`sendToUser`, `userId:  ${userId}, game: ${game}`, 3);
        return this.getUserSocket(game, userId)
            .then((socketData)=>{
                if (socketData){
                    if (typeof message != "string") message = JSON.stringify(message);
                    return this.publish(`send_to_socket_${socketData.serverId}`, {
                        socket: socketData,
                        message: message
                    })
                }
            })
    }


    checkLoginData(loginData) {
        if (!loginData.userId || !loginData.userName || !loginData.sign || !loginData.game) {
            wrn(`checkLoginData`, `wrong loginData: ${loginData.userId}, ${loginData.userName}, ${loginData.sign}, ${loginData.game}`);
            return false;
        } else return this.conf.checkAuth(loginData.userId, loginData.userName, loginData.game, loginData.sign);
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
                for (let mode of Object.keys(modes)){
                    if (!loadedUserData[mode]) {
                        // no saved user data in mode
                        userData[mode] = modes[mode]
                    } else {
                        userData[mode] = {};
                        for (let prop of Object.keys(modes[mode])) {
                            userData[mode][prop] = loadedUserData[mode][prop] || modes[mode][prop];
                        }
                    }
                }
                return userData;
            })
    }

    getUserList(game) {
        let self = this;
        return co(function* (){
            let users = yield self.memory.hashGetAll(`user_sockets:${game}`);
            let userlist = [];
            log(`getUserList`, `!! users: ${oo.serialize(users)}`);
            for (let userId in users){
                if (users.hasOwnProperty(userId)){
                    let user = yield self.getUser(game, userId);
                    userlist.push(user.getDataToSend());
                }
            }
            return userlist
        });
    }

    addUser(game, user) {
        return this.memory.hashSet(`user_data:${game}:${user.userId}`, user.getDataToSave());
    }

    getUser(game, userId) {
        let self = this;
        return self.memory.hashGetAll(`user_data:${game}:${userId}`).then((userData) => {
            let user = new User(userData, game, self.games[game].modes);
            return user;
        })
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
        })
    }

    getSocketData(socketId) {
        return this.memory.hashGetAll(`sockets:${socketId}`);
    }

    removeSocketData(socketId) {
        return this.memory.del(`sockets:${socketId}`);
    }

    setUserSocket(game, userId, socketId, serverId) {
        return this.memory.hashAdd(`user_sockets:${game}`, userId,
            `{"socketId": "${socketId}", "serverId": "${serverId}"}`);
    }

    getUserSocket(game, userId) {
        return this.memory.hashGet(`user_sockets:${game}`, userId).then((socket) => {
            if (socket) socket = JSON.parse(socket);
            return socket;
        })
    }

    getGameSockets(game) {
        return this.memory.hashGetAll(`user_sockets:${game}`);
    }

    removeUserSocket(game, userId) {
        return this.memory.hashRemove(`user_sockets:${game}`, userId);
    }
};


function wait(ms) {
    return new Promise((res) => {
        setTimeout(()=> {
            res()
        }, ms)
    })
}


let defaultConf = {
    checkAuth: function(userId, userName, game, sign) {
        return (userId && userName && sign);
    }
};