'use strict';

let gameConf = {
        logger: {
            priority: 3
        },
        taskQueue: {},
        mongoStorage: {},
        memory: {
            clear: true
        },
        managers: [
            {
                name: 'gameManager',
                conf: {}
            },
            {
                name: 'inviteManager',
                conf: {}
            },
            {
                name: 'userManager',
                conf: {}
            },
            {
                name: 'chatManager',
                conf: {}
            }
        ]
    },
    socketConf = {
        logger: {
            priority: 1
        },
        taskQueue: {},
        mongoStorage: {},
        memory: {
            clear: true
        },
        managers: [
            {
                name: 'socketManager',
                conf: {
                    port: '8078'
                }
            }
        ]
    },
    apiConf = {
        port: 8080,
        allowOrigin: true,
        logger: {
            priority: 1
        },
        storage: {
            default: {
                host: 'localhost',
                port: 27017
            },
            games: {
                test: {},
                test2: {}
            }
        }
    };

let cluster = require('cluster'),
    ApiServer = require('../lib/apiServer/apiServer.js'),
    SocketServer = require('../lib/socketServer/socketServer.js'),
    GameServer = require('../lib/GameServer/GameServer.js'),
    co = require('co'),
    count = 2;

if (cluster.isMaster) {
    for (let i = 0; i < count; i++) {
        // TODO: waiting for previous cluster running complete
        setTimeout(() => {
            cluster.fork();
        }, i*1000);
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(`worker ${worker.process.pid} died`);
    });

    console.log('master work', process.pid);
} else {
    console.log('worker starting', process.pid);
    let apiServer = new ApiServer(apiConf),
        socketServer = new SocketServer(socketConf),
        gameServer = new GameServer(gameConf);


    co(function* () {
        yield apiServer.start();
        yield socketServer.start();
        yield gameServer.start();
    }).then(() => {
        console.log('worker servers started', process.pid);
    }).catch((e)=> {
        console.log(e);
        process.exit(1);
    });
}