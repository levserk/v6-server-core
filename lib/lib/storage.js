'use strict';

let moduleName = 'MongoStorage',
    MongoClient = require('mongodb').MongoClient,
    ObjectId = require('mongodb').ObjectID,
    co = require('co');

let logger, log, err, wrn;

let defaultConf = {
    databases: [
        {
            host: 'localhost',
            port: '27017',
            database: 'test'
        }
    ]
};

module.exports = class MongoStorage {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        conf = Object.assign(defaultConf, conf);

        this.server = server;
        this.conf = conf;
        this.isRunning = false;
        this.databases = new Map();

        log('constructor', 'storage created ');
    }

    init() {
        // foreach database init database, create collections/indexes, test
        let self = this;
        return co(function* () {
            return true;
            //    for (let db of self.conf.databases) {
            //        if (!db.host || !db.port || !db.database) {
            //            throw Error(`wrong mongo database parameters, host:${db.host}, port:${db.port}, database:${db.database}`)
            //        }
            //        let mongoDb = yield MongoClient.connect('mongodb://' + db.host + ':' + db.port + '/' + db.database);
            //        self.databases.set(db.database, mongoDb);
            //    }
            //
            //    return self.test()
            //        .then(() => {
            //            self.isRunning = true;
            //            log(`init`, `init success`);
            //            return true;
            //        })
            //        .catch((e) => {
            //            self.isRunning = false;
            //            err(`init, test error: ${e.stack}`);
            //            throw Error(`test failed`);
            //        });
            //
        });
    }

    test() {
        //TODO: test connection
        let self = this;
        return new Promise((res, rej) => {
            res(true);
        });
    }

    loadUserData(userId, game) {
        if (!userId || !game || typeof userId !== "string" || typeof game !== "string") {
            throw Error(`wrong parameters to loadUserData, userId: ${userId}, game: ${game}`);
        }

        return new Promise((res, rej) => {
            res(null);
        });
    }
};