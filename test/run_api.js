'use strict';

let conf = {
    default: {
        host: 'localhost',
        port: '27017'
    },
    games: {
        test: {},
        test2: {}
    }
};

let Server = require('../api/server.js');
let server = new Server(conf);
