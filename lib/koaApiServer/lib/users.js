'use strict';
let Base = require('./base.js');
let moduleName = 'Users', logger, log, err, wrn;

module.exports = class Users extends Base {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;
        super(server, conf);
    }

    initRouter() {
        let self = this;
        this.router = this.router();

        this.get('/users/user', self.getUser);
        this.get('/users/ratings', self.getRatings);
        this.get('/users/ranks', self.getRanks);
        this.post('/users/user', self.saveUser);
        this.post('/users/settings', self.saveSettings);
    }

    getUser(game, query) {
        return Promise.resolve(null);
    }

    getRatings(query) {
        if (!query || !query.game || !query.mode) {
            return Promise.resolve(null);
        }
        let game = query.game,
            mode = query.mode,
            count = +query.count,
            offset = +query.offset,
            column = query.column,
            order = query.order,
            filter = query.filter;
        if (!count || count < 0 || count > 1000) {
            count = 50;
        }
        if (!offset || offset < 0) {
            offset = 0;
        }
        if (typeof filter !== "string" || (filter = filter.trim()).length < 1) {
            filter = false;
        }
        if (!column || column.length < 1) {
            column = 'ratingElo';
        }
        if (order === 'asc' || order === '1') {
            order = 1;
        }
        else {
            order = -1;
        }
        log(`getData`, `get rating ${game}, ${mode}`, 3);
        return this.storage.getRatings(game, mode, count, offset, column, order, filter)
            .then((allUsers) => {
                return JSON.stringify({
                    mode: mode,
                    column: column,
                    order: order,
                    ratings: {
                        allUsers: allUsers,
                        infoUser: {},
                        skip: offset,
                        offset: offset,
                        count: count
                    }
                });
            }).catch((e)=> {
                err(`getData`, `error: ${e.stack || e}`, 1);
                return null;
            });
    }

    getRanks (game, query) {
        return Promise.resolve(null);
    }

    saveUser (game, data) {
        return Promise.resolve(null);
    }

    saveSettings(game, data) {
        return Promise.resolve(null);
    }
};