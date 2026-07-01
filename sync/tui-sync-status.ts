function syncSetupStatus() {
  return {state: 'setup', message: 'Sync setup needed'};
}

type SyncStatusResult = {
  status?: string;
  hasPendingRemote?: boolean;
};

function isSyncStatusResult(result: unknown): result is SyncStatusResult {
  return result !== null && typeof result === 'object';
}

function syncStatusFromResult(result: unknown) {
  if (!isSyncStatusResult(result) || typeof result.status !== 'string') {
    return {state: 'failed', message: 'Sync failed'};
  }

  if (result.status === 'healthy' && result.hasPendingRemote !== true) {
    return {state: 'synced', message: 'Synced'};
  }

  if (result.status === 'pending_remote') {
    return {state: 'pending', message: 'Sync pending'};
  }

  if (result.status === 'disabled') {
    return {state: 'idle', message: 'Ready'};
  }

  if (result.status === 'misconfigured') {
    return syncSetupStatus();
  }

  return {state: 'failed', message: 'Sync failed'};
}

function isSyncSetupError(error: unknown) {
  return Boolean(
    error instanceof Error
      && /remoteUrl when sync is enabled|Sync setup needed/.test(error.message)
  );
}

export { isSyncSetupError, syncSetupStatus, syncStatusFromResult };
export default {
  isSyncSetupError,
  syncSetupStatus,
  syncStatusFromResult
};
