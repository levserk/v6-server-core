'use strict';

let moduleName = 'Memory',
    RedisMemory = require('../../../lib/memory.js'),
    socketsMemory = require('./sockets_memory.js'),
    usersMemory = require('./users_memory.js'),
    invitesMemory = require('./invites_memory.js'),
    roomsMemory = require('./rooms_memory.js'),
    mixin = require('es6-class-mixin');

let logger, log, err, wrn;

let defaultConf = {};

module.exports = class Memory extends mixin(RedisMemory,  socketsMemory, usersMemory, invitesMemory, roomsMemory) {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        conf = Object.assign(defaultConf, conf);

        super(server, conf);

        this.games = this.server.conf.games;
    }
};