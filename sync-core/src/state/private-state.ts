import fs from "node:fs";
import path from "node:path";
import type { PersistedSyncState, SyncFailureKind, SyncMutationContext } from "../types.js";

const STATUSES = new Set(["healthy", "pending_remote", "degraded_network", "degraded_auth", "conflict", "failed"]);
const FAILURE_KINDS = new Set<SyncFailureKind>(["network", "auth", "conflict", "config", "unknown"]);
const UNSUPPORTED_DIRECTORY_FSYNC_CODES = new Set(["EINVAL", "ENOTSUP", "ENOSYS"]);

function defaultState(): PersistedSyncState {
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

function isNullableString(value: unknown) {
  return value === null || typeof value === "string";
}

function validatePersistedState(value: unknown): PersistedSyncState {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid persisted sync state");
  }
  const state = value as Record<string, unknown>;
  if (!STATUSES.has(state.status as string) || typeof state.hasPendingRemote !== "boolean") {
    throw new Error("Invalid persisted sync state");
  }
  if (
    !isNullableString(state.pendingOperationId) ||
    !Number.isInteger(state.retryCount) ||
    (state.retryCount as number) < 0
  ) {
    throw new Error("Invalid persisted sync state");
  }
  if (
    state.backoffUntil !== null &&
    (typeof state.backoffUntil !== "number" || !Number.isFinite(state.backoffUntil) || state.backoffUntil < 0)
  ) {
    throw new Error("Invalid persisted sync state");
  }
  if (state.lastErrorKind !== null && !FAILURE_KINDS.has(state.lastErrorKind as SyncFailureKind)) {
    throw new Error("Invalid persisted sync state");
  }
  for (const field of ["lastErrorMessage", "lastSyncReason", "lastPhase", "lastSnapshotId", "lastSyncedSnapshotId"]) {
    if (!isNullableString(state[field])) {
      throw new Error("Invalid persisted sync state");
    }
  }
  if (
    typeof state.retryable !== "boolean" ||
    state.pendingContext === null ||
    typeof state.pendingContext !== "object" ||
    Array.isArray(state.pendingContext)
  ) {
    throw new Error("Invalid persisted sync state");
  }
  return { ...state, pendingContext: { ...(state.pendingContext as SyncMutationContext) } } as PersistedSyncState;
}

function createPrivateStateStore(rootPath: string) {
  const directory = path.join(rootPath, ".sync-core");
  const statePath = path.join(directory, "state.json");
  if ((fs.statSync(rootPath).mode & 0o222) === 0) {
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
    if ((stat.mode & 0o222) === 0) {
      throw new Error("Sync runtime private state directory is read-only");
    }
  } else {
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      throw new Error(`Sync runtime cannot create private state directory: ${(error as Error).message}`);
    }
  }

  try {
    fs.chmodSync(directory, 0o700);
    const mode = fs.statSync(directory).mode & 0o777;
    if ((mode & 0o200) === 0) {
      throw new Error("directory is read-only");
    }
    fs.accessSync(directory, fs.constants.W_OK);
  } catch (error) {
    throw new Error(`Sync runtime private state directory is not writable: ${(error as Error).message}`);
  }

  function loadState() {
    if (!fs.existsSync(statePath)) {
      return defaultState();
    }
    let parsed: unknown;
    let fileDescriptor: number | null = null;
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
      throw new Error(`Invalid persisted sync state: ${(error as Error).message}`);
    } finally {
      if (fileDescriptor !== null) {
        fs.closeSync(fileDescriptor);
      }
    }
    return validatePersistedState(parsed);
  }

  function saveState(state: PersistedSyncState) {
    const validated = validatePersistedState(state);
    const temporaryPath = path.join(
      directory,
      `.state.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    );
    let temporaryDescriptor: number | null = null;
    let directoryDescriptor: number | null = null;
    try {
      temporaryDescriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
        0o600
      );
      fs.writeFileSync(temporaryDescriptor, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
      fs.fchmodSync(temporaryDescriptor, 0o600);
      fs.fsyncSync(temporaryDescriptor);
      fs.closeSync(temporaryDescriptor);
      temporaryDescriptor = null;
      fs.renameSync(temporaryPath, statePath);
      directoryDescriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      try {
        fs.fsyncSync(directoryDescriptor);
      } catch (error) {
        const code = error !== null && typeof error === "object" ? (error as NodeJS.ErrnoException).code : null;
        if (typeof code !== "string" || !UNSUPPORTED_DIRECTORY_FSYNC_CODES.has(code)) {
          throw error;
        }
      }
    } catch (error) {
      throw new Error(`Sync runtime could not persist private state: ${(error as Error).message}`);
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
        // The atomic destination remains authoritative when temp cleanup fails.
      }
    }
    return { ...validated, pendingContext: { ...validated.pendingContext } };
  }

  return { loadState, saveState, statePath };
}

export { createPrivateStateStore, defaultState, validatePersistedState };
