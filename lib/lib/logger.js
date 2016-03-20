'use strict';

/*
 priority: 0 - high, 1, 2.. - low

 logObject {
 type: 'log, err, wrn'
 module: ''
 function: ''
 message: ''
 priority: 1
 }
 */

let defaultConf = {
    priority: 1,
    hideFrom: false,
    showOnly: false
};

module.exports = function (server, conf) {
    conf = Object.assign({}, defaultConf, conf);

    return new Logger(server, conf);
};

class Logger {
    constructor(server, conf) {
        this.server = server;
        this.conf = conf;
    }

    log() {
        this._log(...arguments, 'log');
    }

    err() {
        this._log(...arguments, 'err');
    }

    wrn() {
        this._log(...arguments, 'wrn');
    }

    _log() {
        let log = Logger.getLogObject(...arguments);

        if (this.conf.showOnly && this.conf.showOnly.indexOf(log.module) === -1){
            return;
        }

        if (this.conf.hideFrom && this.conf.hideFrom.indexOf(log.module) > -1){
            return;
        }

        if (log && log.priority <= this.conf.priority) {
            console.log(`${log.time} - ${log.type}; ${log.module}; ${log.func}; ${log.message}`);
        }
    }

    getLogger(moduleName) {
        let self = this;
        return {
            log: function (func, message, priority) {
                self.log(moduleName, func, message, priority);
            },

            err: function (func, message, priority) {
                self.err(moduleName, func, message, priority);
            },

            wrn: function (func, message, priority) {
                self.wrn(moduleName, func, message, priority);
            }
        };
    }

    static getLogObject(module, func, message, priority, type) {
        module = module || 'none';
        func = func || 'none';
        message = message || null;
        priority = priority || 1;
        type = type || 'log';

        if (!message) {
            return null;
        }
        return {
            type: type,
            module: module,
            func: func,
            message: message,
            priority: priority,
            time: getTime()
        };
    }
}

function getTime() {
    let month_names_short = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        time = '', d = new Date(), t;
    t = d.getDate();
    time += (t < 10 ? '0' : '') + t;
    t = month_names_short[d.getMonth()];
    time += ' ' + t;
    t = d.getHours();
    time += ' ' + (t < 10 ? '0' : '') + t;
    t = d.getMinutes();
    time += ':' + (t < 10 ? '0' : '') + t;
    t = d.getSeconds();
    time += ':' + (t < 10 ? '0' : '') + t;

    return time;
}