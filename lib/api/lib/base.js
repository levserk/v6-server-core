'use strict';


/**
 * Base class
 */
module.exports = class Base {

    constructor(server, conf) {
        this.server = server;
        this.storage = server.storage;
        this.conf = conf;
        this.isRunning = false;
    };

    init() {
        this.isRunning = true;
    }

    get(rs, query) {
        if (!this.isRunning) {
            rs.writeHead(500);
            rs.end('not ready');
        } else {
            this.getData(query)
                .then((res) => {
                    if (!res){
                        rs.writeHead(404);
                        rs.end('no data');
                        return;
                    }
                    if (typeof res != "string"){
                        // wrn
                    }
                    rs.writeHead(200);
                    rs.end(res);
                })
                .catch((e) => {
                    rs.writeHead(500);
                    rs.end(e.stack);
                    //rs.end('internal error');
                })
        }
    }

    getData(query) {
        return new Promise((res, rej) => {
            res(null);
        })
    }
};