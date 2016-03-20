'use strict';

let Server = require('../lib/server.js');
let SocketManager = require('./lib/managers/socketManager.js');
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

module.exports = class SocketServer extends Server{
    constructor(conf) {
        conf = Object.assign(defaultConf, conf);
        super(conf);

        logger = this.logger.getLogger('SocketServer');
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        log(`constructor`, `${JSON.stringify(this.conf)}`);
    }

    init() {
        return super.init().then(()=>{
            return this.initManagers();
        });
    }

    initManagers() {
        let self = this, conf = self.conf;
        return co(function* () {
            for (let mg of conf.managers) {
                let manager;
                switch (mg.name) {
                    case 'socketManager':
                        manager = new SocketManager(self, mg.conf);
                        self.managers.push(manager);
                        break;
                }
                if (!manager) {
                    err(`initManagers`, `no class for manager: ${mg.name}, ${JSON.stringify(conf.managers)}`);
                    continue;
                }
                yield manager.init();
            }
        }).then(()=> {
                log(`initManagers`, `init managers complete`);
            })
            .catch((e)=> {
                err(`initManagers`, `init managers failed with error: ${e.stack}`);
                throw Error(`init managers failed`);
            });
    }
};