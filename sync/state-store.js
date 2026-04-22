let fs = require('node:fs');
let path = require('node:path');
let localPaths = require('../utils/local-paths');

function defaultState() {
    return {
        enabled: false,
        status: 'disabled',
        hasPendingRemote: false,
        retryCount: 0,
        backoffUntil: null,
        lastErrorKind: null,
        lastErrorMessage: null,
        lastSyncReason: null,
        lastPhase: null,
        lastSnapshotId: null,
        lastSyncedSnapshotId: null
    };
}

function ensureSyncDir() {
    fs.mkdirSync(localPaths.syncDirPath(), {recursive: true});
}

function getStateFilePath() {
    return localPaths.syncStateFilePath();
}

function loadState() {
    let file = getStateFilePath();

    if (!fs.existsSync(file)) {
        return defaultState();
    }

    return {
        ...defaultState(),
        ...JSON.parse(fs.readFileSync(file, 'utf8'))
    };
}

function saveState(state) {
    ensureSyncDir();
    let nextState = {
        ...defaultState(),
        ...state
    };
    fs.writeFileSync(getStateFilePath(), JSON.stringify(nextState, null, 2), 'utf8');
    return nextState;
}

module.exports = {
    defaultState,
    ensureSyncDir,
    getStateFilePath,
    loadState,
    saveState
};
