'use strict';

let apiConf = {
    port: 8080,
    allowOrigin: true,
    logger: {
        priority: 1
    },
    mongoStorage: {
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

let ApiServer = require('../lib/apiServer/apiServer.js'),
    apiServer = new ApiServer(apiConf);
apiServer.start();