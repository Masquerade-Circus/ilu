let log = require('../utils/log');
let {isSyncSetupError, syncSetupStatus, syncStatusFromResult} = require('./tui-sync-status');
let syncStatusListeners = new Set();
let pendingDebouncedSync = null;
let syncRunner = null;
let syncRunnerUnsubscribe = null;

const TUI_SYNC_DEBOUNCE_MS = 5000;

function hasSyncRemoteUrl(config) {
    return typeof config.remoteUrl === 'string' && config.remoteUrl.trim().length > 0;
}

function shouldLogSync(syncIndex) {
    if (!syncIndex || typeof syncIndex.getSyncConfig !== 'function') {
        return false;
    }

    let config;
    try {
        config = syncIndex.getSyncConfig();
    } catch (_) {
        return false;
    }

    return config && config.enabled === true && config.autoSync !== false && hasSyncRemoteUrl(config);
}

function shouldDebounceSync() {
    return syncRunner !== null;
}

function emitSyncStatus(event) {
    if (syncStatusListeners.size === 0) {
        return false;
    }

    for (let listener of syncStatusListeners) {
        try {
            listener(event);
        } catch (_) {}
    }

    return true;
}

function configureSyncRunner(runner) {
    if (syncRunnerUnsubscribe) {
        syncRunnerUnsubscribe();
        syncRunnerUnsubscribe = null;
    }

    syncRunner = runner && typeof runner.notifyLocalMutation === 'function' ? runner : null;

    if (syncRunner && typeof syncRunner.onEvent === 'function') {
        syncRunnerUnsubscribe = syncRunner.onEvent((event) => {
            emitSyncStatus(event);
        });
    }

    return () => {
        if (syncRunner === runner) {
            if (syncRunnerUnsubscribe) {
                syncRunnerUnsubscribe();
                syncRunnerUnsubscribe = null;
            }

            syncRunner = null;
        }
    };
}

function onSyncStatus(listener) {
    if (typeof listener !== 'function') {
        return () => {};
    }

    syncStatusListeners.add(listener);

    return () => {
        syncStatusListeners.delete(listener);
    };
}

function logSyncing(syncIndex) {
    if (!shouldLogSync(syncIndex)) {
        return;
    }

    try {
        log.info('Syncing...');
    } catch (_) {}
}

function activeSyncExecutor(syncIndex = null) {
    if (syncRunner && typeof syncRunner.notifyLocalMutation === 'function') {
        return syncRunner;
    }

    return syncIndex || require('./index');
}

function executorShouldLog(executor) {
    if (executor === syncRunner) {
        return false;
    }

    return shouldLogSync(executor);
}

function executorOwnsVisibleStatus(executor) {
    return executor === syncRunner && typeof executor.onEvent === 'function';
}

function runSyncNow(context, syncIndex = null) {
    return Promise.resolve()
        .then(() => {
            let activeSyncIndex = activeSyncExecutor(syncIndex);
            let canAutoSync = executorShouldLog(activeSyncIndex);
            let visibleStatusOwnedByExecutor = executorOwnsVisibleStatus(activeSyncIndex);
            let handledByUi = false;

            if (!visibleStatusOwnedByExecutor && (canAutoSync || activeSyncIndex === syncRunner)) {
                handledByUi = emitSyncStatus({state: 'syncing', message: 'Syncing...', context});
            }

            if (!handledByUi && activeSyncIndex !== syncRunner) {
                logSyncing(activeSyncIndex);
            }

            return activeSyncIndex.notifyLocalMutation(context)
                .then((result) => ({result, visibleStatusOwnedByExecutor}));
        })
        .then(({result, visibleStatusOwnedByExecutor}) => {
            let status = syncStatusFromResult(result);

            if (!visibleStatusOwnedByExecutor) {
                emitSyncStatus({...status, context});
            }

            return status;
        })
        .catch((error) => {
            let status = isSyncSetupError(error) ? syncSetupStatus() : {state: 'failed', message: 'Sync failed'};
            emitSyncStatus({...status, context});
            return status;
        });
}

function takePendingDebouncedSync() {
    if (pendingDebouncedSync === null) {
        return null;
    }

    let pending = pendingDebouncedSync;
    clearTimeout(pending.timer);
    pendingDebouncedSync = null;
    return pending;
}

function runPendingDebouncedSync() {
    let pending = takePendingDebouncedSync();

    if (pending === null) {
        return;
    }

    runSyncNow(pending.context);
}

function scheduleDebouncedSync(context) {
    let alreadyPending = pendingDebouncedSync !== null;

    if (alreadyPending) {
        clearTimeout(pendingDebouncedSync.timer);
    }

    pendingDebouncedSync = {
        context,
        timer: setTimeout(runPendingDebouncedSync, TUI_SYNC_DEBOUNCE_MS)
    };

    if (!alreadyPending) {
        emitSyncStatus({state: 'pending', message: 'Sync pending', context});
    }
}

function flushPending() {
    let pending = takePendingDebouncedSync();

    if (pending === null) {
        let runnerHasWork = syncRunner
            && typeof syncRunner.flush === 'function'
            && typeof syncRunner.hasPendingWork === 'function'
            && syncRunner.hasPendingWork();

        if (runnerHasWork) {
            return syncRunner.flush().then(() => true).catch(() => false);
        }

        return false;
    }

    return runSyncNow(pending.context)
        .then(() => {
            if (syncRunner && typeof syncRunner.flush === 'function') {
                return syncRunner.flush().then(() => true).catch(() => false);
            }

            return true;
        });
}

function notifySync(context) {
    Promise.resolve()
        .then(() => {
            if (shouldDebounceSync()) {
                scheduleDebouncedSync(context);
                return null;
            }

            if (syncStatusListeners.size === 0) {
                return runSyncNow(context);
            }

            let syncIndex = require('./index');
            return runSyncNow(context, syncIndex);
        })
        .catch((error) => {
            let status = isSyncSetupError(error) ? syncSetupStatus() : {state: 'failed', message: 'Sync failed'};
            emitSyncStatus({...status, context});
        });
}

notifySync.onSyncStatus = onSyncStatus;
notifySync.flushPending = flushPending;
notifySync.configureSyncRunner = configureSyncRunner;

module.exports = notifySync;
