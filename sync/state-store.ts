import fs from 'node:fs';
import path from 'node:path';
import localPaths from '../utils/local-paths.ts';

const VALID_STATUSES = new Set([
  'healthy',
  'pending_remote',
  'degraded_network',
  'degraded_auth',
  'conflict',
  'failed'
]);
const VALID_ERROR_KINDS = new Set(['network', 'auth', 'conflict', 'config', 'unknown']);
type PendingMarker = {context: Record<string, unknown>};

function nullableString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function migrateLegacySyncState(rootPath: string) {
  const legacyPath = localPaths.syncStateFilePath();
  const stateDirectory = path.join(rootPath, '.sync-core');
  const statePath = path.join(stateDirectory, 'state.json');
  if (fs.existsSync(statePath) || !fs.existsSync(legacyPath)) {
    return false;
  }

  let legacy: unknown;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  } catch (error) {
    throw new Error(`Legacy sync state is invalid: ${(error as Error).message}`);
  }
  if (legacy === null || typeof legacy !== 'object' || Array.isArray(legacy)) {
    throw new Error('Legacy sync state is invalid');
  }

  const source = legacy as Record<string, unknown>;
  const pendingOperationId = nullableString(source.pendingOperationId);
  const hasPendingRemote = source.hasPendingRemote === true || source.pending === true;
  const backoffUntil =
    typeof source.backoffUntil === 'number' && Number.isFinite(source.backoffUntil) && source.backoffUntil >= 0
      ? source.backoffUntil
      : null;
  const sourceStatus = typeof source.status === 'string' && VALID_STATUSES.has(source.status)
    ? source.status
    : hasPendingRemote
      ? 'pending_remote'
      : 'healthy';
  const lastErrorKind = typeof source.lastErrorKind === 'string' && VALID_ERROR_KINDS.has(source.lastErrorKind)
    ? source.lastErrorKind
    : null;
  const migrated = {
    status: sourceStatus,
    hasPendingRemote,
    pendingOperationId: hasPendingRemote ? pendingOperationId : null,
    retryCount: 0,
    backoffUntil: hasPendingRemote ? backoffUntil : null,
    lastErrorKind,
    lastErrorMessage: nullableString(source.lastErrorMessage),
    lastSyncReason: nullableString(source.lastSyncReason),
    lastPhase: nullableString(source.lastPhase),
    lastSnapshotId: nullableString(source.lastSnapshotId),
    lastSyncedSnapshotId: nullableString(source.lastSyncedSnapshotId),
    retryable: hasPendingRemote && lastErrorKind === 'network',
    pendingContext: {}
  };

  if (fs.existsSync(stateDirectory) && fs.lstatSync(stateDirectory).isSymbolicLink()) {
    throw new Error('Legacy sync state migration refuses a symbolic link at .sync-core');
  }
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(stateDirectory, 0o700);
  const temporaryPath = path.join(stateDirectory, `.state.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(migrated, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporaryPath, statePath);
    fs.chmodSync(statePath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  return true;
}

function loadPendingMarker(): PendingMarker | null {
  const markerPath = localPaths.syncPendingFilePath();
  if (!fs.existsSync(markerPath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Ilu sync pending marker is invalid');
  }
  const marker = parsed as Record<string, unknown>;
  if (marker.pending !== true || marker.context === null || typeof marker.context !== 'object' || Array.isArray(marker.context)) {
    throw new Error('Ilu sync pending marker is invalid');
  }
  return {context: {...(marker.context as Record<string, unknown>)}};
}

function savePendingMarker(context: Record<string, unknown> = {}) {
  const markerPath = localPaths.syncPendingFilePath();
  const directory = path.dirname(markerPath);
  const temporaryPath = `${markerPath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify({pending: true, context}, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    });
    fs.renameSync(temporaryPath, markerPath);
    fs.chmodSync(markerPath, 0o600);
  } finally {
    fs.rmSync(temporaryPath, {force: true});
  }
  return {context: {...context}};
}

function clearPendingMarker() {
  fs.rmSync(localPaths.syncPendingFilePath(), {force: true});
}

export { migrateLegacySyncState, loadPendingMarker, savePendingMarker, clearPendingMarker };
export default { migrateLegacySyncState, loadPendingMarker, savePendingMarker, clearPendingMarker };
