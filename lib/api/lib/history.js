'use strict';
let Base  = require('./base.js');
let moduleName = 'History', logger, log, err, wrn;

module.exports = class History extends Base {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log; wrn = logger.wrn; err = logger.err;
        super(server, conf)
    }

    getData(query) {
        if (!query || !query.game) return Promise.resolve(null);
        let game = query.game,
            mode = query.mode,
            userId = query.userId,
            gameId = query.gameId,
            count = +query.count,
            offset = +query.offset,
            filter = query.filter;
        if (gameId) {
            // load game
            if (!gameId) return Promise.resolve(null);

            log(`getData`, `get game ${game}, ${mode}`, 1);
            return this.storage.getGame(userId, game, gameId)
                .then((game) => {
                    return JSON.stringify({
                        mode: mode,
                        game: game
                    })
                }).catch((e)=> {
                    err(`getData`, `error: ${e.stack || e}`);
                    return null;
                });
        } else {
            // load history
            if (!userId || !mode) return Promise.resolve(null);
            if (!count || count < 0 || count > 1000) count = 50;
            if (!offset || offset < 0) offset = 0;
            if (typeof filter != "string" || (filter = filter.trim()).length < 1) {
                filter = false;
            }

            log(`getData`, `get history ${game}, ${mode} ${userId}`, 3);
            return this.storage.getHistory(userId, game, mode, count, offset, filter)
                .then((data) => {
                return JSON.stringify({
                    mode: mode,
                    history: data.history,
                    penalties: data.penalties,
                    userId: userId
                })
            }).catch((e)=> {
                err(`getData`, `error: ${e.stack || e}`, 1);
                return null;
            });
        }
    }
};