'use strict';
let cluster = require('cluster');
let Memory = require('./memory.js');
let Logger = require('./logger.js');
let TaskQueue = require('./taskQueue.js');
let logger, log, err, wrn;
let co = require('co');

let defaultConf = {
    gamesConf: {
        games: {
            test1: {
                modes: {
                    default: {}
                }
            },
            test2: {}
        },
        modes: {
            default: {}
        },
        modeData: {
            win: 0,
            lose: 0,
            draw: 0,
            games: 0,
            rank: 0,
            ratingElo: 1600,
            timeLastGame: 0
        },
        initData: {
            saveHistory: true,
            saveRating: true,
            turnTime: 60000,
            timeMode: 'reset_every_switch',
            timeStartMode: 'after_switch',
            addTime: 0,
            takeBacks: 0,
            maxTimeouts: 1,
            minTurns: 0
        }
    }
};

module.exports = class Server {
    constructor(conf) {
        conf = Object.assign({}, defaultConf, conf);
        this.conf = conf;
        this.managers = [];
        this.logger = Logger();

        logger = this.logger.getLogger('Server');
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;
    }

    start() {
        log(`start`, `starting server`);
        return this.init().then(()=> {
                log(`start`, `server started`);
            })
            .catch((e)=> {
                err(`start`, `starting server failed with error: ${e.stack}`);
                throw Error(`starting server failed`);
            });
    }

    init() {
        return this.initModules();
    }

    initModules() {
        let self = this, conf = self.conf;
        return co(function* () {
            if (conf.taskQueue) {
                self.taskQueue = new TaskQueue(self, conf.taskQueue);
                yield self.taskQueue.init();
            }
            if (conf.memory) {
                self.memory = new Memory(self, conf.memory);
                yield self.memory.init();
            }
        })
            .then(()=> {
                log(`initModules`, `init modules complete`);
            })
            .catch((e)=> {
                err(`initModules`, `init modules failed with error: ${e.stack}`);
                throw Error(`init modules failed`);
            });
    }
};