'use strict';

module.exports = {
    setSocketData(socketId, serverId, userId, userName, game) {
        return this.hashSet(`sockets:${socketId}`, {
            "serverId": serverId,
            "userId": userId,
            "userName": userName,
            "game": game
        });
    },

    getSocketData(socketId) {
        return this.hashGetAll(`sockets:${socketId}`);
    },

    removeSocketData(socketId) {
        return this.del(`sockets:${socketId}`);
    },

    setUserSocket(game, userId, socketId, serverId) {
        return this.hashAdd(`user_sockets:${game}`, userId,
            `{"socketId": "${socketId}", "serverId": "${serverId}"}`);
    },

    getUserSocket(game, userId) {
        return this.hashGet(`user_sockets:${game}`, userId)
            .then((socket) => {
                if (socket) {
                    socket = JSON.parse(socket);
                }
                return socket;
            });
    },

    getGameSockets(game) {
        return this.hashGetAll(`user_sockets:${game}`);
    },

    removeUserSocket(game, userId) {
        return this.hashRemove(`user_sockets:${game}`, userId);
    }
};
