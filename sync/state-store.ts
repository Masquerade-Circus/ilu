import fs from 'node:fs';
import path from 'node:path';
import localPaths from '../utils/local-paths.ts';
import * as __cjsImport32 from '../sync-core/state/file-store.ts';
const { createFileStateStore } = __cjsImport32;
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

export { createStateStore, defaultState, ensureSyncDir, getStateFilePath, loadState, saveState };
export default {
    createStateStore,
    defaultState,
    ensureSyncDir,
    getStateFilePath,
    loadState,
    saveState
};
