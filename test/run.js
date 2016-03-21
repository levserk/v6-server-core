'use strict';

let gameConf = {
        logger: {
            priority: 3,
            showOnly: ['GameManager']
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
            priority: 0
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
            priority: 0
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


let ApiServer = require('../lib/apiServer/apiServer.js'),
    SocketServer = require('../lib/socketServer/socketServer.js'),
    GameServer = require('../lib/gameServer/gameServer.js'),
    co = require('co');


let apiServer = new ApiServer(apiConf),
    socketServer = new SocketServer(socketConf),
    gameServer = new GameServer(gameConf);


co(function* () {
    yield apiServer.start();
    yield socketServer.start();
    yield gameServer.start();
}).then(() => {

}).catch((e)=>{
    console.log(e);
    process.exit(1);
});