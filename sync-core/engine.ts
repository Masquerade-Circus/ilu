let {createSyncMachine, invoke} = require('./machine');
let {classifyGitError} = require('./contracts');
let {normalizeRuntimeOptions} = require('./runtime-options');
let {resolveRuntimeDependencies} = require('./defaults');

type SyncStatus =
    | 'disabled'
    | 'healthy'
    | 'pending_remote'
    | 'syncing'
    | 'route_after_sync'
    | 'misconfigured'
    | 'degraded_network'
    | 'degraded_auth'
    | 'conflict'
    | 'failed';

type SyncConfig = {
    enabled: boolean;
    remoteUrl: string | null;
    autoSync?: boolean;
    autoPull?: boolean;
    autoPush?: boolean;
};

type SyncState = {
    enabled?: boolean;
    status?: SyncStatus;
    hasPendingRemote?: boolean;
    retryCount?: number;
    backoffUntil?: number | null;
    lastErrorKind?: string | null;
    lastErrorMessage?: string | null;
    lastSyncReason?: string | null;
    lastPhase?: string | null;
    lastSnapshotId?: string | null;
    lastSyncedSnapshotId?: string | null;
};

type NormalizedSyncState = {
    enabled: boolean;
    status: Exclude<SyncStatus, 'syncing' | 'route_after_sync'>;
    hasPendingRemote: boolean;
    retryCount: number;
    backoffUntil: number | null;
    lastErrorKind: string | null;
    lastErrorMessage: string | null;
    lastSyncReason: string | null;
    lastPhase: string | null;
    lastSnapshotId: string | null;
    lastSyncedSnapshotId: string | null;
};

type SyncMutationContext = {
    domain?: string;
    action?: string;
};

type SyncPipelineResult = {
    kind: string;
    error?: unknown;
};

type SyncRuntimeOptions = Record<string, unknown>;

type SyncBackend = {
    ensureReady: () => void;
    syncWorkingTree: (options: {sourceRoot: string; ignorePatterns: string[]}) => void;
    hasChanges: () => boolean;
    commit: (message: string) => void;
    fetch: () => Promise<void> | void;
    integrate: () => Promise<void> | void;
    push: () => Promise<void> | void;
    classifyGitError?: (error: unknown) => SyncPipelineResult;
};

type SyncStateStore = {
    loadState: () => SyncState;
    saveState: (state: NormalizedSyncState) => NormalizedSyncState;
};

type ResolvedSyncRuntimeOptions = {
    config: SyncConfig;
    sourceRoot: string;
    ignorePatterns: string[];
    buildCommitMessage: (context: SyncMutationContext) => string;
    stateStore: SyncStateStore;
    backend: SyncBackend;
};

function isSyncConfigMisconfigured(config: Partial<SyncConfig> = {}) {
    return config.enabled === true && !config.remoteUrl;
}

function isTransientPersistedStatus(status: SyncState['status']) {
    return status === 'syncing' || status === 'route_after_sync';
}

function normalizeState(config: SyncConfig, storedState: SyncState = {}): NormalizedSyncState {
    let isMisconfigured = isSyncConfigMisconfigured(config);
    let status = storedState.status;

    if (isTransientPersistedStatus(status)) {
        status = config.enabled ? 'pending_remote' : 'disabled';
    }

    if (isMisconfigured) {
        status = 'misconfigured';
    }

    if (status === 'misconfigured' && !isMisconfigured) {
        status = config.enabled ? 'healthy' : 'disabled';
    }

    if (status === 'disabled' && config.enabled) {
        status = 'healthy';
    }

    if (status === 'healthy' && !config.enabled) {
        status = 'disabled';
    }

    let hasPendingRemote = storedState.hasPendingRemote === true;
    let lastErrorKind = storedState.lastErrorKind || null;
    let lastErrorMessage = storedState.lastErrorMessage || null;

    if (status === 'healthy') {
        hasPendingRemote = false;
        lastErrorKind = null;
        lastErrorMessage = null;
    }

    return {
        enabled: config.enabled === true,
        status: (status || (config.enabled ? 'healthy' : 'disabled')) as NormalizedSyncState['status'],
        hasPendingRemote,
        retryCount: storedState.retryCount || 0,
        backoffUntil: storedState.backoffUntil || null,
        lastErrorKind,
        lastErrorMessage,
        lastSyncReason: storedState.lastSyncReason || null,
        lastPhase: storedState.lastPhase || null,
        lastSnapshotId: storedState.lastSnapshotId || null,
        lastSyncedSnapshotId: storedState.lastSyncedSnapshotId || null
    };
}

function createSyncRuntime(options: SyncRuntimeOptions = {}) {
    let normalized = resolveRuntimeDependencies(normalizeRuntimeOptions(options));
    return createSyncRuntimeFromResolvedOptions(normalized);
}

function createSyncRuntimeFromResolvedOptions(normalized: ResolvedSyncRuntimeOptions) {
    let {
        config,
        sourceRoot,
        ignorePatterns,
        buildCommitMessage,
        stateStore,
        backend
    } = normalized;
    let storedState = stateStore.loadState();
    let persisted = normalizeState(config, storedState);
    let syncMachine = createSyncMachine(persisted);
    let inFlight: Promise<void> | null = null;

    function persistCurrentState() {
        persisted = stateStore.saveState({
            ...persisted,
            enabled: syncMachine.context.enabled,
            status: syncMachine.current,
            hasPendingRemote: syncMachine.context.hasPendingRemote,
            retryCount: syncMachine.context.retryCount,
            backoffUntil: syncMachine.context.backoffUntil,
            lastErrorKind: syncMachine.context.lastErrorKind,
            lastErrorMessage: syncMachine.context.lastErrorMessage,
            lastSyncReason: syncMachine.context.lastSyncReason,
            lastPhase: syncMachine.context.lastPhase,
            lastSnapshotId: syncMachine.context.lastSnapshotId,
            lastSyncedSnapshotId: syncMachine.context.lastSyncedSnapshotId
        });

        return persisted;
    }

    async function runSyncPipeline(context: SyncMutationContext = {}): Promise<SyncPipelineResult> {
        try {
            backend.ensureReady();
            backend.syncWorkingTree({
                sourceRoot,
                ignorePatterns
            });

            if (!backend.hasChanges()) {
                return {kind: 'ok'};
            }

            backend.commit(buildCommitMessage(context));

            if (config.autoPull !== false) {
                await backend.fetch();
                await backend.integrate();
            }

            if (config.autoPush !== false) {
                await backend.push();
            }
            return {kind: 'ok'};
        } catch (error: unknown) {
            let classified = typeof backend.classifyGitError === 'function'
                ? backend.classifyGitError(error)
                : classifyGitError(error);

            return {
                ...classified,
                error: classified.error ?? error
            };
        }
    }

    async function requestSync(context: SyncMutationContext = {}, transitionName = 'SYNC_REQUESTED') {
        if (inFlight) {
            return inFlight;
        }

        inFlight = (async () => {
            await invoke(syncMachine, transitionName, {
                ...context,
                runSyncPipeline: () => runSyncPipeline(context)
            });
            persistCurrentState();
        })();

        try {
            await inFlight;
        } finally {
            inFlight = null;
        }
    }

    return {
        async notifyLocalMutation(context: SyncMutationContext = {}) {
            if (!inFlight && syncMachine.current !== 'pending_remote' && syncMachine.current !== 'syncing') {
                await invoke(syncMachine, 'LOCAL_PERSISTED', context);
                persistCurrentState();
            } else {
                syncMachine.context = {
                    ...syncMachine.context,
                    hasPendingRemote: true,
                    lastSyncReason: context.action || syncMachine.context.lastSyncReason
                };
                persistCurrentState();
            }

            if (config.autoSync !== false) {
                await requestSync(context);
            }

            return persistCurrentState();
        },
        getSyncStatus() {
            return persistCurrentState();
        },
        async retry(context: SyncMutationContext = {}) {
            let transitionName = syncMachine.current === 'degraded_network' || syncMachine.current === 'degraded_auth' || syncMachine.current === 'failed' || syncMachine.current === 'pending_remote'
                ? 'RETRY'
                : 'SYNC_REQUESTED';

            return requestSync(context, transitionName);
        },
        async enable() {
            await invoke(syncMachine, 'ENABLE');
            return persistCurrentState();
        },
        async disable() {
            await invoke(syncMachine, 'DISABLE');
            return persistCurrentState();
        },
        machine: syncMachine
    };
}

module.exports = {
    createSyncRuntime,
    createSyncRuntimeFromResolvedOptions
};
