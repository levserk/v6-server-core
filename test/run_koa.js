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


//class Cl {
//    constructor() {
//
//    }
//
//    start (p) {
//        return this.get(p, this.callback);
//    }
//
//    start2 (p) {
//        let self = this;
//        return function* () {
//            yield self.callback(p);
//        };
//    }
//
//    get (p1, callback) {
//        let self = this;
//        return function* () {
//            yield callback.bind(self)(p1);
//        };
//    }
//
//    callback(p) {
//        return Promise.resolve(true);
//    }
//}
//
//let cl = new Cl();
//let co = require('co');
//
//co(function* () {
//    let t1 = Date.now();
//    for (let i = 0; i < 10000; i++){
//        yield cl.start2(i);
//    }
//
//    console.log('done', Date.now() - t1);
//});