'use strict';
let Server = require('../lib/server.js');
let MongoStorage = require('../lib/storage.js');
let UserManager = require('./lib/managers/userManager.js');
let ChatManager = require('./lib/managers/chatManager.js');
let InviteManager = require('./lib/managers/inviteManager.js');
let GameManager = require('./lib/managers/gameManager.js');
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
            turnTime: 20000,
            timeMode: 'reset_every_switch',
            timeStartMode: 'after_round_start',
            addTime: 0,
            takeBacks: 0,
            maxTimeouts: 1,
            minTurns: 0
        }
    }
};

module.exports = class GameServer extends Server {
    constructor(conf) {
        conf = Object.assign(defaultConf, conf);
        super(conf);

        logger = this.logger.getLogger('GameServer');
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        this.conf.games = {};
        log(`constructor`, `${JSON.stringify(this.conf)}`);
    }

    init() {
        this.initGamesConf();
        return super.init().then(() => {
            return this.initManagers();
        });
    }

    initManagers() {
        let self = this, conf = self.conf;
        return co(function* () {
            if (conf.mongoStorage) {
                self.storage = new MongoStorage(self, conf.storage);
                yield self.storage.init();
            }

            for (let mg of conf.managers) {
                let manager;
                switch (mg.name) {
                    case 'userManager':
                        manager = new UserManager(self, mg.conf);
                        self.userManager = manager;
                        break;
                    case 'chatManager':
                        manager = new ChatManager(self, mg.conf);
                        self.chatManager = manager;
                        break;
                    case 'inviteManager':
                        manager = new InviteManager(self, mg.conf);
                        self.inviteManager = manager;
                        break;
                    case 'gameManager':
                        manager = new GameManager(self, mg.conf);
                        self.gameManager = manager;
                        break;
                }
                if (!manager) {
                    err(`initManagers`, `no class for manager: ${mg.name}, ${mg}`);
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

    initGamesConf() {
        let games = {}, conf = this.conf.gamesConf;
        for (let gameKey of Object.keys(conf.games)) {
            let game = Object.assign(conf.games[gameKey] || {});
            let modes = Object.assign(game.modes || conf.modes);
            game.modes = {};
            for (let modeKey of Object.keys(modes)) {
                let mode = game.mode || {};
                mode = Object.assign(conf.modeData, modes[modeKey] || {});
                game.modes[modeKey] = mode;
            }
            game.initData = Object.assign(conf.initData, game.initData);
            games[gameKey] = game;
        }

        log(`initGamesConf`, `conf: ${JSON.stringify(games)}`);
        this.conf.games = games;
    }

    closeRoom(game, roomId) {
        return this.inviteManager.onNewMessage({
            game: game,
            type: 'close_room',
            data: {
                roomId: roomId
            }
        });
    }

    leaveUserRoom(game, userId, roomId) {
        log(`leaveUserRoom`, `userId: ${userId}`);
        let self = this;
        return co(function* () {
            yield self.inviteManager.onNewMessage({
                game: game,
                type: 'user_leave_room',
                data: {
                    userId: userId,
                    roomId: roomId
                },
                sender: 'server'
            });
            yield self.userManager.onNewMessage({
                type: 'leave',
                game: game,
                sender: 'server',
                user: {
                    userId: userId
                },
                data: {
                    userId: userId,
                    roomId: roomId
                }
            });
        });
    }

    getUser(game, userId) {
        return this.userManager.getUser(game, userId);
    }

    sendToUser(game, userId, message) {
        return this.userManager.sendToUser(game, userId, message);
    }

    saveUser(game, mode, user) {
        return this.userManager.updateUserRating(game, mode, user);
    }

    sendToAll(game, message) {
        return this.userManager.sendToSockets(game, message);
    }

    getUserRoom(game, userId) {
        return this.inviteManager.getUserRoom(userId, game);
    }

    getUserSocket(game, userId) {
        return this.userManager.getUserSocket(game, userId);
    }

    getRooms(game) {
        return this.inviteManager.getRooms(game);
    }

    getWaitingUsers(game) {
        return this.inviteManager.getWaitingUsers(game);
    }
};