'use strict';

//require
let Manager = require('../../../lib/manager.js');
let co = require('co');

let moduleName = 'ChatManager';
let logger, log, err, wrn;

let defaultConf = {};

module.exports = class ChatManager extends Manager {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        conf = Object.assign(defaultConf, conf);
        super(server, conf);

        this.games = this.server.conf.games;
        this.MESSAGES_INTERVBAL = 1500;

        log(`constructor`, `chatManager created, conf: ${JSON.stringify(conf)}`);
    }

    init() {
        let self = this;
        return co(function* () {
            let test = yield self.test();
            yield self.subscribe(`user_send_chat_manager`, self.onNewMessage.bind(self));
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

    onNewMessage(message) {
        let self = this, userId = message.user.userId, game = message.game, type = message.type, data = message.data;
        log(`onMessage`, `userId: ${userId}, game: ${game}, type: ${type}, data: ${data}`);
        return co(function* () {
            let user = yield self.server.getUser(game, userId);
            if (!user) {
                wrn(`onMessage`, ` no user data, userId: ${userId}, game: ${game}`);
                return false;
            }
            switch (type) {
                case 'message':
                    if (data.admin && !user.isAdmin) {
                        wrn(`onMessage`, `try send message not admin, user: ${user},  ${data.text}`, 1);
                        return Promise.resolve(true);
                    }
                    return self.sendMessage(user, game, data.text, data.target, data.admin);
                case 'ban':
                    if (user.isAdmin || this.server.conf.mode === 'debug' || this.server.conf.mode === 'develop') {
                        return self.banUser(data.userId, data.days, data.reason);
                    } else {
                        return Promise.resolve(true);
                    }
                    break;
                case 'delete':
                    if (user.isAdmin || this.server.conf.mode === 'debug' || this.server.conf.mode === 'develop') {
                        return self.deleteMessage(game, data.time);
                    } else {
                        return Promise.resolve(true);
                    }
            }
        });
    }

    sendMessage(user, game, text, target, isAdmin) {
        // TODO: check ban user, text length
        if (user.isBanned) {
            wrn(`sendMessage`, `user is banned!`, user.userId, 1);
            return;
        }
        var time = Date.now();
        //if (this.message && this.message.time == time){
        //    wrn(`sendMessage`, `fast messages in the same time!`, time, 1);
        //    return;
        //}
        if (user.timeLastMessage && time - user.timeLastMessage < this.MESSAGES_INTERVBAL) {
            wrn(`sendMessage`, `double messages in `, user.userId, user.userName, time - user.timeLastMessage, 2);
            return;
        }
        if (text.length > 128) {
            wrn(`sendMessage`, `long messages in `, user.userId, user.userName, text.length, 1);
            return;
        }
        user.timeLastMessage = time;
        if (!target) {
            target = game;
        }
        let message = {
            text: text,
            time: time,
            userId: user.userId,
            userName: (isAdmin ? 'admin' : user.userName),
            admin: isAdmin,
            target: target,
            userData: user.getData(),
            type: 'public'
        };
        if (target !== game) {
            //var targetUser = this.server.storage.getUser(target);
            //if (targetUser) {   // private to user
            //    this.server.router.send({
            //        module: 'chat_manager', type: 'message', target: user, data: this.message
            //    });
            //    this.message.type = 'private';
            //    target = targetUser;
            //
            //} else {    // message in room
            //    target = this.server.storage.getRoom(target);
            //    this.message.type = 'room'
            //}
        } else {
            // public message
            return this.server.userManager.sendToSockets(game,
                `{ "module": "chat_manager","type": "message", "data": ${JSON.stringify(message)} }`);
        }
        //this.server.storage.pushMessage(this.message);
    }

    deleteMessage(id) {
        log(`deleteMessage`, id, 2);
        return Promise.resolve(false);

        this.server.storage.deleteMessage(id);
    }

    banUser(userId, days, reason) {
        logger.log(`banUser`, userId, days, reason, 2);
        return Promise.resolve(false);

        var timeEnd = Date.now() + days * 1000 * 3600 * 24;
        this.server.storage.banUser(userId, timeEnd, reason);
        var user = this.server.storage.getUser(userId);
        if (user) {
            user.isBanned = true;
            user.ban = { timeEnd: timeEnd, reason: reason };
            this.server.router.send({
                module: 'chat_manager', type: 'ban', target: user, data: user.ban
            });
        } else {
            logger.warn('ChatManager.banUser, user not found', userId, 3);
        }
    }
};