'use strict';

let moduleName = 'Memory',
    Redis = require("redis"),
    co = require('co');

let logger, log, err, wrn;

let defaultConf = {};

module.exports = class Memory {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        conf = Object.assign(defaultConf, conf);

        this.server = server;
        this.conf = conf;
        this.isRunning = false;
        this.client = null;
    }

    init() {
        let self = this;
        return co(function* () {

            self.client = yield asyncInitClient(self.conf);

            if (self.conf.clear) {
                yield self.clear();
            }

            return self.test()
                .then(() => {
                    self.isRunning = true;
                    log(`init`, `init success`);
                    return true;
                })
                .catch((e) => {
                    self.isRunning = false;
                    err(`init, test error: ${e.stack}`);
                    throw Error(`test failed, error: ${e.stack || e}`);
                });
        });
    }

    test() {
        let self = this;
        return co(function* () {
            let val = 1, key = `test_key`;
            yield self.set(key, val, 1);
            yield self.del(`test_list`);
            yield self.del(`test_current`);
            let v1 = yield self.listGet(`test_list`, `test_current`);
            log(`test`, `v1: ${JSON.stringify(v1)}`);
            yield self.listAdd(`test_list`, 'qqq');

            let v2 = yield self.listGet(`test_list`, `test_current`);
            log(`test`, `v2: ${JSON.stringify(v2)}`);

            let v3 = yield self.listGet(`test_list`, `test_current`);
            log(`test`, `v3: ${JSON.stringify(v3)}`);

            let v4 = yield self.get(`test_current`);
            log(`test`, `v4: ${JSON.stringify(v4)}`);

            return true;
        });
    }

    set(key, value, seconds) {
        if (!key || !value || typeof key !== "string") {
            throw Error(`wrong parameters to set in memory, key: ${key}, ${value}`);
        }
        if (typeof value !== "string") {
            value = typeof value === "object" ? JSON.stringify(value) : value.toString();
        }

        key = `ss:${key}`;

        return new Promise((res, rej) => {
            if (Number.isInteger(seconds)) {
                this.client.setex(key, seconds, value, (e) => {
                    if (e) {
                        err(`set`, `redis setex key error ${e}`);
                        rej(e);
                    } else {
                        res(true);
                    }
                });
            } else {
                this.client.set(key, value, (e) => {
                    if (e) {
                        err(`set`, `redis set key error ${e}`);
                        rej(e);
                    } else {
                        res(true);
                    }
                });
            }
        });
    }

    get(key) {
        if (!key || typeof key !== "string") {
            throw Error(`wrong parameters to get value in memory, key: ${key}`);
        }

        key = `ss:${key}`;

        return new Promise((res, rej) => {
            this.client.get(key, (e, value) => {
                if (e) {
                    err(`get`, `redis get key error ${e}`);
                    rej(e);
                } else {
                    res(value);
                }
            });
        });
    }

    getKeys(pattern) {
        pattern = `ss:${pattern}`;

        return new Promise((res, rej) => {
            this.client.keys(pattern, (e, value) => {
                if (e) {
                    err(`getKeys`, `redis keys error ${e}`);
                    rej(e);
                } else {
                    res(value);
                }
            });
        });
    }

    setAdd(key, value) {
        if (!key || !value || typeof key !== "string") {
            throw Error(`wrong parameters to sadd in memory, key: ${key}, ${value}`);
        }
        if (typeof value !== "string" && !Array.isArray(value)) {
            value = typeof value === "object" ? JSON.stringify(value) : value.toString();
        }

        key = `ss:${key}`;

        return new Promise((res, rej) => {
            this.client.sadd(key, value, (e) => {
                if (e) {
                    err(`setAdd`, `redis sadd error ${e}`);
                    rej(e);
                } else {
                    res(true);
                }
            });
        });
    }

    setMembers(key) {
        if (!key || typeof key !== "string") {
            throw Error(`wrong parameters to smembers in memory, key: ${key}`);
        }

        key = `ss:${key}`;

        return new Promise((res, rej) => {
            this.client.smembers(key, (e, value) => {
                if (e) {
                    err(`setMembers`, `redis smembers error ${e}`);
                    rej(e);
                } else {
                    res(value);
                }
            });
        });
    }

    setRemove(key, value) {
        if (!key || !value || typeof key !== "string") {
            throw Error(`wrong parameters to srem in memory, key: ${key}, ${value}`);
        }
        if (typeof value !== "string") {
            value = typeof value === "object" ? JSON.stringify(value) : value.toString();
        }

        key = `ss:${key}`;

        return new Promise((res, rej) => {
            this.client.srem(key, value, (e) => {
                if (e) {
                    err(`setRemove`, `redis srem error ${e}`);
                    rej(e);
                } else {
                    res(true);
                }
            });
        });
    }

    hashSet(key, value) {
        if (!key || !value || typeof key !== "string") {
            throw Error(`wrong parameters to hmset in memory, key: ${key}, ${value}`);
        }

        key = `ss:${key}`;

        return new Promise((res, rej) => {
            this.client.hmset(key, value, (e) => {
                if (e) {
                    err(`hashSet`, `redis hmset error ${e}`);
                    rej(e);
                } else {
                    res(true);
                }
            });
        });
    }

    hashAdd(key, property, value) {
        if (!key || !value || !property || typeof key !== "string") {
            throw Error(`wrong parameters to hmset in memory, key: ${key}, ${property}, ${value}`);
        }

        if (typeof value !== "string") {
            value = typeof value === "object" ? JSON.stringify(value) : value.toString();
        }

        key = `ss:${key}`;

        return new Promise((res, rej) => {
            this.client.hmset(key, property, value, (e) => {
                if (e) {
                    err(`hashAdd`, `redis hmset error ${e}`);
                    rej(e);
                } else {
                    res(true);
                }
            });
        });
    }

    hashRemove(key, property) {
        if (!key || !property || typeof key !== "string") {
            throw Error(`wrong parameters to hmset in memory, key: ${key}, ${property}`);
        }

        key = `ss:${key}`;

        return new Promise((res, rej) => {
            this.client.hdel(key, property, (e) => {
                if (e) {
                    err(`hashAdd`, `redis hdel error ${e}`);
                    rej(e);
                } else {
                    res(true);
                }
            });
        });
    }

    hashGet(key, property) {
        if (!key || !property || typeof key !== "string") {
            throw Error(`wrong parameters to hget in memory, key: ${key}, ${property}`);
        }

        key = `ss:${key}`;

        return new Promise((res, rej) => {
            this.client.hget(key, property, (e, result) => {
                if (e) {
                    err(`hashGet`, `redis hget error ${e}`);
                    rej(e);
                } else {
                    res(result);
                }
            });
        });
    }

    hashGetAll(key) {
        if (!key || typeof key !== "string") {
            throw Error(`wrong parameters to hgetall in memory, key: ${key}`);
        }

        key = `ss:${key}`;

        return new Promise((res, rej) => {
            this.client.hgetall(key, (e, result) => {
                if (e) {
                    err(`hashGetAll`, `redis hgetall error ${e}`);
                    rej(e);
                } else {
                    res(result);
                }
            });
        });
    }

    listAdd(key, value) {
        if (!key || !value || typeof key !== "string") {
            throw Error(`wrong parameters to lpush in memory, key: ${key}, ${value}`);
        }

        key = `ss:${key}`;

        return new Promise((res, rej) => {
            this.client.lpush(key, value, (e) => {
                if (e) {
                    err(`listAdd`, `redis lpush error ${e}`);
                    rej(e);
                } else {
                    res(true);
                }
            });
        });
    }

    listGet(listKey, valueKey) {
        if (!listKey || !listKey || typeof listKey !== "string" || typeof valueKey !== "string") {
            throw Error(`wrong parameters to lpush in memory, key: ${listKey}, ${valueKey}`);
        }

        listKey = `ss:${listKey}`;
        valueKey = `ss:${valueKey}`;

        return new Promise((res, rej) => {
            let script = `
            if redis.call("EXISTS", KEYS[2]) == 1
            then
                return nil
            else
                local current = redis.call("RPOP", KEYS[1])
                if current == nil then return nil
                else
                    redis.call("SET", KEYS[2], current)
                    return current
                end
            end`;
            this.client.eval(script, 2, listKey, valueKey, null, (e, result) => {
                if (e) {
                    err(`listAdd`, `redis eval error ${e}`);
                    rej(e);
                } else {
                    res(result);
                }
            });
        });
    }

    del(key) {
        if (!key || typeof key !== "string") {
            throw Error(`wrong parameters to del value in memory, key: ${key}`);
        }

        key = `ss:${key}`;

        return new Promise((res, rej) => {
            this.client.del(key, (e) => {
                if (e) {
                    err(`get`, `redis get key error ${e}`);
                    rej(e);
                } else {
                    res(true);
                }
            });
        });
    }

    clear() {
        //"return redis.call('del', unpack(redis.call('keys', ARGV[1])))"
        log(`clear`, `del all redis keys`);
        return new Promise((res, rej) => {
            // TODO: fails on call in clusters
            let script = `return redis.call('del', unpack(redis.call('keys', ARGV[1])))`;
            this.client.eval(script, 0, `ss*`, (e, result) => {
                if (e) {
                    err(`clear`, `redis eval error ${e}`);
                    rej(e);
                } else {
                    res(true);
                }
            });
        }).catch((e) => {
            err('clear', `error: ${e.stack || e}`);
        });
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
            log(`asyncInitRedisClient`, `redis ready`);
            res(client);
        });

        client.on('error', (e) => {
            err(`asyncInitRedisClient`, `redis error ${e}`, 1);
            rej(e);
        });
    });
}