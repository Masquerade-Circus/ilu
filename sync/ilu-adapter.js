let fs = require('node:fs');
let localPaths = require('../utils/local-paths');
let configStore = require('../utils/config-store');
let stateStore = require('./state-store');

const TRACKED_ENTRIES = [
    'todos.json',
    'notes.json',
    'boards.json',
    'clocks.json'
];

function getSyncConfig() {
    return configStore.getSyncConfig({fs, paths: localPaths});
}

module.exports = {
    getSourceRoot() {
        return localPaths.storageDirPath();
    },
    listTrackedEntries() {
        return [...TRACKED_ENTRIES];
    },
    getSyncConfig,
    getStateStore() {
        return stateStore;
    },
    buildCommitMessage(context = {}) {
        let domain = context.domain || 'data';
        let action = context.action || 'save';
        return `sync(${domain}): ${action} local data snapshot`;
    },
    logger: {
        info() {},
        warn() {},
        error() {},
        debug() {}
    },
    now() {
        return Date.now();
    }
};
