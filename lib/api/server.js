'use strict';

let Storage = require('./lib/storages/mongo_storage.js'),
    Rating = require('./lib/rating.js'),
    History = require('./lib/history.js'),
    Chat = require('./lib/chat.js'),
    Logger = require('./lib/logger.js'),
    http = require('http'),
    URL = require("url"),
    defaultConf = require('./conf.js');

let logger, log, err, wrn;

module.exports = class Server {
    constructor(conf) {
        this.logger = Logger();
        logger = this.logger.getLogger('Server');
        log = logger.log; wrn = logger.wrn; err = logger.err;

        conf = Object.assign(defaultConf, conf);
        this.isRunnig = false;
        this.storage = new Storage(this, conf.storage);
        this.rating = new Rating(this, conf);
        this.history = new History(this, conf);
        this.chat = new Chat(this, conf);
        this.initStorage()
            .then(() => {
                return this.initServices();
            })
            .then(() => {
                return this.createWebServer(conf.port)
            })
            .then(()=>{
                log(`constructor`, `api service run`)
            }).catch((e)=>{
                err(`constructor`, `error: ${e.stack}`)
            })
    }

    initServices() {
        this.rating.init();
        this.history.init();
        this.chat.init();
    }

    initStorage() {
        return this.storage.init()
    }

    createWebServer(port) {
        let self = this;
        return new Promise((pres, prej) => {
            self.webServer = http.createServer(self.onHttpRequest.bind(self));
            self.webServer.on('listening', () => {
                log(`webServer.onListening`, `http server run`);
                pres(true)
            });
            self.webServer.on('error', (e) => {
                err(`webServer.onError`, `error: ${e}`)
            });
            self.webServer.listen(port);
        })
    }


    onHttpRequest(rq, rs) {
        let url = URL.parse(rq.url, true);
        log(`onHttpRequest`, `rq ${rq}, path: ${url.pathname}, query: ${JSON.stringify(url.query)}`);
        if (this.conf.allowOrigin) rs.setHeader('Access-Control-Allow-Origin', '*');

        //remove undefined keys
        for (let key of Object.keys(url.query)) {
            if (url.query[key] == "undefined") url.query[key] = undefined;
        }
        this.route(rq, rs, url.pathname, url.query);
    }


    route(rq, rs, path, query) {
        switch(path) {
            case '/ratings':
                this.rating.get(rs,query);
                break;
            case '/history':
                this.history.get(rs,query);
                break;
            case '/chat':
                this.chat.get(rs,query);
                break;
            default:
                rs.writeHead(404);
                rs.end('not found');
        }
    }
};