let log = require('../utils/log');
let {isSyncSetupError, syncSetupStatus, syncStatusFromResult} = require('./tui-sync-status');
let syncStatusListeners = new Set<any>();
let pendingDebouncedSync: any = null;
let syncRunner: any = null;
let syncRunnerUnsubscribe: any = null;
let syncRunnerTerminalEventVersion = 0;

const TUI_SYNC_DEBOUNCE_MS = 5000;

function hasSyncRemoteUrl(config: any) {
    return typeof config.remoteUrl === 'string' && config.remoteUrl.trim().length > 0;
}

function shouldLogSync(syncIndex: any) {
    if (!syncIndex || typeof syncIndex.getSyncConfig !== 'function') {
        return false;
    }

    let config: any;
    try {
        config = syncIndex.getSyncConfig();
    } catch (_: any) {
        return false;
    }

    return config && config.enabled === true && config.autoSync !== false && hasSyncRemoteUrl(config);
}

function shouldDebounceSync() {
    return syncRunner !== null;
}

function emitSyncStatus(event: any) {
    if (syncStatusListeners.size === 0) {
        return false;
    }

    for (let listener of syncStatusListeners) {
        try {
            listener(event);
        } catch (_: any) {}
    }

    return true;
}

function isTerminalSyncEvent(event: any) {
    return event
        && (event.state === 'synced'
            || event.state === 'pending'
            || event.state === 'failed'
            || event.state === 'setup'
            || event.state === 'idle');
}

function configureSyncRunner(runner: any) {
    if (syncRunnerUnsubscribe) {
        syncRunnerUnsubscribe();
        syncRunnerUnsubscribe = null;
    }

    syncRunner = runner && typeof runner.notifyLocalMutation === 'function' ? runner : null;

    if (syncRunner && typeof syncRunner.onEvent === 'function') {
        syncRunnerUnsubscribe = syncRunner.onEvent((event: any) => {
            if (isTerminalSyncEvent(event)) {
                syncRunnerTerminalEventVersion += 1;
            }

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

function onSyncStatus(listener: any) {
    if (typeof listener !== 'function') {
        return () => {};
    }

    syncStatusListeners.add(listener);

    return () => {
        syncStatusListeners.delete(listener);
    };
}

function logSyncing(syncIndex: any) {
    if (!shouldLogSync(syncIndex)) {
        return;
    }

    try {
        log.info('Syncing...');
    } catch (_: any) {}
}

function activeSyncExecutor(syncIndex: any = null) {
    if (syncRunner && typeof syncRunner.notifyLocalMutation === 'function') {
        return syncRunner;
    }

    return syncIndex || require('./index');
}

function executorShouldLog(executor: any) {
    if (executor === syncRunner) {
        return false;
    }

    return shouldLogSync(executor);
}

function executorOwnsVisibleStatus(executor: any) {
    return executor === syncRunner && typeof executor.onEvent === 'function';
}

function syncRunnerHasPendingWork() {
    return syncRunner
        && typeof syncRunner.hasPendingWork === 'function'
        && syncRunner.hasPendingWork();
}

function canSynthesizeTerminalStatus() {
    return pendingDebouncedSync === null && !syncRunnerHasPendingWork();
}

function runSyncNow(context: any, syncIndex: any = null) {
    return Promise.resolve()
        .then(() => {
            let activeSyncIndex = activeSyncExecutor(syncIndex);
            let canAutoSync = executorShouldLog(activeSyncIndex);
            let visibleStatusOwnedByExecutor = executorOwnsVisibleStatus(activeSyncIndex);
            let terminalEventVersion = syncRunnerTerminalEventVersion;
            let handledByUi = false;

            if (!visibleStatusOwnedByExecutor && (canAutoSync || activeSyncIndex === syncRunner)) {
                handledByUi = emitSyncStatus({state: 'syncing', message: 'Syncing...', context});
            }

            if (!handledByUi && activeSyncIndex !== syncRunner) {
                logSyncing(activeSyncIndex);
            }

            return activeSyncIndex.notifyLocalMutation(context)
                .then((result: any) => ({result, visibleStatusOwnedByExecutor, terminalEventVersion}));
        })
        .then(({result, visibleStatusOwnedByExecutor, terminalEventVersion}: any) => {
            let status = syncStatusFromResult(result);

            if (!visibleStatusOwnedByExecutor
                || (syncRunnerTerminalEventVersion === terminalEventVersion && canSynthesizeTerminalStatus())) {
                emitSyncStatus({...status, context});
            }

            return status;
        })
        .catch((error: any) => {
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

function scheduleDebouncedSync(context: any) {
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
            && syncRunnerHasPendingWork();

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

function notifySync(context: any) {
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
        .catch((error: any) => {
            let status = isSyncSetupError(error) ? syncSetupStatus() : {state: 'failed', message: 'Sync failed'};
            emitSyncStatus({...status, context});
        });
}

notifySync.onSyncStatus = onSyncStatus;
notifySync.flushPending = flushPending;
notifySync.configureSyncRunner = configureSyncRunner;

module.exports = notifySync;
