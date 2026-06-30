const HOST_CONTRACT_METHODS = {
  getSyncConfig: 'getSyncConfig',
  getSourceRoot: 'getSourceRoot',
  getIgnorePatterns: 'getIgnorePatterns',
  buildCommitMessage: 'buildCommitMessage',
  logger: 'logger',
  now: 'now'
};

const GIT_BACKEND_METHODS = {
  ensureReady: 'ensureReady',
  syncWorkingTree: 'syncWorkingTree',
  hasChanges: 'hasChanges',
  commit: 'commit',
  fetch: 'fetch',
  integrate: 'integrate',
  push: 'push',
  getStatus: 'getStatus'
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function classifyGitError(error: unknown) {
  let message = getErrorMessage(error).toLowerCase();

  if (message.includes('resolve host') || message.includes('could not read from remote repository') || message.includes('connection timed out') || message.includes('network')) {
    return {kind: 'network', error};
  }

  if (message.includes('authentication failed') || message.includes('permission denied') || message.includes('could not authenticate')) {
    return {kind: 'auth', error};
  }

  if (message.includes('conflict') || message.includes('non-fast-forward')) {
    return {kind: 'conflict', error};
  }

  if (message.includes('not a git repository') || message.includes('unknown revision') || message.includes('no such remote')) {
    return {kind: 'config', error};
  }

  return {kind: 'unknown', error};
}

export { HOST_CONTRACT_METHODS, GIT_BACKEND_METHODS, classifyGitError };
export default {
  HOST_CONTRACT_METHODS,
  GIT_BACKEND_METHODS,
  classifyGitError
};
