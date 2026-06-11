function syncSetupStatus() {
  return {state: 'setup', message: 'Sync setup needed'};
}

function syncStatusFromResult(result) {
  if (!result || typeof result.status !== 'string') {
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

function isSyncSetupError(error) {
  return Boolean(
    error
      && typeof error.message === 'string'
      && /remoteUrl when sync is enabled|Sync setup needed/.test(error.message)
  );
}

module.exports = {
  isSyncSetupError,
  syncSetupStatus,
  syncStatusFromResult
};
