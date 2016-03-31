'use strict';

let User = require('./../instances/user.js');

module.exports = {
    *getUserList(game) {
        let users = yield this.hashGetAll(`user_sockets:${game}`);
        let userlist = [];
        for (let userId in users) {
            if (users.hasOwnProperty(userId)) {
                let user = yield this.getUser(game, userId);
                userlist.push(user.getDataToSend());
            }
        }
        return userlist;
    },

    addUser(game, user) {
        return this.hashSet(`user_data:${game}:${user.userId}`, user.getDataToSave());
    },

    updateUserRating(game, mode, user) {
        let ratingData = JSON.stringify(user.getMode(mode));
        return this.hashAdd(`user_data:${game}:${user.userId}`, mode, ratingData);
    },

    getUser(game, userId) {
        return this.hashGetAll(`user_data:${game}:${userId}`)
            .then((userData) => {
                if (!userData) {
                    return false;
                }
                return new User(userData, game, this.games[game].modes);
            });
    },

    removeUser(game, userId) {
        return this.del(`user_data:${game}:${userId}`);
    }
};
