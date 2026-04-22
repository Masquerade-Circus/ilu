let {createSyncMachine, invoke} = require('./machine');
let {classifyGitError} = require('./git-cli-backend');

function isSyncConfigMisconfigured(config = {}) {
    return config.enabled === true && !config.remoteUrl;
}

function normalizeState(config, storedState = {}) {
    let status = storedState.status;

    if (status === 'misconfigured' && !isSyncConfigMisconfigured(config)) {
        status = config.enabled ? 'healthy' : 'disabled';
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

function createSyncRuntime({adapter, stateStore, backend} = {}) {
    if (!adapter || !stateStore || !backend) {
        throw new Error('Sync runtime requires adapter, stateStore and backend');
    }

    let config = adapter.getSyncConfig();
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
                sourceRoot: adapter.getSourceRoot(),
                entries: adapter.listTrackedEntries()
            });

            if (!backend.hasChanges()) {
                return {kind: 'ok'};
            }

            backend.commit(adapter.buildCommitMessage(context), {entries: adapter.listTrackedEntries()});
            await backend.fetch();
            await backend.integrate();
            await backend.push();
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
    createSyncRuntime
};
