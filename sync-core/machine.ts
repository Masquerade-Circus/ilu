import * as xRobot from 'x-robot';
let {
    machine,
    init,
    initial,
    context,
    state,
    transition,
    entry,
    exit,
    immediate,
    guard,
    invoke
} = xRobot;
import * as __cjsImport47 from 'x-robot/validate';
const { validate } = __cjsImport47;
type SyncOutcome = 'ok' | 'network' | 'auth' | 'conflict' | 'config' | 'unknown' | null;

type SyncMachineContext = {
    enabled?: boolean;
    status?: string;
    hasPendingRemote?: boolean;
    lastErrorKind?: string | null;
    lastErrorMessage?: string | null;
    retryCount?: number;
    backoffUntil?: number | null;
    lastSyncReason?: string | null;
    lastPhase?: string | null;
    lastSnapshotId?: string | null;
    lastSyncedSnapshotId?: string | null;
    syncOutcome?: SyncOutcome;
};

type SyncPayload = {
    action?: string | null;
    runSyncPipeline?: () => Promise<{kind?: SyncOutcome; error?: unknown}>;
};

function getInitialState(config: SyncMachineContext = {}) {
    if (!config.enabled) {
        return 'disabled';
    }

    return config.status || 'healthy';
}

function isEnabled(ctx: SyncMachineContext) {
    return ctx.enabled === true;
}

function hasPendingRemote(ctx: SyncMachineContext) {
    return ctx.hasPendingRemote === true;
}

function isHealthySyncOutcome(ctx: SyncMachineContext) {
    return !ctx.syncOutcome || ctx.syncOutcome === 'ok';
}

function isNetworkOutcome(ctx: SyncMachineContext) {
    return ctx.syncOutcome === 'network';
}

function isAuthOutcome(ctx: SyncMachineContext) {
    return ctx.syncOutcome === 'auth';
}

function isConflictOutcome(ctx: SyncMachineContext) {
    return ctx.syncOutcome === 'conflict';
}

function isFailedOutcome(ctx: SyncMachineContext) {
    return ctx.syncOutcome === 'config' || ctx.syncOutcome === 'unknown';
}

async function runSync(ctx: SyncMachineContext, payload: SyncPayload = {}) {
    let runner = payload.runSyncPipeline;

    if (typeof runner !== 'function') {
        return {
            ...ctx,
            syncOutcome: 'ok',
            hasPendingRemote: false
        };
    }

    let result = await runner();

    if (!result || !result.kind || result.kind === 'ok') {
        return {
            ...ctx,
            syncOutcome: 'ok',
            hasPendingRemote: false
        };
    }

    return {
        ...ctx,
        syncOutcome: result.kind,
        lastErrorKind: result.kind,
        lastErrorMessage: result.error instanceof Error ? result.error.message : String(result.error),
        retryCount: (ctx.retryCount || 0) + 1,
        hasPendingRemote: true
    };
}

function createSyncMachine(config: SyncMachineContext = {}) {
    let syncMachine = machine(
        'Sync',
        init(
            initial(getInitialState(config)),
            context({
                enabled: config.enabled === true,
                status: config.status || 'disabled',
                hasPendingRemote: config.hasPendingRemote === true || config.status === 'pending_remote',
                lastErrorKind: config.lastErrorKind || null,
                lastErrorMessage: config.lastErrorMessage || null,
                retryCount: config.retryCount || 0,
                backoffUntil: config.backoffUntil || null,
                lastSyncReason: config.lastSyncReason || null,
                lastPhase: config.lastPhase || null,
                lastSnapshotId: config.lastSnapshotId || null,
                lastSyncedSnapshotId: config.lastSyncedSnapshotId || null,
                syncOutcome: null
            })
        ),
        state(
            'disabled',
            transition('ENABLE', 'healthy', exit((ctx: SyncMachineContext) => {
                ctx.enabled = true;
            })),
            transition('CONFIG_BROKEN', 'misconfigured')
        ),
        state(
            'misconfigured',
            transition('DISABLE', 'disabled', exit((ctx: SyncMachineContext) => {
                ctx.enabled = false;
            })),
            transition('ENABLE', 'healthy', exit((ctx: SyncMachineContext) => {
                ctx.enabled = true;
            }))
        ),
        state(
            'healthy',
            transition('LOCAL_PERSISTED', 'pending_remote', exit((ctx: SyncMachineContext, payload: SyncPayload = {}) => {
                ctx.hasPendingRemote = true;
                ctx.lastSyncReason = payload.action || null;
            })),
            transition('DISABLE', 'disabled', exit((ctx: SyncMachineContext) => {
                ctx.enabled = false;
            })),
            transition('CONFIG_BROKEN', 'misconfigured')
        ),
        state(
            'pending_remote',
            transition('SYNC_REQUESTED', 'syncing', guard(isEnabled)),
            transition('RETRY', 'syncing', guard(isEnabled)),
            transition('DISABLE', 'disabled', exit((ctx: SyncMachineContext) => {
                ctx.enabled = false;
            })),
            transition('CONFIG_BROKEN', 'misconfigured')
        ),
        state(
            'syncing',
            entry(runSync, 'route_after_sync', 'route_after_sync')
        ),
        state(
            'route_after_sync',
            immediate('healthy', guard(isHealthySyncOutcome)),
            immediate('degraded_network', guard(isNetworkOutcome)),
            immediate('degraded_auth', guard(isAuthOutcome)),
            immediate('conflict', guard(isConflictOutcome)),
            immediate('failed', guard(isFailedOutcome)),
            immediate('failed')
        ),
        state(
            'degraded_network',
            transition('RETRY', 'syncing', guard(hasPendingRemote)),
            transition('DISABLE', 'disabled', exit((ctx: SyncMachineContext) => {
                ctx.enabled = false;
            }))
        ),
        state(
            'degraded_auth',
            transition('RETRY', 'syncing', guard(hasPendingRemote)),
            transition('DISABLE', 'disabled', exit((ctx: SyncMachineContext) => {
                ctx.enabled = false;
            }))
        ),
        state(
            'conflict',
            transition('CONFLICT_RESOLVED', 'pending_remote', exit((ctx: SyncMachineContext) => {
                ctx.syncOutcome = null;
            })),
            transition('DISABLE', 'disabled', exit((ctx: SyncMachineContext) => {
                ctx.enabled = false;
            }))
        ),
        state(
            'failed',
            transition('LOCAL_PERSISTED', 'pending_remote', exit((ctx: SyncMachineContext, payload: SyncPayload = {}) => {
                ctx.hasPendingRemote = true;
                ctx.lastSyncReason = payload.action || null;
            })),
            transition('SYNC_REQUESTED', 'syncing', guard(hasPendingRemote)),
            transition('RETRY', 'syncing', guard(hasPendingRemote)),
            transition('DISABLE', 'disabled', exit((ctx: SyncMachineContext) => {
                ctx.enabled = false;
            }))
        )
    );

    validate(syncMachine);
    return syncMachine;
}

export { createSyncMachine, invoke };
export default {
    createSyncMachine,
    invoke
};
