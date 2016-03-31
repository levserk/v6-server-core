'use strict';

module.exports = {
    getWaitingUsers(game) {
        return this.hashGetAll(`waiting:${game}`).then((waiting) => {
            return waiting || {};
        });
    }
};
