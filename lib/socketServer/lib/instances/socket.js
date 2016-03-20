'use strict';

let EventEmitter = require('events').EventEmitter;

let moduleName = 'Socket';
let logger, log, err, wrn;

module.exports = class Socket extends EventEmitter {
    constructor(ws, server) {
        logger = server.server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        super();

        this.server = server;
        this.ws = ws;
        this.socketId = ws.upgradeReq.headers['sec-websocket-key'];
        this.ip = this.ws.upgradeReq.connection.remoteAddress;
        this.serverId = server.serverId;
        this.nativePing = server.conf.nativePing;
        this.timeLastInc = null; // time last pong or other message from socket
        this.timeLastPing = null;
        this.timeLastOut = null;
        this.timeConnect = Date.now();
        this.timePing = 0;
        this.pings = [];
        this.MAX_PINGS_COUNT = 4;

        this.pingInterval = setInterval(this.checkTimeout.bind(this), server.conf.pingInterval);

        this.ws.on('pong', this.onPong.bind(this));
        this.ws.on('message', this.onMessage.bind(this));
        this.ws.on('close', this.onClose.bind(this));
        this.ws.on('error', function (error) {
            err(`error`, `ws ${error}`);
        });

        this.ping();
    }

    checkTimeout() {
        let pingTimeout = this.server.conf.pingTimeout, now = Date.now();
        // check pong not yet received
        if (this.timeLastPing && this.timeLastInc < this.timeLastPing) {
            this.pings.push(now - this.timeLastPing);
            if (this.pings.length > this.MAX_PINGS_COUNT) {
                this.pings.shift();
            }
        }

        if (this.timeLastPing && now - this.timeLastInc > pingTimeout) {
            log(`pingInterval`, `socketId: ${this.socketId} timeout,
                timeLastInc: ${this.timeLastInc},
                timeLastOut: ${this.timeLastOut},
                timeLastPing: ${this.timeLastPing},
                avgPing: ${avg(this.pings)}mc,
                online: ${now - this.timeConnect}mc
                `);
            this.close('timeout');
            return;
        }

        this.ping();
    }

    send(data) {
        if (!data) {
            return;
        }
        try {
            if (typeof data !== "string") {
                data = JSON.stringify(data);
            }
            this.ws.send(data);
            log(`send`, `socketId: ${this.socketId} send message: ${data}`);
            this.timeLastOut = Date.now();
        } catch (e) {
            log(`send`, `socketId: ${this.socketId} error: ${e}`);
        }
    }

    ping() {
        try {
            if (this.nativePing) {
                this.ws.ping(1);
            } else {
                this.ws.send(`ping`);
                // TODO: send time and ping this.ws.send(`{ "ping": ${this.getPing()}, "avgPing": ${this.getAvgPing()}, "time": ${Date.now()} }`);
            }
            this.timeLastOut = this.timeLastPing = Date.now();
        } catch (e) {
            err(`ping`, `send ping error: ${e}, socketId: ${this.socketId}`);
        }
        log(`ping`, `send ping, socketId: ${this.socketId}, timePing: ${this.timeLastPing}`, 5);
    }

    onPong() {
        this.timeLastInc = Date.now();
        this.timePing = this.timeLastInc - this.timeLastPing;
        this.pings.push(this.timePing);
        if (this.pings.length > this.MAX_PINGS_COUNT) {
            this.pings.shift();
        }
        log(`onPong`, `pong received, socketId: ${this.socketId} ping: ${this.timePing}mc, avg ping: ${avg(this.pings)}mc`, 5);
    }

    onMessage(data) {
        if (!data || typeof data !== "string") {
            return;
        }
        this.timeLastInc = Date.now();
        if (data === 'pong') {
            this.onPong();
            return;
        }
        log(`onMessage`, `socketId: ${this.socketId}, message: ${data}`);
        this.emit('message', data);
    }

    close(reason) {
        reason = reason || 'force';
        this.closeReason = reason;
        this.ws.close();
        // emit socket disconnected force
        if (!this.closed) {
            this.onClose(0);
        }
    }

    onClose(code) {
        if (this.closed) {
            wrn(`onClose`, `socketId: ${this.socketId} already closed, new closed code: ${code}`);
            return;
        }
        log(`onClose`, `closing socketId: ${this.socketId}, ws.state: ${this.ws ? this.ws.readyState : "no ws"}, code: ${code}`);
        clearInterval(this.pingInterval);
        this.closed = true;
        if (this.closeReason !== 'silent') {
            this.emit('disconnect', this.closeReason || `close_code: ${code}`);
        }
    }

    getData() {
        return {
            ip: this.ip,
            socketId: this.socketId,
            serverId: this.serverId
        };
    }

    getPing() {
        return this.timePing;
    }

    getAvgPing() {
        return avg(this.pings);
    }
};

function avg(elements) {
    if (!elements || !elements.length) {
        return 0;
    }
    let sum = 0;
    for (let element of elements) {
        sum += element;
    }
    return sum / elements.length;
}
