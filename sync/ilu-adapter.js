let fs = require('node:fs');
let localPaths = require('../utils/local-paths');
let stateStore = require('./state-store');

const TRACKED_ENTRIES = [
    'todos.json',
    'notes.json',
    'boards.json',
    'clocks.json'
];

function loadJsonIfExists(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getSyncConfig() {
    let config = loadJsonIfExists(localPaths.syncConfigFilePath(), {});

    return {
        enabled: config.enabled === true,
        remoteUrl: config.remoteUrl || null,
        branch: config.branch || 'main',
        autoSync: config.autoSync !== false,
        autoPull: config.autoPull !== false,
        autoPush: config.autoPush !== false
    };
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
