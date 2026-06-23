let fs = require('node:fs');
let localPaths = require('../utils/local-paths');
let configStore = require('../utils/config-store');

const IGNORE_PATTERNS = [
    '.config/**'
];

function getSyncConfig() {
    return configStore.getSyncConfig({fs, paths: localPaths});
}

module.exports = {
    getSourceRoot() {
        return localPaths.storageDirPath();
    },
    getIgnorePatterns() {
        return [...IGNORE_PATTERNS];
    },
    getSyncConfig,
    buildCommitMessage(context: any = {}) {
        let domain = context.domain || 'data';
        let action = context.action || 'save';
        return `sync(${domain}): ${action} local data snapshot`;
    }
};
