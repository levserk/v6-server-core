'use strict';

module.exports = class Engine {

    constructor(server, conf) {
        this.server = server;
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
            default: return Promise.resolve(true);
        }
    }

};