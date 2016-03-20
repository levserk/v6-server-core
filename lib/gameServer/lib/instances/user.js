'use strict';

module.exports = class User {
    constructor(userData, game, modes) {
        this.game = game;
        this.userId = userData.userId.toString();
        this.userName = userData.userName.toString();
        this.isActive = typeof userData.isActive === "boolean" ? userData.isActive : true;
        this.disableInvite = (typeof userData.disableInvite === "string" ? userData.disableInvite === "true" : !!userData.disableInvite);
        this.isAdmin = (typeof userData.isAdmin === "string" ? userData.isAdmin === "true" : !!userData.isAdmin);
        this.isBanned = (typeof userData.isBanned === "string" ? userData.isBanned === "true" : !!userData.isBanned);
        this.dateCreate = Number.parseInt(userData.dateCreate || Date.now());
        this.modes = new Map();

        for (let modeKey of Object.keys(modes)) {
            let mode = userData[modeKey] || userData[`modes.${modeKey}`];
            if (typeof mode === "string") {
                mode = JSON.parse(mode);
            }
            this.modes.set(modeKey, mode);
        }
    }

    getData() {
        return {
            userId: this.userId,
            userName: this.userName,
            isActive: this.isActive,
            disableInvite: this.disableInvite,
            dateCreate: this.dateCreate
        };
    }

    getDataToSend(needString) {
        let data = this.getData();
        for (let modeKey of this.modes.keys()) {
            data[modeKey] = this.modes.get(modeKey);
        }
        if (needString) {
            data = JSON.stringify(data);
        }
        return data;
    }

    getDataToSave() {
        let data = this.getData();

        data.isAdmin = this.isAdmin;
        data.isBanned = this.isBanned;

        for (let modeKey of this.modes.keys()) {
            data[`modes.${modeKey}`] = JSON.stringify(this.modes.get(modeKey));
        }
        return data;
    }

    getMode(modeKey, copy) {
        return copy ?  Object.assign({}, this.modes.get(modeKey)) : this.modes.get(modeKey);
    }

    toString() {
        return `userId: ${this.userId}, userName: ${this.userName}`;
    }

    static createFromFlat(data) {

    }

};