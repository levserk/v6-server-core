'use strict';

let  Room = require('./../instances/room.js');

module.exports = {
    setUserRoom(userId, game, room, role) {
        return this.hashSet(`user_room:${game}:${userId}`, room.getPlayerRoom(role));
    },

    delUserRoom(userId, game) {
        return this.del(`user_room:${game}:${userId}`);
    },

    getUserRoom(userId, game) {
        return this.hashGetAll(`user_room:${game}:${userId}`);
    },

    getRooms(game) {
        return this.hashGetAll(`rooms:${game}`).then((roomsObject) => {
            let rooms = [], room;
            if (roomsObject) {
                for (let id of Object.keys(roomsObject)) {
                    room = roomsObject[id];
                    room = Room.load(room);
                    if (room && room.isMulty()) {
                        rooms.push(room.getInfo());
                    }
                }
            }
            return rooms;
        });
    },

    *loadRoom(game, roomId) {
        let roomData = yield this.hashGet(`rooms:${game}`, roomId);

        if (!roomData) {
            return false;
        }

        return Room.load(roomData);
    },

    saveRoom(room) {
        if (!room || room.isGameStateClosing()) {
            return Promise.resolve(false);
        }

        return this.hashAdd(`rooms:${room.game}`, room.id, room.getDataToSave());
    }
};
