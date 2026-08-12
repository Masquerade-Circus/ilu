// src/state/private-state.ts
import fs from "node:fs";
import path from "node:path";
var STATUSES = /* @__PURE__ */ new Set(["healthy", "pending_remote", "degraded_network", "degraded_auth", "conflict", "failed"]);
var FAILURE_KINDS = /* @__PURE__ */ new Set(["network", "auth", "conflict", "config", "unknown"]);
var UNSUPPORTED_DIRECTORY_FSYNC_CODES = /* @__PURE__ */ new Set(["EINVAL", "ENOTSUP", "ENOSYS"]);
function defaultState() {
  return {
    status: "healthy",
    hasPendingRemote: false,
    pendingOperationId: null,
    retryCount: 0,
    backoffUntil: null,
    lastErrorKind: null,
    lastErrorMessage: null,
    lastSyncReason: null,
    lastPhase: null,
    lastSnapshotId: null,
    lastSyncedSnapshotId: null,
    retryable: false,
    pendingContext: {}
  };
}
function isNullableString(value) {
  return value === null || typeof value === "string";
}
function validatePersistedState(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid persisted sync state");
  }
  const state = value;
  if (!STATUSES.has(state.status) || typeof state.hasPendingRemote !== "boolean") {
    throw new Error("Invalid persisted sync state");
  }
  if (!isNullableString(state.pendingOperationId) || !Number.isInteger(state.retryCount) || state.retryCount < 0) {
    throw new Error("Invalid persisted sync state");
  }
  if (state.backoffUntil !== null && (typeof state.backoffUntil !== "number" || !Number.isFinite(state.backoffUntil) || state.backoffUntil < 0)) {
    throw new Error("Invalid persisted sync state");
  }
  if (state.lastErrorKind !== null && !FAILURE_KINDS.has(state.lastErrorKind)) {
    throw new Error("Invalid persisted sync state");
  }
  for (const field of ["lastErrorMessage", "lastSyncReason", "lastPhase", "lastSnapshotId", "lastSyncedSnapshotId"]) {
    if (!isNullableString(state[field])) {
      throw new Error("Invalid persisted sync state");
    }
  }
  if (typeof state.retryable !== "boolean" || state.pendingContext === null || typeof state.pendingContext !== "object" || Array.isArray(state.pendingContext)) {
    throw new Error("Invalid persisted sync state");
  }
  return { ...state, pendingContext: { ...state.pendingContext } };
}
function createPrivateStateStore(rootPath) {
  const directory = path.join(rootPath, ".sync-core");
  const statePath = path.join(directory, "state.json");
  if ((fs.statSync(rootPath).mode & 146) === 0) {
    throw new Error("Sync runtime rootPath is read-only");
  }
  if (fs.existsSync(directory)) {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink()) {
      throw new Error("Sync runtime refuses a symbolic link at .sync-core");
    }
    if (!stat.isDirectory()) {
      throw new Error("Sync runtime requires .sync-core to be a directory");
    }
    if ((stat.mode & 146) === 0) {
      throw new Error("Sync runtime private state directory is read-only");
    }
  } else {
    try {
      fs.mkdirSync(directory, { mode: 448 });
    } catch (error) {
      throw new Error(`Sync runtime cannot create private state directory: ${error.message}`);
    }
  }
  try {
    fs.chmodSync(directory, 448);
    const mode = fs.statSync(directory).mode & 511;
    if ((mode & 128) === 0) {
      throw new Error("directory is read-only");
    }
    fs.accessSync(directory, fs.constants.W_OK);
  } catch (error) {
    throw new Error(`Sync runtime private state directory is not writable: ${error.message}`);
  }
  function loadState() {
    if (!fs.existsSync(statePath)) {
      return defaultState();
    }
    let parsed;
    let fileDescriptor = null;
    try {
      if (fs.lstatSync(statePath).isSymbolicLink()) {
        throw new Error("symbolic link at state.json");
      }
      fileDescriptor = fs.openSync(statePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      if (!fs.fstatSync(fileDescriptor).isFile()) {
        throw new Error("state.json is not a regular file");
      }
      parsed = JSON.parse(fs.readFileSync(fileDescriptor, "utf8"));
    } catch (error) {
      throw new Error(`Invalid persisted sync state: ${error.message}`);
    } finally {
      if (fileDescriptor !== null) {
        fs.closeSync(fileDescriptor);
      }
    }
    return validatePersistedState(parsed);
  }
  function saveState(state) {
    const validated = validatePersistedState(state);
    const temporaryPath = path.join(
      directory,
      `.state.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    );
    let temporaryDescriptor = null;
    let directoryDescriptor = null;
    try {
      temporaryDescriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
        384
      );
      fs.writeFileSync(temporaryDescriptor, `${JSON.stringify(validated, null, 2)}
`, "utf8");
      fs.fchmodSync(temporaryDescriptor, 384);
      fs.fsyncSync(temporaryDescriptor);
      fs.closeSync(temporaryDescriptor);
      temporaryDescriptor = null;
      fs.renameSync(temporaryPath, statePath);
      directoryDescriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      try {
        fs.fsyncSync(directoryDescriptor);
      } catch (error) {
        const code = error !== null && typeof error === "object" ? error.code : null;
        if (typeof code !== "string" || !UNSUPPORTED_DIRECTORY_FSYNC_CODES.has(code)) {
          throw error;
        }
      }
    } catch (error) {
      throw new Error(`Sync runtime could not persist private state: ${error.message}`);
    } finally {
      if (temporaryDescriptor !== null) {
        fs.closeSync(temporaryDescriptor);
      }
      if (directoryDescriptor !== null) {
        fs.closeSync(directoryDescriptor);
      }
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
      }
    }
    return { ...validated, pendingContext: { ...validated.pendingContext } };
  }
  return { loadState, saveState, statePath };
}

// src/runtime.ts
var FAILURE_KINDS2 = /* @__PURE__ */ new Set(["network", "auth", "conflict", "config", "unknown"]);
var operationSequence = 0;
function createOperationId() {
  operationSequence += 1;
  return `${Date.now().toString(36)}_${operationSequence.toString(36)}`;
}
function publicState(state) {
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
function normalizeFailure(failure) {
  if (failure === null || typeof failure !== "object" || !FAILURE_KINDS2.has(failure.kind) || typeof failure.retryable !== "boolean") {
    return { kind: "unknown", retryable: false, safeMessage: "Synchronization failed" };
  }
  const candidate = failure;
  const normalized = { kind: candidate.kind, retryable: candidate.retryable };
  if (typeof candidate.retryAfterMs === "number" && Number.isFinite(candidate.retryAfterMs) && candidate.retryAfterMs >= 0) {
    normalized.retryAfterMs = candidate.retryAfterMs;
  }
  if (typeof candidate.safeMessage === "string" && candidate.safeMessage.trim().length > 0) {
    normalized.safeMessage = candidate.safeMessage;
  }
  return normalized;
}
function failureStatus(kind) {
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
}) {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
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
async function createSyncRuntimeFromResolvedOptions(options) {
  const store = createPrivateStateStore(options.rootPath);
  let state = store.loadState();
  let active = null;
  let trailing = null;
  function persist() {
    state = store.saveState(state);
  }
  function retryDelay(retryCount, retryAfterMs = 0) {
    const exponential = Math.min(
      options.maxRetryDelayMs,
      options.retryDelayMs * options.retryBackoffFactor ** Math.max(0, retryCount)
    );
    return Math.max(exponential, retryAfterMs);
  }
  function wait(operation, delayMs, unref) {
    return new Promise((resolve) => {
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
  async function attempt(operation) {
    const request = {
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
        return { kind: "unknown", retryable: false, safeMessage: "Synchronization failed" };
      }
    }
  }
  function finishSuccess(operation) {
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
  function finishTerminal(operation, failure) {
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
      state.lastSyncReason = typeof trailing.context.action === "string" ? trailing.context.action : state.lastSyncReason;
    }
    persist();
    const terminal = publicState(state);
    operation.resolve(terminal);
    trailing?.resolve(terminal);
    active = null;
    trailing = null;
  }
  async function runOperation(operation) {
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
          lastSyncReason: typeof operation.context.action === "string" ? operation.context.action : state.lastSyncReason,
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
    void active.promise.catch(() => {
    });
    void runOperation(active);
  }
  return {
    sync(context = {}) {
      if (active === null) {
        active = createOperation({
          operationId: state.hasPendingRemote && state.pendingOperationId !== null ? state.pendingOperationId : createOperationId(),
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

// src/runtime-options.ts
import fs2 from "node:fs";
import path2 from "node:path";
var PRIVATE_EXCLUSION = ".sync-core/**";
function hasMethod(value, method) {
  return value !== null && typeof value === "object" && typeof value[method] === "function";
}
function finiteInteger(name, value, defaultValue) {
  const normalized = value === void 0 ? defaultValue : value;
  if (typeof normalized !== "number" || !Number.isFinite(normalized) || !Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`Sync runtime ${name} must be a finite integer greater than or equal to 0`);
  }
  return normalized;
}
function normalizeRuntimeOptions(options) {
  if (options === null || typeof options !== "object") {
    throw new Error("Sync runtime requires options");
  }
  if (typeof options.rootPath !== "string" || options.rootPath.trim().length === 0) {
    throw new Error("Sync runtime rootPath must be a non-empty string");
  }
  const rootPath = path2.resolve(options.rootPath);
  let rootStat = null;
  try {
    rootStat = fs2.lstatSync(rootPath);
  } catch (error) {
    const code = error !== null && typeof error === "object" ? error.code : null;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw new Error(`Sync runtime cannot inspect rootPath: ${rootPath}`, { cause: error });
    }
    try {
      fs2.mkdirSync(rootPath, { recursive: true, mode: 448 });
      rootStat = fs2.lstatSync(rootPath);
    } catch (mkdirError) {
      throw new Error(`Sync runtime cannot create rootPath: ${rootPath}`, { cause: mkdirError });
    }
  }
  if (rootStat.isSymbolicLink()) {
    throw new Error(`Sync runtime refuses a symbolic link at rootPath: ${rootPath}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Sync runtime rootPath is not a directory: ${rootPath}`);
  }
  if (!hasMethod(options.backend, "synchronize") || !hasMethod(options.backend, "classifyError")) {
    throw new Error("Sync runtime requires a backend with synchronize() and classifyError()");
  }
  if (options.excludePatterns !== void 0 && (!Array.isArray(options.excludePatterns) || options.excludePatterns.some((item) => typeof item !== "string"))) {
    throw new Error("Sync runtime excludePatterns must be an array of strings");
  }
  const maxRetries = finiteInteger("maxRetries", options.maxRetries, 3);
  const retryDelayMs = finiteInteger("retryDelayMs", options.retryDelayMs, 1e3);
  const maxRetryDelayMs = finiteInteger("maxRetryDelayMs", options.maxRetryDelayMs, 3e4);
  const retryBackoffFactor = options.retryBackoffFactor ?? 2;
  if (typeof retryBackoffFactor !== "number" || !Number.isFinite(retryBackoffFactor) || retryBackoffFactor < 1) {
    throw new Error("Sync runtime retryBackoffFactor must be finite and greater than or equal to 1");
  }
  if (maxRetryDelayMs < retryDelayMs) {
    throw new Error("Sync runtime maxRetryDelayMs must be greater than or equal to retryDelayMs");
  }
  const exclusions = (options.excludePatterns ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
  if (!exclusions.includes(PRIVATE_EXCLUSION)) {
    exclusions.push(PRIVATE_EXCLUSION);
  }
  return {
    backend: options.backend,
    rootPath,
    excludePatterns: [...new Set(exclusions)],
    maxRetries,
    retryDelayMs,
    retryBackoffFactor,
    maxRetryDelayMs
  };
}

// src/engine.ts
async function createSyncRuntime(options) {
  return createSyncRuntimeFromResolvedOptions(normalizeRuntimeOptions(options));
}
export {
  createSyncRuntime
};
