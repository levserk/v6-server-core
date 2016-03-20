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
    co = require('co');

let logger, log, err, wrn;

module.exports = class ApiServer extends Server {
    constructor(conf) {
        conf = Object.assign(defaultConf, conf);
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
            }).catch((e)=> {
                err(`init`, `error: ${e.stack}`, 1);
            });
    }

    initServices() {
        this.rating = new Rating(this, this.conf);
        this.history = new History(this, this.conf);
        this.chat = new Chat(this, this.conf);
        this.rating.init();
        this.history.init();
        this.chat.init();
        return Promise.resolve(true);
    }

    initStorage() {
        if (this.conf.mongoStorage){
            this.storage = new MongoStorage(this, this.conf.mongoStorage);
        } else {
            this.storage = new DataStorage(this, this.conf.storage);
        }

        return this.storage.init();
    }

    createWebServer(port) {
        let self = this;
        return new Promise((pres, prej) => {
            self.webServer = http.createServer(self.onHttpRequest.bind(self));
            self.webServer.on('listening', () => {
                log(`webServer.onListening`, `http server run, port: ${port}`, 1);
                pres(true);
            });
            self.webServer.on('error', (e) => {
                err(`webServer.onError`, `error: ${e}`, 1);
            });
            self.webServer.listen(port);
        });
    }

    onHttpRequest(rq, rs) {
        let url = Url.parse(rq.url, true);
        log(`onHttpRequest`, `rq ${rq}, path: ${url.pathname}, query: ${JSON.stringify(url.query)}`, 2);
        if (this.conf.allowOrigin) {
            rs.setHeader('Access-Control-Allow-Origin', '*');
        }

        //remove undefined keys
        for (let key of Object.keys(url.query)) {
            if (url.query[key] === "undefined") {
                url.query[key] = undefined;
            }
        }
        this.route(rq, rs, url.pathname, url.query);
    }

    route(rq, rs, path, query) {
        switch (path) {
            case '/ratings':
                this.rating.get(rs, query);
                break;
            case '/history':
                this.history.get(rs, query);
                break;
            case '/chat':
                this.chat.get(rs, query);
                break;
            default:
                rs.writeHead(404);
                rs.end('not found');
        }
    }
};