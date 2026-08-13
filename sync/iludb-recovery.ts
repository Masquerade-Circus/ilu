import fs from 'node:fs';
import path from 'node:path';
import nodeJSONPlugin from 'iludb/plugins/node-json';
import defaultSyncIndex from './index.ts';
import { getActiveSyncExecutor } from './ilu-hooks.ts';

type RecoveryResult =
  | {status: 'reloaded-local'; filePath: string; domain: string}
  | {status: 'reconciled'; filePath: string; domain: string};

type ReloadDatabase = () => void;
type RecoveryListener = (event: {domain: string; result: RecoveryResult | null; error: DataRecoveryError | null}) => void;
type RecoveryExecutor = {
  reconcileFile?: (input: {filePath: string; snapshot: string; context: Record<string, unknown>}) => Promise<Record<string, unknown>>;
};
type PendingRecovery = {
  error: DataConflictError;
  reloads: Set<ReloadDatabase>;
};

class DataRecoveryError extends Error {
  readonly code = 'DATA_RECOVERY_BLOCKED';

  constructor(message = 'Data recovery could not finish safely. The current file was preserved.') {
    super(message);
    this.name = 'DataRecoveryError';
  }
}

class DataConflictError extends Error {
  readonly code = 'DATA_CONFLICT';
  readonly expectedRevision: number;
  readonly actualRevision: number | null;
  readonly reconciliation: Promise<RecoveryResult>;

  constructor(input: {
    expectedRevision: number;
    actualRevision: number | null;
    reconciliation: Promise<RecoveryResult>;
  }) {
    super('Data changed in another process. Ilu is recovering the current snapshot.');
    this.name = 'DataConflictError';
    this.expectedRevision = input.expectedRevision;
    this.actualRevision = input.actualRevision;
    this.reconciliation = input.reconciliation;
  }
}

const recoveries = new Map<string, PendingRecovery>();
const listeners = new Set<RecoveryListener>();

function safeSnapshot(filePath: string): string {
  const stats = fs.lstatSync(filePath);

  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new DataRecoveryError();
  }

  const snapshot = fs.readFileSync(filePath, 'utf8');
  JSON.parse(snapshot);
  return snapshot;
}

function emitRecovery(event: Parameters<RecoveryListener>[0]): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (_error: unknown) {
      void _error;
    }
  }
}

function blocked(error: unknown): DataRecoveryError {
  return error instanceof DataRecoveryError ? error : new DataRecoveryError();
}

function beginDataRecovery(input: {
  filePath: string;
  domain: string;
  conflict: InstanceType<typeof nodeJSONPlugin.ConflictError>;
  reload: ReloadDatabase;
}): DataConflictError {
  const filePath = path.resolve(input.filePath);
  const active = recoveries.get(filePath);

  if (active) {
    active.reloads.add(input.reload);
    return active.error;
  }

  let resolveRecovery!: (result: RecoveryResult) => void;
  let rejectRecovery!: (error: DataRecoveryError) => void;
  const reconciliation = new Promise<RecoveryResult>((resolve, reject) => {
    resolveRecovery = resolve;
    rejectRecovery = reject;
  });
  const error = new DataConflictError({
    expectedRevision: input.conflict.expectedRevision,
    actualRevision: input.conflict.actualRevision,
    reconciliation
  });
  const pending: PendingRecovery = {error, reloads: new Set([input.reload])};
  recoveries.set(filePath, pending);

  let snapshot: string;
  try {
    snapshot = safeSnapshot(filePath);
  } catch (snapshotError: unknown) {
    const recoveryError = blocked(snapshotError);
    recoveries.delete(filePath);
    rejectRecovery(recoveryError);
    emitRecovery({domain: input.domain, result: null, error: recoveryError});
    return error;
  }

  Promise.resolve().then(async () => {
    const config = defaultSyncIndex.getSyncConfig();
    let result: RecoveryResult;

    if (config.enabled !== true) {
      for (const reload of pending.reloads) {
        reload();
      }
      result = {status: 'reloaded-local', filePath, domain: input.domain};
    } else {
      const executor = getActiveSyncExecutor() as RecoveryExecutor;
      if (typeof executor.reconcileFile !== 'function') {
        throw new DataRecoveryError();
      }

      const syncStatus = await executor.reconcileFile({
        filePath,
        snapshot,
        context: {domain: input.domain, action: 'revision-conflict', reason: 'iludb-revision-conflict'}
      });

      if (syncStatus.status !== 'healthy' || syncStatus.hasPendingRemote === true) {
        throw new DataRecoveryError();
      }

      for (const reload of pending.reloads) {
        reload();
      }
      result = {status: 'reconciled', filePath, domain: input.domain};
    }

    recoveries.delete(filePath);
    resolveRecovery(result);
    emitRecovery({domain: input.domain, result, error: null});
  }).catch((recoveryFailure: unknown) => {
    const recoveryError = blocked(recoveryFailure);
    recoveries.delete(filePath);
    rejectRecovery(recoveryError);
    emitRecovery({domain: input.domain, result: null, error: recoveryError});
  });

  return error;
}

function activeDataConflict(filePath: string, reload?: ReloadDatabase): DataConflictError | null {
  const pending = recoveries.get(path.resolve(filePath));
  if (!pending) {
    return null;
  }
  if (typeof reload === 'function') {
    pending.reloads.add(reload);
  }
  return pending.error;
}

function onDataRecovery(listener: RecoveryListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export { DataConflictError, DataRecoveryError, activeDataConflict, beginDataRecovery, onDataRecovery };
export type { RecoveryResult };
