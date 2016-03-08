'use strict';

let conf = {
    taskQueue: {

    },
    mongoStorage: {

    },
    memory: {
        clear: true
    },
    managers: [
        {
            name: 'socketManager',
            conf: {
                port: '8078'
            }
        },
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
};

let Server = require('../lib/server.js'),
    server = new Server(conf);

server.start().then(()=>{
    // server started
}).catch((e)=>{
    // error
    console.log(e);
    process.exit(1);
});