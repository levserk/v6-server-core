'use strict';
let co = require('co');
let moduleName = 'Engine';
let logger, log, err, wrn;

module.exports = class Engine {

    static get USER_READY () { return 'user_ready'; }
    static get ROUND_START () {  return 'round_start';}
    static get ROUND_END () { return 'round_end';}
    static get USER_TURN () { return 'user_turn';}
    static get USER_EVENT () {  return 'user_event';}
    static get USER_TIMEOUT () {  return 'user_timeout';}
    static get USER_LEAVE () {  return 'user_leave';}

    constructor(gameManager, conf) {
        this.server = this.gm = gameManager;

        logger = gameManager.server.logger.getLogger(moduleName);
        log = logger.log; wrn = logger.wrn; err = logger.err;

        this.isRuning = false;
    }

    init() {
        this.isRuning = true;
        return new Promise((res) => {
            res(true);
        })
    }

    onMessage(type, room, user, data) {
        switch (type){
            case Engine.USER_READY:
                return this.onUserReady(room, user, data);
                break;
            case Engine.USER_LEAVE:
                return this.onUserLeave(room, user);
                break;
            default: return Promise.resolve(true);
        }
    }

    onUserReady(room, user, data) {
        let self = this;
        return co(function* (){
            room.setUserReady(user.userId);

            yield self.gm.sendUserReady(room, user, {user: user.userId, ready: data});

            if (!room.checkPlayersReady()){
                return Promise.resolve(true);
            }
            // all players ready
            yield self.initGame(room);

            yield self.gm.sendRoundStart(room);

            // start time
        });
    }

    initGame(room, initData) {
        return new Promise((res) => {
            initData = initData || {};
            room.initGame(this.setFirst(room), initData);
            res(true);
        })
    }

    setFirst(room) {
        if (!room.game.first) return room.owner;
        return room.getOpponent(room.game.first);
    }

    onUserLeave(room, user) {
        return this.server.sendGameEnd(room);
    }

};