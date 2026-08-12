// @ts-expect-error x-robot omits type conditions from its package exports.
import * as xRobot from "x-robot";
const { machine, init, initial, context, state, transition, entry, exit, immediate, guard } = xRobot;
// @ts-expect-error x-robot omits type conditions from its package exports.
import * as validation from "x-robot/validate";
const { validate } = validation;

type SyncOutcome = "ok" | "network" | "auth" | "conflict" | "config" | "unknown" | null;
type SyncMachineContext = {
  status?: string;
  hasPendingRemote?: boolean;
  pendingOperationId?: string | null;
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
  runSyncPipeline?: () => Promise<{
    kind?: SyncOutcome;
    retryable?: boolean;
    retryAfterMs?: number;
    safeMessage?: string;
  }>;
};

function hasPendingRemote(ctx: SyncMachineContext) {
  return ctx.hasPendingRemote === true;
}

function hasOutcome(outcome: SyncOutcome) {
  return (ctx: SyncMachineContext) => ctx.syncOutcome === outcome;
}

async function runSync(ctx: SyncMachineContext, payload: SyncPayload = {}) {
  const result = typeof payload.runSyncPipeline === "function" ? await payload.runSyncPipeline() : null;
  if (result === null || result.kind === null || typeof result.kind !== "string" || result.kind === "ok") {
    return {
      ...ctx,
      syncOutcome: "ok",
      hasPendingRemote: false,
      pendingOperationId: null,
      retryCount: 0,
      backoffUntil: null,
      lastErrorKind: null,
      lastErrorMessage: null
    };
  }
  return {
    ...ctx,
    syncOutcome: result.kind,
    lastErrorKind: result.kind,
    lastErrorMessage: result.safeMessage || "Synchronization failed",
    retryCount: (ctx.retryCount ?? 0) + 1,
    backoffUntil:
      result.retryable === true && typeof result.retryAfterMs === "number" && result.retryAfterMs > 0
        ? Date.now() + result.retryAfterMs
        : null,
    hasPendingRemote: true
  };
}

function createSyncMachine(config: SyncMachineContext = {}) {
  const syncMachine = machine(
    "Sync",
    init(
      initial(config.status || "healthy"),
      context({
        status: config.status || "healthy",
        hasPendingRemote: config.hasPendingRemote === true || config.status === "pending_remote",
        pendingOperationId: config.pendingOperationId ?? null,
        lastErrorKind: config.lastErrorKind ?? null,
        lastErrorMessage: config.lastErrorMessage ?? null,
        retryCount: config.retryCount ?? 0,
        backoffUntil: config.backoffUntil ?? null,
        lastSyncReason: config.lastSyncReason ?? null,
        lastPhase: config.lastPhase ?? null,
        lastSnapshotId: config.lastSnapshotId ?? null,
        lastSyncedSnapshotId: config.lastSyncedSnapshotId ?? null,
        syncOutcome: null
      })
    ),
    state(
      "healthy",
      transition(
        "LOCAL_PERSISTED",
        "pending_remote",
        exit((ctx: SyncMachineContext, payload: SyncPayload = {}) => {
          ctx.hasPendingRemote = true;
          ctx.lastSyncReason = payload.action ?? null;
        })
      )
    ),
    state("pending_remote", transition("SYNC_REQUESTED", "syncing", guard(hasPendingRemote))),
    state("syncing", entry(runSync, "route_after_sync", "route_after_sync")),
    state(
      "route_after_sync",
      immediate(
        "healthy",
        guard((ctx: SyncMachineContext) => ctx.syncOutcome === null || ctx.syncOutcome === "ok")
      ),
      immediate("degraded_network", guard(hasOutcome("network"))),
      immediate("degraded_auth", guard(hasOutcome("auth"))),
      immediate("conflict", guard(hasOutcome("conflict"))),
      immediate("failed")
    ),
    state("degraded_network", transition("SYNC_REQUESTED", "syncing", guard(hasPendingRemote))),
    state("degraded_auth", transition("SYNC_REQUESTED", "syncing", guard(hasPendingRemote))),
    state(
      "conflict",
      transition(
        "CONFLICT_RESOLVED",
        "pending_remote",
        exit((ctx: SyncMachineContext) => {
          ctx.syncOutcome = null;
        })
      )
    ),
    state(
      "failed",
      transition(
        "LOCAL_PERSISTED",
        "pending_remote",
        exit((ctx: SyncMachineContext, payload: SyncPayload = {}) => {
          ctx.hasPendingRemote = true;
          ctx.lastSyncReason = payload.action ?? null;
        })
      ),
      transition("SYNC_REQUESTED", "syncing", guard(hasPendingRemote))
    )
  );
  validate(syncMachine);
  return syncMachine;
}

export { createSyncMachine };
export default { createSyncMachine };
