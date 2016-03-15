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