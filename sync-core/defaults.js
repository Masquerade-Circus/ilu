let path = require('node:path');
let {createGitCliBackend} = require('./backends/git-cli');
let {createFileStateStore} = require('./state/file-store');

function defaultSyncState({enabled = false} = {}) {
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

function getDefaultStateFilePath(sourceRoot) {
    return path.join(sourceRoot, '.config', 'sync-state.json');
}

function createDefaultStateStore({sourceRoot, config} = {}) {
    return createFileStateStore({
        defaultState() {
            return defaultSyncState({enabled: config?.enabled === true});
        },
        getStateFilePath() {
            return getDefaultStateFilePath(sourceRoot);
        }
    });
}

function createDefaultBackend({sourceRoot, config, ignorePatterns = []} = {}) {
    return createGitCliBackend({
        repoPath: sourceRoot,
        branch: config.branch,
        remote: 'origin',
        remoteUrl: config.remoteUrl,
        ignorePatterns: [...ignorePatterns, '.config/sync-state.json']
    });
}

function resolveRuntimeDependencies(normalized) {
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

module.exports = {
    defaultSyncState,
    getDefaultStateFilePath,
    createDefaultStateStore,
    createDefaultBackend,
    resolveRuntimeDependencies
};
