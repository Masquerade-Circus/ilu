import log from '../utils/log.ts';
import defaultSyncIndex from './index.ts';
import * as __cjsImport28 from './tui-sync-status.ts';
const { isSyncSetupError, syncSetupStatus, syncStatusFromResult } = __cjsImport28;
type SyncContext = Record<string, unknown>;
type SyncEvent = {state: string; message?: string; context?: SyncContext};
type SyncListener = (event: SyncEvent) => void;
type SyncConfig = {enabled?: boolean; autoSync?: boolean; remoteUrl?: string | null};
type SyncExecutor = {
    getSyncConfig?: () => SyncConfig;
    sync: (context: SyncContext) => Promise<unknown>;
    onEvent?: (listener: SyncListener) => () => void;
    hasPendingWork?: () => boolean;
    flush?: () => Promise<unknown>;
};
type PendingDebouncedSync = {context: SyncContext; timer: ReturnType<typeof setTimeout>};
type SyncRunResult = {
    result: unknown;
    visibleStatusOwnedByExecutor: boolean;
    terminalEventVersion: number;
};

let syncStatusListeners = new Set<SyncListener>();
let pendingDebouncedSync: PendingDebouncedSync | null = null;
let syncRunner: SyncExecutor | null = null;
let syncExecutor: SyncExecutor | null = null;
let syncRunnerUnsubscribe: (() => void) | null = null;
let syncRunnerTerminalEventVersion = 0;

const TUI_SYNC_DEBOUNCE_MS = 5000;

function hasSyncRemoteUrl(config: SyncConfig) {
    return typeof config.remoteUrl === 'string' && config.remoteUrl.trim().length > 0;
}

function shouldLogSync(syncIndex: SyncExecutor | null) {
    if (!syncIndex || typeof syncIndex.getSyncConfig !== 'function') {
        return false;
    }

    let config: SyncConfig;
    try {
        config = syncIndex.getSyncConfig();
    } catch (_error: unknown) {
        void _error;
        return false;
    }

    return config && config.enabled === true && config.autoSync !== false && hasSyncRemoteUrl(config);
}

function shouldDebounceSync() {
    return syncRunner !== null;
}

function emitSyncStatus(event: SyncEvent) {
    if (syncStatusListeners.size === 0) {
        return false;
    }

    for (let listener of syncStatusListeners) {
        try {
            listener(event);
        } catch (_error: unknown) {
            void _error;
        }
    }

    return true;
}

function isTerminalSyncEvent(event: SyncEvent) {
    return event
        && (event.state === 'synced'
            || event.state === 'pending'
            || event.state === 'failed'
            || event.state === 'setup'
            || event.state === 'idle');
}

function configureSyncRunner(runner: SyncExecutor | null) {
    if (syncRunnerUnsubscribe) {
        syncRunnerUnsubscribe();
        syncRunnerUnsubscribe = null;
    }

    syncRunner = runner && typeof runner.sync === 'function' ? runner : null;

    if (syncRunner && typeof syncRunner.onEvent === 'function') {
        syncRunnerUnsubscribe = syncRunner.onEvent((event: SyncEvent) => {
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

function configureSyncExecutor(executor: SyncExecutor | null) {
    let previousExecutor = syncExecutor;
    syncExecutor = executor && typeof executor.sync === 'function' ? executor : null;

    return () => {
        syncExecutor = previousExecutor;
    };
}

function onSyncStatus(listener: SyncListener) {
    if (typeof listener !== 'function') {
        return () => {};
    }

    syncStatusListeners.add(listener);

    return () => {
        syncStatusListeners.delete(listener);
    };
}

function logSyncing(syncIndex: SyncExecutor | null) {
    if (!shouldLogSync(syncIndex)) {
        return;
    }

    try {
        log.info('Syncing...');
    } catch (_error: unknown) {
        void _error;
    }
}

function activeSyncExecutor(syncIndex: SyncExecutor | null = defaultSyncIndex): SyncExecutor {
    if (syncRunner && typeof syncRunner.sync === 'function') {
        return syncRunner;
    }

    if (syncExecutor && typeof syncExecutor.sync === 'function') {
        return syncExecutor;
    }

    return syncIndex || defaultSyncIndex;
}

function executorShouldLog(executor: SyncExecutor) {
    if (executor === syncRunner) {
        return false;
    }

    return shouldLogSync(executor);
}

function executorOwnsVisibleStatus(executor: SyncExecutor) {
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

function runSyncNow(context: SyncContext, syncIndex: SyncExecutor | null = null) {
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

            return activeSyncIndex.sync(context)
                .then((result: unknown) => ({result, visibleStatusOwnedByExecutor, terminalEventVersion}));
        })
        .then(({result, visibleStatusOwnedByExecutor, terminalEventVersion}: SyncRunResult) => {
            let status = syncStatusFromResult(result);

            if (!visibleStatusOwnedByExecutor
                || (syncRunnerTerminalEventVersion === terminalEventVersion && canSynthesizeTerminalStatus())) {
                emitSyncStatus({...status, context});
            }

            return status;
        })
        .catch((error: unknown) => {
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

function scheduleDebouncedSync(context: SyncContext) {
    let alreadyPending = pendingDebouncedSync !== null;

    if (pendingDebouncedSync !== null) {
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
        let runner = syncRunner;

        if (runner !== null && typeof runner.flush === 'function' && syncRunnerHasPendingWork()) {
            return runner.flush().then(() => true).catch(() => false);
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

function notifySync(context: SyncContext) {
    Promise.resolve()
        .then(() => {
            if (shouldDebounceSync()) {
                scheduleDebouncedSync(context);
                return null;
            }

            return runSyncNow(context, defaultSyncIndex);
        })
        .catch((error: unknown) => {
            let status = isSyncSetupError(error) ? syncSetupStatus() : {state: 'failed', message: 'Sync failed'};
            emitSyncStatus({...status, context});
        });
}

notifySync.onSyncStatus = onSyncStatus;
notifySync.flushPending = flushPending;
notifySync.configureSyncRunner = configureSyncRunner;
notifySync.configureSyncExecutor = configureSyncExecutor;

export { notifySync, onSyncStatus, flushPending, configureSyncRunner, configureSyncExecutor };
export default notifySync;
