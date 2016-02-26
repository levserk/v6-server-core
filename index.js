'use strict';

let API = require('./lib/api/server.js'),
    Server = require('./lib/server.js');

// api for db
module.exports.API = API;

// real-time server
module.exports.Server = Server;


