'use strict';

let moduleName = 'Memory',
    RedisMemory = require('../../lib/memory.js'),
    User = require('./instances/user.js'),
    Room = require('./instances/room.js');

let logger, log, err, wrn;

let defaultConf = {};

module.exports = class Memory extends RedisMemory {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        conf = Object.assign(defaultConf, conf);

        super(server, conf);

        this.games = this.server.conf.games;
    }

    *getUserList(game) {
        let users = yield this.hashGetAll(`user_sockets:${game}`);
        let userlist = [];
        log(`getUserList`, `!! users: ${JSON.stringify(users)}`);
        for (let userId in users) {
            if (users.hasOwnProperty(userId)) {
                let user = yield this.getUser(game, userId);
                userlist.push(user.getDataToSend());
            }
        }
        return userlist;
    }

    addUser(game, user) {
        return this.hashSet(`user_data:${game}:${user.userId}`, user.getDataToSave());
    }

    updateUserRating(game, mode, user) {
        let ratingData = JSON.stringify(user.getMode(mode));
        return this.hashAdd(`user_data:${game}:${user.userId}`, mode, ratingData);
    }

    getUser(game, userId) {
        return this.hashGetAll(`user_data:${game}:${userId}`)
            .then((userData) => {
                if (!userData) {
                    return false;
                }
                return new User(userData, game, this.games[game].modes);
            });
    }

    removeUser(game, userId) {
        return this.del(`user_data:${game}:${userId}`);
    }

    setSocketData(socketId, serverId, userId, userName, game) {
        return this.hashSet(`sockets:${socketId}`, {
            "serverId": serverId,
            "userId": userId,
            "userName": userName,
            "game": game
        });
    }

    getSocketData(socketId) {
        return this.hashGetAll(`sockets:${socketId}`);
    }

    removeSocketData(socketId) {
        return this.del(`sockets:${socketId}`);
    }

    setUserSocket(game, userId, socketId, serverId) {
        log(`setUserSocket`, `game: ${game}, userId: ${userId}`);
        return this.hashAdd(`user_sockets:${game}`, userId,
            `{"socketId": "${socketId}", "serverId": "${serverId}"}`);
    }

    getUserSocket(game, userId) {
        return this.hashGet(`user_sockets:${game}`, userId)
            .then((socket) => {
                if (socket) {
                    socket = JSON.parse(socket);
                }
                return socket;
            });
    }

    getGameSockets(game) {
        return this.hashGetAll(`user_sockets:${game}`);
    }

    removeUserSocket(game, userId) {
        log(`removeUserSocket`, `game: ${game}, userId: ${userId}`);
        return this.hashRemove(`user_sockets:${game}`, userId);
    }

    getWaitingUsers(game) {
        return this.hashGetAll(`waiting:${game}`).then((waiting) => {
            return waiting || {};
        });
    }

    // ==== Rooms ===

    setUserRoom(userId, game, room, role) {
        return this.hashSet(`user_room:${game}:${userId}`, room.getPlayerRoom(role));
    }

    delUserRoom(userId, game) {
        return this.del(`user_room:${game}:${userId}`);
    }

    getUserRoom(userId, game) {
        return this.hashGetAll(`user_room:${game}:${userId}`);
    }

    getRooms(game) {
        return this.hashGetAll(`rooms:${game}`).then((roomsObject) => {
            let rooms = [], room;
            if (roomsObject) {
                for (let id of Object.keys(roomsObject)) {
                    room = roomsObject[id];
                    room = Room.load(room);
                    log(`getRooms`, `room: ${JSON.stringify(room)}`);
                    if (room && room.isMulty()) {
                        rooms.push(room.getInfo());
                    }
                }
            }
            return rooms;
        });
    }

    *loadRoom(game, roomId) {
        let roomData = yield this.hashGet(`rooms:${game}`, roomId);

        if (!roomData) {
            err(`loadRoom`, `no room!, game: ${game}, roomId: ${roomId}`, 1);
            return false;
        }

        log(`loadRoom`, `room: ${JSON.stringify(roomData)}`);

        let room = Room.load(roomData);

        log(`loadRoom`, `room.timeout: ${room.timeout}`);

        return room;
    }

    saveRoom(room) {
        if (!room || room.isGameStateClosing()) {
            return Promise.resolve(false);
        }

        log(`saveRoom`, ` room.timeout: ${room.timeout}`);

        return this.hashAdd(`rooms:${room.game}`, room.id, room.getDataToSave());
    }

};