'use strict';

let co = require('co');
let Task = require('./task.js');
let Redis = require('redis'), pub, sub;

// functions for log
let moduleName = 'TaskQueue';
let logger, log, err, wrn;

/**
 * Class Task Queue
 * publish and subscribe tasks
 */
module.exports = class TaskQueue {
    /**
     * constructor
     * @param server {Server}
     * @param conf {*|Object}
     */
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        this.server = server;
        this.conf = conf;
        this.subscribes = new Map();
        this.isRunning = false;
        this.SERVER_PREFIX = `ss`;
        this.LIST_PREFIX = `queue:list`;

        log('constructor', 'new taskQueue', 4);
    }

    /**
     * Test and Run module
     * @returns {*|Promise}
     */
    init() {
        let self = this;
        return co(function* () {
            try {
                yield self.initRedis();
                yield self.test();
                self.isRunning = true;
                return true;
            } catch (e) {
                err(`init`, `error: ${e}`);
                this.isRunning = false;
                throw Error(`running failed, error: ${e.stack || e}`);
            }
        });
    }

    /**
     * Test module
     * @returns {*}
     */
    test() {
        return this.testRedis();
    }

    /**
     * Publish new Task
     * @param key {String} - task key
     * @param data {*} - task data
     * @returns {Promise}
     */
    publish(key, data) {
        return new Promise((res, rej) => {
            try {
                let listKey = `${this.SERVER_PREFIX}:${this.LIST_PREFIX}:${key}`,
                    task = new Task(listKey, data);

                // push task to list and publish event
                pub.lpush(listKey, task.serialize(), e => {
                    if (e) {
                        throw Error(`pub.lpush error: ${e}`);
                    }
                    pub.publish(key, listKey, e => {
                        if (e) {
                            throw Error(`pub.publish error: ${e}`);
                        } else {
                            log(`publish`, `list_key: '${listKey}', new task: ${task}`, 4);
                            res(true);
                        }
                    });
                });

            } catch (e) {
                err(`publish`, e, 1);
                rej(`publish failed, error: ${e}`);
            }
        });
    }

    /**
     * Subscribe manager for tasks
     * @param pattern {String} - tasks key pattern ("key*")
     * @param manager {Manager} - manager with handler onTask(pattern, task)
     * @returns {Promise}
     */
    subscribe(pattern, manager) {
        let self = this;
        return new Promise((res, rej) => {
            sub.psubscribe(pattern, (e, _pattern) => {
                if (e) {
                    err(`subscribe`, e, 1);
                    rej(e);
                } else {
                    //TODO: subscribes[pattern] = Set of managers;
                    self.subscribes.set(pattern, manager);
                    log(`subscribe`, `pattern = ${pattern}, subscribed pattern = ${_pattern}`, 3);
                    res(_pattern);
                }
            });
        });
    }

    /**
     * Unsubscribe manager from tasks
     * @param pattern {String} - task pattern
     * @param manager {*}
     * @returns {Promise}
     */
    unsubscribe(pattern, manager) {
        this.subscribes.delete(pattern);
        return new Promise((res, rej) => {
            sub.unsubscribe(pattern, (e, _pattern) => {
                if (e) {
                    err(`unsubscribe`, e, 1);
                    rej(e);
                } else {
                    log(`unsubscribe`, `pattern = ${pattern}, unsubscribe pattern = ${_pattern}`, 3);
                    res(_pattern);
                }
            });
        });
    }

    /**
     * check queue for new tasks and run manager subscribed to pattern
     * @param pattern {String}
     * @param key {String}
     */
    checkQueue(pattern, key) {
        // check unsubscribe for pattern
        let subscriber = this.subscribes.get(pattern), self = this;
        log(`checkQueue`, `pattern: ${pattern}, list_key: '${key}', subscriber: ${subscriber}`, 4);
        if (!subscriber) {
            wrn(`checkQueue`, `subscriber does't exists, pattern: ${pattern}`, 1);
            return Promise.resolve(false);
        }

        return new Promise((res, rej) => {
            pub.rpop(key, (e, result) => {
                if (e) {
                    err(`checkQueue`, `redis error: ${e}, key: ${key}`, 1);
                    res(false);
                    return;
                }

                if (!result) {
                    log(`checkQueue`, `list is empty, key: ${key}`, 3);
                    res(false);
                    return;
                }

                log(`checkList`, `new task: ${result}, pattern: ${pattern}`, 4);
                let task;
                try {
                    task = Task.parse(result);
                } catch (e) {
                    // remove wrong parsed task from list, try next
                    err(`checkQueue`, `error: ${e}, new task: ${result} `, 1);
                    self.checkQueue(pattern, key);
                    res(false);
                    return;
                }
                return subscriber.onTask(pattern, task).then(()=> {
                    res(true);
                }).catch(()=> {
                    res(false);
                });
            });
        });
    }

    checkTasks(pattern) {
        log(`checkTasks`, `check tasks in queue`, 1);
        let self = this;
        return co(function* () {
            let uncompleted = true;
            while (uncompleted) {
                uncompleted = yield self.checkQueue(pattern, `${self.SERVER_PREFIX}:${self.LIST_PREFIX}:${pattern}`);
            }
        });
    }

    /**
     * init redis, create publisher and subscriber
     * @returns {*|Promise}
     */
    initRedis() {
        let self = this;
        // async init redis clients, publisher and subscriber
        return co(function* () {
            pub = yield  asyncInitClient(self.conf);
            sub = yield  asyncInitClient(self.conf);
            sub.on("message", self.onRedisMessage.bind(self));
            sub.on("pmessage", self.onRedisPatternMessage.bind(self));

            return true;
        });
    }

    /**
     * run test, publish and subscribe test task
     * @returns {Promise}
     */
    testRedis() {
        let self = this, key = 'test_redis_' + Math.random(), data = { str: 'test_data' }, cancelTimeout;
        return new Promise((res, rej) => {
            self.subscribe(key, {
                    onTask(p, _task) {
                        clearTimeout(cancelTimeout);
                        log(`testRedis`, `test redis complete, data: ${_task.data}, equal: ${_task.data.str === data.str} `, 4);
                        res(true);
                        return Promise.resolve(true);
                    }
                })
                .then(() => {
                    log(`testRedis`, `subscribed`, 4);
                    return self.publish(key, data);
                })
                .then(() => {
                    log(`testRedis`, `task published`, 4);
                    cancelTimeout = setTimeout(() => {
                        log(`testRedis`, `timeout`);
                        rej('test Redis timeout');
                    }, 1000);
                })
                .catch(e => {
                    clearTimeout(cancelTimeout);
                    err(`testRedis`, `error: ${e} `);
                    rej('test Redis failed');
                });
        });
    }

    /**
     * new message for subscriber
     * @param pattern
     * @param chanel
     * @param message
     */
    onRedisPatternMessage(pattern, chanel, message) {
        log(`onRedisPatternMessage`, `message: ${message}, chanel: ${chanel}, pattern: ${pattern}`, 4);
        //find pattern subscriber end publish
        this.checkQueue(pattern, message);
    }

    onRedisMessage(chanel, message) {
        log(`onRedisMessage`, `message: ${message}, chanel: ${chanel}`, 4);
    }

};

/**
 * init  redis client
 * @param conf {*|Object}
 * @returns {Promise}
 */
function asyncInitClient(conf) {
    return new Promise((res, rej) => {
        let client = Redis.createClient();

        client.on('ready', () => {
            log(`asyncInitRedisClient`, `redis ready`, 4);
            res(client);
        });

        client.on('error', (e) => {
            err(`asyncInitRedisClient`, `redis error ${e}`, 1);
            rej(e);
        });
    });
}