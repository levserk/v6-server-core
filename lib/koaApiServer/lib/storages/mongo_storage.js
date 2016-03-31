'use strict';
let Storage = require('./storage.js'),
    MongoClient = require('mongodb').MongoClient,
    ObjectId = require('mongodb').ObjectID,
    co = require('co');

let moduleName = 'MongoStorage', logger, log, err, wrn;

module.exports = class MongoStorage extends Storage {
    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        super(server, conf);

        this.databases = new Map();
    }

    init() {
        let self = this;
        return self.initDatabases(self.conf.games);
    }

    initDatabases(games) {
        let self = this, db, mongoDb;
        return co(function* () {
            for (let game of Object.keys(games)) {
                db = Object.assign(self.conf.default, games[game]);
                db.database = game;
                if (!db.host || !db.port || !db.database) {
                    throw Error(`wrong mongo database parameters, host:${db.host}, port:${db.port}, database:${db.database}`);
                }
                mongoDb = yield MongoClient.connect('mongodb://' + db.host + ':' + db.port + '/' + db.database);
                self.databases.set(db.database, mongoDb);
            }
            self.isRunning = true;
            log(`initDatabases`, `db connected, count: ${self.databases.size}`, 1);
        });
    }

    getRatings(game, mode, count, offset, column, sortDir, filter) {
        let self = this, timeStart = Date.now(), query = {}, sort = {}, db;

        db = self.databases.get(game);
        if (!db) {
            err(`getRatings`, `game ${game} have not connection to db`, 1);
            return Promise.resolve(null);
        }

        column = column !== 'dateCreate' ? `${mode}.${column}` : column;
        query[`${mode}.games`] = { '$gt': 0 };
        if (filter) {
            query['userName'] = { $regex: '^' + filter, $options: 'i' };
        }
        sort[column] = sortDir;

        return db.collection(`users`).find(query).sort(sort).skip(offset).limit(count).toArray()
            .then((docs) => {
                log(`getRatings`, `query: db.users.find(${JSON.stringify(query)})
                .sort(${JSON.stringify(sort)}).skip(${offset}).limit(${count})
                time: ${Date.now() - timeStart}`, 4);
                return docs;
            })
            .catch((e) => {
                err(`getRatings`, `mongo error: ${e}`);
                return null;
            });
    }

    getHistory(game, userId, mode, count, offset, filter) {
        let self = this, timeStart = Date.now(), query = {}, sort, db;

        db = self.databases.get(game);
        if (!db) {
            err(`getHistory`, `game ${game} have not connection to db`, 1);
            return Promise.resolve(null);
        }

        query = { players: { $in: [userId] }, mode: mode };
        if (filter) {
            query['userData'] = { $regex: '"userName":"' + filter, $options: 'i' };
        }
        sort = { timeEnd: -1 };

        return co(function* () {
            let history = yield db.collection(`history`).find(query).sort(sort).skip(offset).limit(count).toArray();
            log(`getHistory`, `query: db.history.find(${JSON.stringify(query)})
                .sort(${JSON.stringify(sort)}).skip(${offset}).limit(${count})
                time: ${Date.now() - timeStart}`, 4);

            query = { userId: userId, mode: mode };
            sort = { time: -1 };
            // TODO: use timeStart and timeEnd from history
            let penalties = yield db.collection(`penalties`).find(query).sort(sort).skip(0).limit(100).toArray();
            log(`getHistory`, `query: db.penalties.find(${JSON.stringify(query)})
                .sort(${JSON.stringify(sort)}).skip(${offset}).limit(${count})
                time: ${Date.now() - timeStart}`, 4);
            return {
                history: history,
                penalties: penalties
            };
        }).catch((e) => {
            err(`getHistory`, `mongo error: ${e}`);
            return null;
        });
    }

    getGame(game, userId, gameId) {
        let self = this, timeStart = Date.now(), query = {}, db;

        db = self.databases.get(game);
        if (!db) {
            err(`getGame`, `game ${game} have not connection to db`, 1);
            return Promise.resolve(null);
        }

        query = { _id: new ObjectId(gameId) };

        return db.collection(`games`).find(query).next()
            .then((game) => {
                log(`getGame`, `query: db.games.find(${JSON.stringify(query)})
                time: ${Date.now() - timeStart}`, 4);
                return game;
            })
            .catch((e) => {
                err(`getGame`, `mongo error: ${e}`);
                return null;
            });
    }

    getMessages(game, count, time, target, sender) {
        let self = this, timeStart = Date.now(), query = {}, sort, db;

        db = self.databases.get(game);
        if (!db) {
            err(`getMessages`, `game ${game} have not connection to db`, 1);
            return Promise.resolve(null);
        }

        query = { time: { $lt: time } };
        if (!sender) { // public
            query['target'] = target;
        }
        else { // private
            query['$or'] = [{ target: target, userId: sender }, { target: sender, userId: target }];
        }
        sort = { time: -1 };

        return db.collection(`messages`).find(query).sort(sort).limit(count).toArray()
            .then((messages) => {
                log(`getMessages`, `query: db.messages.find(${JSON.stringify(query)})
                 .sort(${JSON.stringify(sort)}).limit(${count})
                time: ${Date.now() - timeStart}`, 4);
                return messages;
            })
            .catch((e) => {
                err(`getMessages`, `mongo error: ${e}`);
                return null;
            });
    }
};
