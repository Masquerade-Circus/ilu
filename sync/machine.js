let {
    machine,
    init,
    initial,
    context,
    state,
    transition,
    entry,
    immediate,
    guard,
    invoke
} = require('x-robot');
let {validate} = require('x-robot/validate');

function getInitialState(config = {}) {
    if (!config.enabled) {
        return 'disabled';
    }

    return config.status || 'healthy';
}

function isEnabled(ctx) {
    return ctx.enabled === true;
}

function hasPendingRemote(ctx) {
    return ctx.hasPendingRemote === true;
}

function isHealthySyncOutcome(ctx) {
    return !ctx.syncOutcome || ctx.syncOutcome === 'ok';
}

function isNetworkOutcome(ctx) {
    return ctx.syncOutcome === 'network';
}

function isAuthOutcome(ctx) {
    return ctx.syncOutcome === 'auth';
}

function isConflictOutcome(ctx) {
    return ctx.syncOutcome === 'conflict';
}

async function runSync(ctx, payload = {}) {
    let runner = payload.runSyncPipeline;

    if (typeof runner !== 'function') {
        ctx.syncOutcome = 'ok';
        ctx.hasPendingRemote = false;
        return;
    }

    let result = await runner();

    if (!result || !result.kind || result.kind === 'ok') {
        ctx.syncOutcome = 'ok';
        ctx.hasPendingRemote = false;
        return;
    }

    ctx.syncOutcome = result.kind;
    ctx.lastErrorKind = result.kind;
    ctx.hasPendingRemote = true;
}

function createSyncMachine(config = {}) {
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
                syncOutcome: null
            })
        ),
        state(
            'disabled',
            transition('ENABLE', 'healthy', guard(isEnabled)),
            transition('CONFIG_BROKEN', 'misconfigured')
        ),
        state(
            'misconfigured',
            transition('DISABLE', 'disabled', entry(ctx => {
                ctx.enabled = false;
            })),
            transition('ENABLE', 'healthy', guard(isEnabled))
        ),
        state(
            'healthy',
            transition('LOCAL_PERSISTED', 'pending_remote', entry((ctx, payload = {}) => {
                ctx.hasPendingRemote = true;
                ctx.lastSyncReason = payload.action || null;
            })),
            transition('DISABLE', 'disabled', entry(ctx => {
                ctx.enabled = false;
            })),
            transition('CONFIG_BROKEN', 'misconfigured')
        ),
        state(
            'pending_remote',
            transition('SYNC_REQUESTED', 'syncing', guard(isEnabled)),
            transition('RETRY', 'syncing', guard(isEnabled)),
            transition('DISABLE', 'disabled', entry(ctx => {
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
            immediate('misconfigured')
        ),
        state(
            'degraded_network',
            transition('RETRY', 'syncing', guard(hasPendingRemote)),
            transition('DISABLE', 'disabled', entry(ctx => {
                ctx.enabled = false;
            }))
        ),
        state(
            'degraded_auth',
            transition('RETRY', 'syncing', guard(hasPendingRemote)),
            transition('DISABLE', 'disabled', entry(ctx => {
                ctx.enabled = false;
            }))
        ),
        state(
            'conflict',
            transition('CONFLICT_RESOLVED', 'pending_remote', entry(ctx => {
                ctx.syncOutcome = null;
            })),
            transition('DISABLE', 'disabled', entry(ctx => {
                ctx.enabled = false;
            }))
        )
    );

    validate(syncMachine);
    return syncMachine;
}

module.exports = {
    createSyncMachine,
    invoke
};
