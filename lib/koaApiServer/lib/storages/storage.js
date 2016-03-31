'use strict';

module.exports = class Storage {
    constructor(server, conf) {
        this.server = server;
        this.conf = conf;
        this.isRunnig = false;
    }

    init() {
        let self = this;
        return new Promise((res)=> {
            self.isRunnig = true;
            res(true);
        });
    }

    getUserData (user){
        return new Promise((res, rej) => {
            let data = {};
            data.ban = false;
            data.isBanned = data.ban !== false;
            data.settings = {};
            res(data);
        });
    }

    getRatings(game, mode, count, offset, column, order, filter) {
        return new Promise((res) => {
            res(null);
        });
    }

    getHistory(userId, game, mode, count, offset, filter) {
        return new Promise((res) => {
            res(null);
        });
    }

    getGame(userId, game, gameId) {
        return new Promise((res) => {
            res(null);
        });
    }

    getMessages(game, count, time, target, sender) {
        var self = this;
        return new Promise((res) => {
            res(null);
        });
    }

};