import { createPrivateStateStore } from "./state/private-state.js";
import type {
  NormalizedSyncState,
  PersistedSyncState,
  ResolvedSyncRuntimeOptions,
  SyncFailure,
  SyncFailureKind,
  SyncMutationContext,
  SyncRequest,
  SyncRuntime
} from "./types.js";

type Operation = {
  operationId: string;
  context: SyncMutationContext;
  started: boolean;
  rehydrated: boolean;
  waitingCallers: number;
  timer: ReturnType<typeof setTimeout> | null;
  promise: Promise<NormalizedSyncState>;
  resolve: (state: NormalizedSyncState) => void;
  reject: (error: unknown) => void;
};

const FAILURE_KINDS = new Set<SyncFailureKind>(["network", "auth", "conflict", "config", "unknown"]);
let operationSequence = 0;

function createOperationId() {
  operationSequence += 1;
  return `${Date.now().toString(36)}_${operationSequence.toString(36)}`;
}

function publicState(state: PersistedSyncState): NormalizedSyncState {
  return {
    status: state.status,
    hasPendingRemote: state.hasPendingRemote,
    pendingOperationId: state.pendingOperationId,
    retryCount: state.retryCount,
    backoffUntil: state.backoffUntil,
    lastErrorKind: state.lastErrorKind,
    lastErrorMessage: state.lastErrorMessage,
    lastSyncReason: state.lastSyncReason,
    lastPhase: state.lastPhase,
    lastSnapshotId: state.lastSnapshotId,
    lastSyncedSnapshotId: state.lastSyncedSnapshotId
  };
}

function normalizeFailure(failure: unknown): SyncFailure {
  if (
    failure === null ||
    typeof failure !== "object" ||
    !FAILURE_KINDS.has((failure as SyncFailure).kind) ||
    typeof (failure as SyncFailure).retryable !== "boolean"
  ) {
    return { kind: "unknown", retryable: false, safeMessage: "Synchronization failed" };
  }
  const candidate = failure as SyncFailure;
  const normalized: SyncFailure = { kind: candidate.kind, retryable: candidate.retryable };
  if (
    typeof candidate.retryAfterMs === "number" &&
    Number.isFinite(candidate.retryAfterMs) &&
    candidate.retryAfterMs >= 0
  ) {
    normalized.retryAfterMs = candidate.retryAfterMs;
  }
  if (typeof candidate.safeMessage === "string" && candidate.safeMessage.trim().length > 0) {
    normalized.safeMessage = candidate.safeMessage;
  }
  return normalized;
}

function failureStatus(kind: SyncFailureKind): NormalizedSyncState["status"] {
  if (kind === "network") {
    return "degraded_network";
  }
  if (kind === "auth") {
    return "degraded_auth";
  }
  if (kind === "conflict") {
    return "conflict";
  }
  return "failed";
}

function createOperation({
  operationId,
  context,
  rehydrated = false,
  waitingCallers = 0
}: {
  operationId: string;
  context: SyncMutationContext;
  rehydrated?: boolean;
  waitingCallers?: number;
}): Operation {
  let resolve!: (state: NormalizedSyncState) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<NormalizedSyncState>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return {
    operationId,
    context: { ...context },
    started: false,
    rehydrated,
    waitingCallers,
    timer: null,
    promise,
    resolve,
    reject
  };
}

async function createSyncRuntimeFromResolvedOptions(options: ResolvedSyncRuntimeOptions): Promise<SyncRuntime> {
  const store = createPrivateStateStore(options.rootPath);
  let state = store.loadState();
  let active: Operation | null = null;
  let trailing: Operation | null = null;

  function persist() {
    state = store.saveState(state);
  }

  function retryDelay(retryCount: number, retryAfterMs = 0) {
    const exponential = Math.min(
      options.maxRetryDelayMs,
      options.retryDelayMs * options.retryBackoffFactor ** Math.max(0, retryCount)
    );
    return Math.max(exponential, retryAfterMs);
  }

  function wait(operation: Operation, delayMs: number, unref: boolean) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        operation.timer = null;
        resolve();
      }, delayMs);
      operation.timer = timer;
      if (unref && operation.waitingCallers === 0 && typeof timer.unref === "function") {
        timer.unref();
      }
    });
  }

  async function attempt(operation: Operation) {
    const request: SyncRequest = {
      operationId: operation.operationId,
      rootPath: options.rootPath,
      excludePatterns: [...options.excludePatterns],
      context: { ...operation.context }
    };
    try {
      await options.backend.synchronize(request);
      return null;
    } catch (error) {
      try {
        return normalizeFailure(options.backend.classifyError(error, request));
      } catch {
        return { kind: "unknown", retryable: false, safeMessage: "Synchronization failed" } as SyncFailure;
      }
    }
  }

  function finishSuccess(operation: Operation) {
    state = {
      ...state,
      status: "healthy",
      hasPendingRemote: false,
      pendingOperationId: null,
      retryCount: 0,
      backoffUntil: null,
      lastErrorKind: null,
      lastErrorMessage: null,
      lastSyncReason: typeof operation.context.action === "string" ? operation.context.action : state.lastSyncReason,
      retryable: false,
      pendingContext: {}
    };
    persist();
    operation.resolve(publicState(state));
    active = null;

    if (trailing !== null) {
      const next = trailing;
      trailing = null;
      active = next;
      queueMicrotask(() => void runOperation(next));
    }
  }

  function finishTerminal(operation: Operation, failure: SyncFailure) {
    state = {
      ...state,
      status: failureStatus(failure.kind),
      hasPendingRemote: true,
      pendingOperationId: operation.operationId,
      backoffUntil: null,
      lastErrorKind: failure.kind,
      lastErrorMessage: failure.safeMessage ?? "Synchronization failed",
      retryable: failure.retryable,
      pendingContext: { ...operation.context }
    };

    if (trailing !== null) {
      state.pendingOperationId = trailing.operationId;
      state.pendingContext = { ...trailing.context };
      state.lastSyncReason =
        typeof trailing.context.action === "string" ? trailing.context.action : state.lastSyncReason;
    }
    persist();
    const terminal = publicState(state);
    operation.resolve(terminal);
    trailing?.resolve(terminal);
    active = null;
    trailing = null;
  }

  async function runOperation(operation: Operation) {
    operation.started = true;
    try {
      if (operation.rehydrated && state.backoffUntil !== null) {
        await wait(operation, Math.max(0, state.backoffUntil - Date.now()), true);
        state.retryCount += 1;
        state.backoffUntil = null;
        persist();
      } else if (!operation.rehydrated) {
        state = {
          ...state,
          status: "pending_remote",
          hasPendingRemote: true,
          pendingOperationId: operation.operationId,
          retryCount: 0,
          backoffUntil: null,
          lastErrorKind: null,
          lastErrorMessage: null,
          lastSyncReason:
            typeof operation.context.action === "string" ? operation.context.action : state.lastSyncReason,
          retryable: false,
          pendingContext: { ...operation.context }
        };
        persist();
      }

      while (true) {
        const failure = await attempt(operation);
        if (failure === null) {
          finishSuccess(operation);
          return;
        }
        if (!failure.retryable || state.retryCount >= options.maxRetries) {
          finishTerminal(operation, failure);
          return;
        }

        const delay = retryDelay(state.retryCount, failure.retryAfterMs);
        state = {
          ...state,
          status: failureStatus(failure.kind),
          hasPendingRemote: true,
          pendingOperationId: operation.operationId,
          backoffUntil: Date.now() + delay,
          lastErrorKind: failure.kind,
          lastErrorMessage: failure.safeMessage ?? "Synchronization failed",
          retryable: true,
          pendingContext: { ...operation.context }
        };
        persist();
        await wait(operation, delay, operation.rehydrated);
        state.retryCount += 1;
        state.backoffUntil = null;
        persist();
        operation.rehydrated = false;
      }
    } catch (error) {
      operation.reject(error);
      trailing?.reject(error);
      active = null;
      trailing = null;
    }
  }

  persist();

  if (state.hasPendingRemote && state.retryable && state.retryCount < options.maxRetries) {
    active = createOperation({
      operationId: state.pendingOperationId ?? createOperationId(),
      context: state.pendingContext,
      rehydrated: true
    });
    void active.promise.catch(() => {});
    void runOperation(active);
  }

  return {
    sync(context: SyncMutationContext = {}) {
      if (active === null) {
        active = createOperation({
          operationId:
            state.hasPendingRemote && state.pendingOperationId !== null
              ? state.pendingOperationId
              : createOperationId(),
          context: { ...state.pendingContext, ...context },
          waitingCallers: 1
        });
        const operation = active;
        queueMicrotask(() => void runOperation(operation));
        return operation.promise;
      }

      if (!active.started) {
        active.context = { ...active.context, ...context };
        active.waitingCallers += 1;
        return active.promise;
      }

      active.waitingCallers += 1;
      if (trailing === null) {
        trailing = createOperation({ operationId: createOperationId(), context, waitingCallers: 1 });
      } else {
        trailing.context = { ...trailing.context, ...context };
        trailing.waitingCallers += 1;
      }
      active.timer?.ref();
      return trailing.promise;
    },
    getSyncStatus() {
      return publicState(state);
    }
  };
}

export { createSyncRuntimeFromResolvedOptions };
