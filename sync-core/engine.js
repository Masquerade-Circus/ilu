let {createSyncMachine, invoke} = require('./machine');
let {classifyGitError} = require('./contracts');
let {normalizeRuntimeOptions} = require('./runtime-options');
let {resolveRuntimeDependencies} = require('./defaults');

function isSyncConfigMisconfigured(config = {}) {
    return config.enabled === true && !config.remoteUrl;
}

function normalizeState(config, storedState = {}) {
    let isMisconfigured = isSyncConfigMisconfigured(config);
    let status = storedState.status;

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
        status: status || (config.enabled ? 'healthy' : 'disabled'),
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

function createSyncRuntime(options = {}) {
    let normalized = resolveRuntimeDependencies(normalizeRuntimeOptions(options));
    return createSyncRuntimeFromResolvedOptions(normalized);
}

function createSyncRuntimeFromResolvedOptions(normalized) {
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
    let inFlight = null;

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

    async function runSyncPipeline(context = {}) {
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
        } catch (error) {
            let classified = typeof backend.classifyGitError === 'function'
                ? backend.classifyGitError(error)
                : classifyGitError(error);

            syncMachine.context.syncOutcome = classified.kind;
            syncMachine.context.lastErrorMessage = error.message;
            syncMachine.context.lastErrorKind = classified.kind;
            syncMachine.context.retryCount = (syncMachine.context.retryCount || 0) + 1;
            return classified;
        }
    }

    async function requestSync(context = {}, transitionName = 'SYNC_REQUESTED') {
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
        async notifyLocalMutation(context = {}) {
            if (!inFlight && syncMachine.current !== 'pending_remote' && syncMachine.current !== 'syncing') {
                await invoke(syncMachine, 'LOCAL_PERSISTED', context);
                persistCurrentState();
            } else {
                syncMachine.context.hasPendingRemote = true;
                syncMachine.context.lastSyncReason = context.action || syncMachine.context.lastSyncReason;
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
        async retry(context = {}) {
            let transitionName = syncMachine.current === 'degraded_network' || syncMachine.current === 'degraded_auth' || syncMachine.current === 'pending_remote'
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
