"use strict";

let Queue = require('../lib/taskQueue.js');
let Logger = require('../lib/logger.js');

let server = {
    logger: new Logger()
};

let queue = new Queue(server, {});

let t1 = Date.now();
let count = 10000, done = 0;
console.log(`start, ${new  Date()}`);
queue.init().then(()=>{
    queue.subscribe(`bench_test`, { onTask: (pattern, task) => {
        done++;
        if (done == count) {
            console.log(`done, time: ${Date.now()-t1}ms`);
        }
        return Promise.resolve(true);
    }}).then(()=>{
        console.log(`start publish, ${new  Date()}`);
        for (let i = 0; i < count; i++){
            queue.publish(`bench_test`, {i:i})
        }
    }).catch((e)=>{
        console.log(e.stack);
    })
});
