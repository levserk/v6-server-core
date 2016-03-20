'use strict';

//require
let cluster = require('cluster');
let Manager = require('../../../lib/manager.js');
let Socket = require('../instances/socket.js');
let co = require('co');
let WebSocketServer = require('ws').Server;
let fs = require('fs');

let moduleName = 'SocketManager';
let logger, log, err, wrn;

let defaultConf = {
    path: '/ws',
    port: 8080,
    server: false,
    https: false,
    httpsCert: false,
    httpsKey: false,
    httpsCa: false,
    nativePing: false,
    pingTimeout: 15000,
    pingInterval: 5000,
    stats: false
};

module.exports = class SocketManager extends Manager {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        conf = Object.assign(defaultConf, conf);
        super(server, conf);

        this.httpServer = null;
        this.wsServer = null;
        this.sockets = new Map();
        this.serverId = conf.port;
        this.memory = server.memory;
        this.SOCKETS_KEY = `ws_servers:server_${this.serverId}:sockets`;
        // not used
        this.ONLINE_KEY = `ws_servers:server_${this.serverId}:online`;
        this.ONLINE_TIMEOUT = 15;
        this.UPDATE_INTERVAL = 5000;

        log(`constructor`, `socketManager created, conf: ${JSON.stringify(conf)}`);
    }

    init() {
        let self = this;
        return co(function* () {
            self.httpServer = yield createWebServer(self.conf);
            self.wsServer = new WebSocketServer({
                server: self.httpServer,
                clientTracking: false
            });
            yield self.test();
            yield self.resetOldSockets();
            yield self.subscribe(`send_to_socket_${self.serverId}`, self.sendMessageToSocket.bind(self));
            self.wsServer.on('connection', self.onSocketConnected.bind(self));
            self.wsServer.on('error', self.onWebSocketError.bind(self));

            return true;
        })
            .then(() => {
                self.isRunning = true;
                log(`init`, `init success`);
                return true;
            })
            .catch((e) => {
                this.isRunning = false;
                err(`init, error: ${e.stack || e}`);
                throw Error(`init failed, ${e.stack || e}`);
            });
    }

    resetOldSockets() {
        let self = this;
        return co(function*() {
            let sockets = yield self.memory.setMembers(self.SOCKETS_KEY);
            if (sockets && sockets.length > 0) {
                log(`resetOldSockets`, `old sockets count: ${sockets.length}`);
                // disconnect old sockets;
                yield self.publish(`socket_disconnect`, {
                    sockets: sockets,
                    serverId: self.serverId
                });
                yield self.memory.del(self.SOCKETS_KEY);
            }
        });
    }

    registerServer() {
        let self = this;
        return co(function* () {
            let check = yield self.server.memory.get(self.ONLINE_KEY);
            if (check) {
                throw Error(`ws server on port: ${self.conf.port} already run, or closed incorrectly!`);
            }
            yield self.server.memory.set(self.ONLINE_KEY, 1, self.ONLINE_TIMEOUT);
            self.updateStatusInterval = setInterval(self.updateOnlineStatus.bind(self), self.UPDATE_INTERVAL);
        });
    }

    updateOnlineStatus() {
        let self = this;
        log(`updateOnlineStatus`, `server: ${this.serverId}`, 5);
        return co(function* () {
            let check = yield self.server.memory.get(self.ONLINE_KEY);
            log(`updateOnlineStatus`, `check : ${check}`, 6);
            if (!check) {
                return self.onOnlineTimeout();
            }
            yield self.server.memory.set(self.ONLINE_KEY, 1, self.ONLINE_TIMEOUT);
        });
    }

    onOnlineTimeout() {
        log(`onOnlineTimeout`, `server: ${this.serverId}`);
        clearInterval(this.updateStatusInterval);
        this.close();
    }

    test() {
        log(`test`, `start test`);
        return super.test()
            .then(res => {
                return res;
            });
    }

    close() {
        // close all sockets
        log(`close`, `closing socket manager, server: ${this.serverId}`);
        let self = this;
        return co(function* () {
            yield this.publish('socket_server_closed', this.serverId);
        });
    }

    // методы socketManager (ws server)

    onSocketConnected(ws) {
        let socket = new Socket(ws, this), self = this;
        log(`onSocketConnected`, `socketId: ${socket.socketId}, ip: ${socket.ip} `);
        this.memory.setAdd(this.SOCKETS_KEY, socket.socketId).then(()=> {
            this.sockets.set(socket.socketId, socket);
            socket.on('message', message => {
                this.onSocketMessage(socket, message);
            });
            socket.on('disconnect', reason => {
                this.onSocketDisconnect(socket, reason);
            });
        });
    }

    sendMessageToSocket(task) {
        let socket = this.sockets.get(task.socket.socketId), message = task.message;
        return new Promise((res, rej) => {
            if (!socket || socket.closed) {
                wrn(`sendMessageToSocket`, `closed socket: ${socket}`);
            } else {
                log(`sendMessageToSocket`, `socket:  ${socket}, message: ${message}`);
                socket.send(message);
            }
            res(1);
        });
    }

    onSocketMessage(socket, message) {
        this.publish(`socket_send`, {
            socket: socket.getData(),
            message: message
        });
    }

    onSocketDisconnect(socket, reason) {
        this.publish(`socket_disconnect`, {
            socket: socket.getData(),
            reason: reason
        });
        this.sockets.delete(socket.socketId);
        this.memory.setRemove(this.SOCKETS_KEY, socket.socketId);
    }

    onWebSocketError(e) {
        err(`onWebSocketError`, `error: ${e}`);
    }

};

function createWebServer(conf) {
    return new Promise((res, rej) => {
        let server = conf.server, isRun = false;
        if (server && !server.listen) {
            throw Error("Server in options must be http or https server");
        }
        if (!conf.https) {
            server = require("http").createServer(response);
        }
        else {
            if (!conf.httpsKey || !conf.httpsCert) {
                throw Error("Check https key and certificate in options");
            }
            let httpsObj = {
                key: fs.readFileSync(conf.httpsKey),
                cert: fs.readFileSync(conf.httpsCert)
            };
            if (conf.httpsCa && conf.httpsCa.length > 0) {
                httpsObj.ca = [];
                for (let ca of conf.httpsCa) {
                    httpsObj.ca.push(fs.readFileSync(ca));
                }
            }
            server = require("https").createServer(httpsObj, response);
        }

        server.listen(conf.port);

        server.on('listening', function () {
            isRun = true;
            res(server);
        });

        server.on('error', function (e) {
            err(`createWebServer`, `http server error: ${e}`);
            if (!isRun) {
                rej(e);
            }
        });

        function response(rq, rs) {
            rs.writeHead(200);
            rs.end("welcome");
        }

    });
}