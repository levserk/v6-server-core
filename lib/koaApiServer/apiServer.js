'use strict';

let Server = require('../lib/server.js');
let DataStorage = require('./lib/storages/storage.js'),
    MongoStorage = require('./lib/storages/mongo_storage.js'),
    Rating = require('./lib/rating.js'),
    History = require('./lib/history.js'),
    Chat = require('./lib/chat.js'),
    http = require('http'),
    Url = require("url"),
    defaultConf = require('./conf.js'),
    co = require('co'),
    koa = require('koa'),
    koaLogger = require('koa-logger'),
    router = require('koa-router')();

let logger, log, err, wrn;

module.exports = class ApiServer extends Server {
    constructor(conf) {
        conf = Object.assign({}, defaultConf, conf);
        super(conf);

        logger = this.logger.getLogger('ApiServer');
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        log(`constructor`, `${JSON.stringify(conf)}`);

        this.isRunnig = false;
    }

    init() {
        let self = this;

        return co(function* () {
            yield self.initStorage();
            yield self.initServices();
            yield self.createWebServer(self.conf.port);
        })
            .then(()=> {
                log(`init`, `api service run`, 1);
            })
            .catch((e)=> {
                err(`init`, `error: ${e.stack}`, 1);
            });
    }

    initServices() {
        this.rating = new Rating(this, this.conf);
        this.history = new History(this, this.conf);
        this.chat = new Chat(this, this.conf);

        router.use('/:game', this.rating.routes);
        router.use('/:game', this.chat.routes);
        router.use('/:game', this.history.routes);

        return Promise.resolve(true);
    }

    initStorage() {
        if (this.conf.mongoStorage) {
            this.storage = new MongoStorage(this, this.conf.mongoStorage);
        } else {
            this.storage = new DataStorage(this, this.conf.storage);
        }

        return this.storage.init();
    }

    createWebServer(port) {
        this.app = koa()
            .use(koaLogger())
            .use(router.routes())
            .listen(port);
        return Promise.resolve(true);
    }
};