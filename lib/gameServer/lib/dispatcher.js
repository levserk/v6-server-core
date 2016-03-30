'use strict';

let moduleName = 'Dispatcher';
let EventEmitter2 = require('eventemitter2');
let logger, log, err, wrn;

module.exports = class Dispatcher{

    constructor(server, conf) {
        logger = server.logger.getLogger(moduleName);
        log = logger.log;
        wrn = logger.wrn;
        err = logger.err;

        this.emitter = new EventEmitter2();
    }

    on(type) {
        log('on', `addEventListener, type: ${type}`);
        return this.emitter.on(...arguments);
    }

    emit(type) {
        log('emit', `emit event, type: ${type}`);
        return this.emitter.emitAsync(...arguments)
            .then((results) => {
                return results[0];
            });
    }

    trigger(type) {
        log('trigger', `trigger event, type: ${type}`);
        return this.emitter.emitAsync(...arguments)
            .then((results) => {
                return results[0];
            });
    }
};