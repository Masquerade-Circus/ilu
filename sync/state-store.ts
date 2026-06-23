let fs = require('node:fs');
let path = require('node:path');
let localPaths = require('../utils/local-paths');
let {createFileStateStore} = require('../sync-core/state/file-store');

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

function getStateFilePath() {
    return localPaths.syncStateFilePath();
}

function createStateStore() {
    return createFileStateStore({
        defaultState,
        getStateFilePath,
        fileSystem: fs,
        pathModule: path
    });
}

let fileStateStore = createStateStore();

function ensureSyncDir() {
    return fileStateStore.ensureStateDir();
}

function loadState() {
    return fileStateStore.loadState();
}

function saveState(state: any) {
    return fileStateStore.saveState(state);
}

module.exports = {
    createStateStore,
    defaultState,
    ensureSyncDir,
    getStateFilePath,
    loadState,
    saveState
};
