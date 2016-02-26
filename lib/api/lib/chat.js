'use strict';
let Base  = require('./base.js');
let moduleName = 'History', logger, log, err, wrn;

module.exports = class Chat extends Base {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log; wrn = logger.wrn; err = logger.err;
        super(server, conf)
    }

    getData(query) {
        if (!query || !query.game) return Promise.resolve(null);
        let game = query.game,
            count = +query.count,
            time = +query.time,
            target = query.target || game,
            sender = query.sender,
            type = target == game ? 'public' : null;
        if (!time) time = Date.now();
        if (!count || count > 100 || count < 0) count = 10;

        log(`getData`, `get chat ${game}, ${target} ${type ? null : sender} `);
        return this.storage.getMessages(game, count, time, target, type ? null : sender)
            .then((messages) => {
                return JSON.stringify(messages)
            }).catch((e)=> {
                err(`getData`, `error: ${e.stack || e}`);
                return null;
            });
    }
};