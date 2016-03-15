'use strict';

let moduleName = 'Manager';
let logger, log, err, wrn;

/**
 * Base class Manager
 * publisher and subscriber
 * @type {Manager}
 */
module.exports = class Manager {
    /**
     * constructor
     * @param server {Server} server with module taskQueue
     * @param conf {*|Object}
     */
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        this.server = server;
        this.taskQueue = server.taskQueue;
        this.storage = server.storage;
        this.memory = server.memory;
        this.conf = conf;
        this.subscribes = new Map();
        this.isRunning = false;
        this.pendingTasks = 0;
        this.errors = 0;

        log('constructor', 'manager created ', 4);
    }

    /**
     * test and run manager
     * @returns {Promise}
     */
    init() {
        return this.test()
            .then(() => {
                this.isRunning = true;
                log(`init`, `init success`, 4);
                return true;
            })
            .catch((e) => {
                this.isRunning = false;
                err(`init, test error: ${e.stack}`);
                throw Error(`test failed`);
            });
    }

    /**
     * test module
     * @returns {Promise}
     */
    test() {
        log(`test`, `start test`, 4);
        return new Promise((res, rej) => {
            if (this.server && this.taskQueue && this.taskQueue.isRunning) {
                res(true);
            } else {
                err(`test`, `check server and taskQueue`);
                rej(true);
            }
        });
    }

    /**
     * subscribe function for Tasks
     * @param pattern {String}
     * @param func {Function}
     * @returns {Promise}
     */
    subscribe(pattern, func) {
        let self = this;
        return self.taskQueue.subscribe(pattern, self)
            .then(res => {
                // success subscribe
                self.subscribes.set(pattern, func);
                log(`subscribe`, `pattern: ${res}, subscribes count: ${self.subscribes.size}`, 3);
                return self.taskQueue.checkTasks(pattern);
            })
            .catch(e => {
                // error
                err(`subscribe`, `error: ${e}, stack: ${e.stack}`);
                throw e;
            });
    }

    /**
     * unsubscribe from tasks
     * @param pattern {String}
     * @returns {Promise}
     */
    unsubscribe(pattern) {
        let self = this;
        self.subscribes.delete(pattern);
        return this.taskQueue.unsubscribe(pattern)
            .then(res => {
                // success unsubscribe
                log(`unsubscribe`, `pattern: ${res}, subscribes count: ${self.subscribes.size}`, 3);
                return res;
            })
            .catch(e => {
                // error
                err(`unsubscribe`, `error: ${e}, stack: ${e.stack}`);
                throw e;
            });
    }

    /**
     * publish new task for managers
     * @param key {String}
     * @param data {*}
     * @returns {*|Promise}
     */
    publish(key, data) {
        let self = this;
        return self.taskQueue.publish(key, data);
        //TODO: add handler for publishing
    }

    /**
     * handler for new Tasks
     * @param pattern {String}
     * @param task {Task}
     */
    onTask(pattern, task) {
        // inc count running tasks, run task function and wait;
        let self = this, func = self.subscribes.get(pattern);
        if (!func) {
            wrn(`onTask`, `subscriber does't exists for pattern ${pattern}`, 1);
            return Promise.resolve(false);
        }
        this.pendingTasks++;
        log(`onTask`, `new task: ${task}, pattern ${pattern}, tasks in progress: ${this.pendingTasks}`, 1);
        // do task and then do something next
        let resultPromise = func(task.data);
        if (!(resultPromise instanceof Promise)) {
            throw Error(`handler should return a Promise! handler name: ${func.name}`);
        }
        return resultPromise
            .then(res => {
                this.pendingTasks--;
                log(`onTask`, `task completed ${task}, pattern ${pattern}, tasks in progress: ${this.pendingTasks}`, 1);
            })
            .catch(e => {
                this.pendingTasks--;
                this.errors++;
                err(`onTask`, `task failed ${task}, error: ${e.stack} pattern ${pattern}, tasks in progress: ${this.pendingTasks}`, 1);
            });
    }

    checkNewTasks() {
        if (this.pendingTasks === 0) {
            for (let pattern of this.subscribes.keys()) {
                this.taskQueue.checkQueue(pattern, `${this.taskQueue.SERVER_PREFIX}:${this.taskQueue.LIST_PREFIX}:${pattern}`);
            }
        }
    }

    /**
     * stop listening and publish jobs, pre-destructor
     */
    stop() {
        //TODO: unsubscribe all
    }
};