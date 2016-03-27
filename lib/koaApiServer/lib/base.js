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

    get routes() {
        return this.router.routes();
    }

    get allowedMethods() {
        return this.router.allowedMethods();
    }

};