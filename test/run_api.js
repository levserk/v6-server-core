'use strict';

let conf = {
    port: 8080,
    allowOrigin: true,
    logger: {
       priority: 4
    },
    storage: {
        default: {
            host: 'localhost',
            port: 27017
        },
        games: {
            test: {},
            test2: {}
        }
    }
};

let Server = require('../lib/api/server.js');
let server = new Server(conf);