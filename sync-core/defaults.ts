import path from 'node:path';
import * as __cjsImport39 from './backends/git-cli.ts';
const { createGitCliBackend } = __cjsImport39;
import * as __cjsImport40 from './state/file-store.ts';
const { createFileStateStore } = __cjsImport40;
type SyncConfig = {
    enabled: boolean;
    branch: string;
    remoteUrl: string | null;
    autoSync?: boolean;
    autoPull?: boolean;
    autoPush?: boolean;
};
type SyncMutationContext = {
    domain?: string;
    action?: string;
};
type DefaultStateOptions = {
    enabled?: boolean;
};
type DefaultDependencyOptions = {
    sourceRoot: string | null;
    config: SyncConfig;
    ignorePatterns: string[];
    buildCommitMessage: (context: SyncMutationContext) => string;
    stateStore?: ReturnType<typeof createFileStateStore>;
    backend?: ReturnType<typeof createGitCliBackend>;
};

function defaultSyncState({enabled = false}: DefaultStateOptions = {}) {
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

function getDefaultStateFilePath(sourceRoot: string) {
    return path.join(sourceRoot, '.config', 'sync-state.json');
}

function createDefaultStateStore({sourceRoot, config}: {sourceRoot: string; config: SyncConfig}) {
    return createFileStateStore({
        defaultState() {
            return defaultSyncState({enabled: config?.enabled === true});
        },
        getStateFilePath() {
            return getDefaultStateFilePath(sourceRoot);
        }
    });
}

function createDefaultBackend({sourceRoot, config, ignorePatterns = []}: {sourceRoot: string; config: SyncConfig; ignorePatterns?: string[]}) {
    return createGitCliBackend({
        repoPath: sourceRoot,
        branch: config.branch,
        remote: 'origin',
        remoteUrl: config.remoteUrl,
        ignorePatterns: [...ignorePatterns, '.config/sync-state.json']
    });
}

function resolveRuntimeDependencies(normalized: DefaultDependencyOptions) {
    if (!normalized.sourceRoot) {
        throw new Error('Sync runtime requires sourceRoot');
    }

    let sourceRoot = normalized.sourceRoot;

    return {
        ...normalized,
        sourceRoot,
        stateStore: normalized.stateStore || createDefaultStateStore({
            sourceRoot,
            config: normalized.config
        }),
        backend: normalized.backend || createDefaultBackend({
            sourceRoot,
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
