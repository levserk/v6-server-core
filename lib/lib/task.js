'use strict';

module.exports = class Task {
    constructor(key, data) {
        if (!key || !data) {
            throw Error(`Task, wrong parameters, key: ${key}, data: ${data}`);
        }

        this.key = key;
        this.data = data || null;
    }

    serialize() {
        return `{"key": "${this.key}", "data": ${(typeof this.data === "string" ? this.data : JSON.stringify(this.data))} }`;
    }

    toString() {
        return `{key: "${this.key}", data: ${(typeof this.data === "string" ? this.data : JSON.stringify(this.data))} }`;
    }

    static parse(string) {
        let taskData = JSON.parse(string);
        return new Task(taskData.key, taskData.data);
    }
};