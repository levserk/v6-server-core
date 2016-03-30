'use strict';

let moduleName = 'Transport';
let logger, log, err, wrn;
let co = require('co');

const SENDER_USER = 'user';
const SENDER_SERVER = 'server';

module.exports = class Transport {

    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        this.server = server;
        this.taskQueue = server.taskQueue;
        this.memory = server.memory;
        this.dispatcher = server.dispatcher;
        this.conf = conf;
        this.subscribes = new Map();
        this.isRunning = false;
        this.pendingTasks = 0;
        this.errors = 0;

        log('constructor', 'Transport created ', 3);
    }

    *init() {
        yield this.test()
            .then(() => {
                this.isRunning = true;
                log(`init`, `init success`, 3);
                return true;
            })
            .catch((e) => {
                this.isRunning = false;
                err(`init, test error: ${e.stack}`);
                throw Error(`test failed`);
            });

        yield this.subscribe(`socket_send`, this.onSocketMessage.bind(this));
        yield this.subscribe(`socket_disconnect`, (task) => {
            if (task.socket) {
                return this.onSocketDisconnect(task.socket);
            }
            if (task.sockets) {
                let promises = [];
                for (let socketId of task.sockets) {
                    promises.push(this.onSocketDisconnect({
                        socketId: socketId,
                        serverId: task.serverId
                    }));
                }
                return Promise.all(promises);
            }
            return Promise.reject(`wrong task: ${JSON.stringify(task)}`);
        });

        this.dispatcher.on(`system.send_to_socket`, (socket, message) => {
            return this.sendToSocket(socket, message);
        });

        this.dispatcher.on(`system.send_to_sockets`, (game, message) => {
            return this.sendToSockets(game, message);
        });

        this.dispatcher.on(`system.send_to_user`, (game, userId, message) => {
            return this.sendToUser(game, userId, message);
        });

        this.dispatcher.on(`system.send_in_room`, (room, message) => {
            return this.sendInRoom(room, message);
        });

        this.dispatcher.on(`system.load_user_data`, (/*game, userId*/) => {
            return null;
        });
    }

    onSocketMessage(task) {
        let self = this;
        log(`onSocketMessage`, `message: ${task.message}`);
        return co(function* () {
            let socket = task.socket,
                message = JSON.parse(task.message),
                socketData,
                user = null,
                game = null;

            if (typeof message.type !== "string" || typeof message.module !== "string" || !message.data || !message.target) {
                wrn('onSocketMessage', `wrong income message: ${message} socket: ${socket}`, 1);
                return false;
            }

            // get userId for this socket
            socketData = yield self.memory.getSocketData(socket.socketId);
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

            // fix old message module
            if (message.module === 'server') {
                message.module = 'user_manager';
            }

            let eventType = `game.user_message.${message.module}`;

            yield self.dispatcher.emit(eventType, message);
        });
    }

    onSocketDisconnect(socket) {
        let self = this;
        log(`onSocketDisconnect`, `socket: ${socket.socketId}, serverId: ${socket.serverId}`);
        return co(function* () {
            let socketData = yield self.memory.getSocketData(socket.socketId);
            if (!socketData) {
                log(`onSocketDisconnect`, `no user for socket ${socket.socketId}`);
                return true;
            }

            yield self.memory.removeSocketData(socket.socketId);

            let eventType = `system.socket_disconnect`;

            yield self.dispatcher.emit(eventType, {
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

    sendToSockets(game, message) {
        let self = this;
        return co(function* () {
            if (typeof message !== "string") {
                message = JSON.stringify(message);
            }
            let sockets = yield self.memory.getGameSockets(game);
            log(`sendToSockets`, `game: ${game}, ${JSON.stringify(sockets)}`);
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
        log(`sendToSocket`, `socket:  ${JSON.stringify(socket)}, ${socket.serverId}`, 3);
        return this.publish(`send_to_socket_${socket.serverId}`, {
            socket: socket,
            //message: `{ "module": "server","type": "error","data": "${error}" }`
            message: message
        });
    }

    sendToUser(game, userId, message) {
        log(`sendToUser`, `userId:  ${userId}, game: ${game}`, 3);
        return this.memory.getUserSocket(game, userId)
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

    sendInRoom(room, message) {
        let self = this, game = room.game;
        message = JSON.stringify(message);
        log(`sendInRoom`, `${game}, ${room.id}, message: ${message}`);
        return co(function*() {
            for (let userId of room.players) {
                yield self.sendToUser(game, userId, message);
            }
            for (let userId of room.spectators) {
                yield self.sendToUser(game, userId, message);
            }
            return true;
        });
    }


    /**
     * test module
     * @returns {Promise}
     */
    test() {
        log(`test`, `start test`, 4);
        return new Promise((res, rej) => {
            if (this.server && this.taskQueue && this.taskQueue.isRunning) {
                res(true);
            } else {
                err(`test`, `check server and taskQueue`);
                rej(true);
            }
        });
    }


    /**
     * subscribe function for Tasks
     * @param pattern {String}
     * @param func {Function}
     * @returns {Promise}
     */
    subscribe(pattern, func) {
        let self = this;
        return self.taskQueue.subscribe(pattern, self)
            .then(res => {
                // success subscribe
                self.subscribes.set(pattern, func);
                log(`subscribe`, `pattern: ${res}, subscribes count: ${self.subscribes.size}`, 3);
                return self.taskQueue.checkTasks(pattern);
            })
            .catch(e => {
                // error
                err(`subscribe`, `error: ${e}, stack: ${e.stack}`);
                throw e;
            });
    }

    /**
     * unsubscribe from tasks
     * @param pattern {String}
     * @returns {Promise}
     */
    unsubscribe(pattern) {
        let self = this;
        self.subscribes.delete(pattern);
        return this.taskQueue.unsubscribe(pattern)
            .then(res => {
                // success unsubscribe
                log(`unsubscribe`, `pattern: ${res}, subscribes count: ${self.subscribes.size}`, 3);
                return res;
            })
            .catch(e => {
                // error
                err(`unsubscribe`, `error: ${e}, stack: ${e.stack}`);
                throw e;
            });
    }

    /**
     * publish new task for managers
     * @param key {String}
     * @param data {*}
     * @returns {*|Promise}
     */
    publish(key, data) {
        let self = this;
        return self.taskQueue.publish(key, data);
        //TODO: add handler for publishing
    }

    /**
     * handler for new Tasks
     * @param pattern {String}
     * @param task {Task}
     */
    onTask(pattern, task) {
        // inc count running tasks, run task function and wait;
        let self = this, func = self.subscribes.get(pattern);
        if (!func) {
            wrn(`onTask`, `subscriber does't exists for pattern ${pattern}`, 1);
            return Promise.resolve(false);
        }
        this.pendingTasks++;
        log(`onTask`, `new task: ${task}, pattern ${pattern}, tasks in progress: ${this.pendingTasks}`, 1);
        // do task and then do something next
        let resultPromise = func(task.data);
        if (!(resultPromise instanceof Promise)) {
            throw Error(`handler should return a Promise! handler name: ${func.name}`);
        }
        return resultPromise
            .then(res => {
                this.pendingTasks--;
                log(`onTask`, `task completed ${task}, pattern ${pattern}, tasks in progress: ${this.pendingTasks}`, 1);
            })
            .catch(e => {
                this.pendingTasks--;
                this.errors++;
                err(`onTask`, `task failed ${task}, error: ${e.stack} pattern ${pattern}, tasks in progress: ${this.pendingTasks}`, 1);
            });
    }

    checkNewTasks() {
        if (this.pendingTasks === 0) {
            for (let pattern of this.subscribes.keys()) {
                this.taskQueue.checkQueue(pattern, `${this.taskQueue.SERVER_PREFIX}:${this.taskQueue.LIST_PREFIX}:${pattern}`);
            }
        }
    }

    /**
     * stop listening and publish jobs, pre-destructor
     */
    stop() {
        //TODO: unsubscribe all
    }
};