'use strict';

/**
 * Base class
 */
let router = require('koa-router');

module.exports = class Base {

    constructor(server, conf) {
        this.server = server;
        this.storage = server.storage;
        this.conf = conf;
        this.isRunning = false;
        this.router = router;

        this.initRouter();
    }

    initRouter() {
        this.router = this.router();
        this.router.get('/', function* (next) {
            this.body = 'welcome';
            yield next;
        });
    }

    get (url, callback) {
        let self = this;
        this.router.get(url, function* (next) {
            let data = yield callback.bind(self)(this.params.game, this.query);
            if (data) {
                this.body = data;
            } else {
                this.status = 404;
            }
            yield next;
        });
    }

    del (url, callback) {
        let self = this;
        this.router.del(url, function* (next) {
            let data = yield callback.bind(self)(this.params.game, this.query);
            if (data) {
                this.body = data;
            } else {
                this.status = 404;
            }
            yield next;
        });
    }

    post (url, callback) {
        let self = this;
        this.router.post(url, function* (next) {
            //TODO: get form data
            let data = yield callback.bind(self)(this.params.game, this.query);
            if (data) {
                this.body = data;
            } else {
                this.status = 404;
            }
            yield next;
        });
    }

    get routes() {
        return this.router.routes();
    }

    get allowedMethods() {
        return this.router.allowedMethods();
    }

};