'use strict';

let apiConf = {
    port: 8081,
    allowOrigin: true,
    logger: {
        priority: 3
    },
    dataStorage: {
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

let ApiServer = require('../lib/koaApiServer/apiServer.js'),
    apiServer = new ApiServer(apiConf);
apiServer.start();