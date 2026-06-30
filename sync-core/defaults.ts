import path from 'node:path';
import * as __cjsImport39 from './backends/git-cli.ts';
const { createGitCliBackend } = __cjsImport39;
import * as __cjsImport40 from './state/file-store.ts';
const { createFileStateStore } = __cjsImport40;
function defaultSyncState({enabled = false}: any = {}) {
    return {
        enabled,
        status: enabled ? 'healthy' : 'disabled',
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

function getDefaultStateFilePath(sourceRoot: any) {
    return path.join(sourceRoot, '.config', 'sync-state.json');
}

function createDefaultStateStore({sourceRoot, config}: any = {}) {
    return createFileStateStore({
        defaultState() {
            return defaultSyncState({enabled: config?.enabled === true});
        },
        getStateFilePath() {
            return getDefaultStateFilePath(sourceRoot);
        }
    });
}

function createDefaultBackend({sourceRoot, config, ignorePatterns = []}: any = {}) {
    return createGitCliBackend({
        repoPath: sourceRoot,
        branch: config.branch,
        remote: 'origin',
        remoteUrl: config.remoteUrl,
        ignorePatterns: [...ignorePatterns, '.config/sync-state.json']
    });
}

function resolveRuntimeDependencies(normalized: any) {
    return {
        ...normalized,
        stateStore: normalized.stateStore || createDefaultStateStore({
            sourceRoot: normalized.sourceRoot,
            config: normalized.config
        }),
        backend: normalized.backend || createDefaultBackend({
            sourceRoot: normalized.sourceRoot,
            config: normalized.config,
            ignorePatterns: normalized.ignorePatterns
        })
    };
}

export { defaultSyncState, getDefaultStateFilePath, createDefaultStateStore, createDefaultBackend, resolveRuntimeDependencies };
export default {
    defaultSyncState,
    getDefaultStateFilePath,
    createDefaultStateStore,
    createDefaultBackend,
    resolveRuntimeDependencies
};
