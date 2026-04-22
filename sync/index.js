let {createSyncRuntime: createEngineRuntime} = require('./engine');
let stateStore = require('./state-store');
let adapter = require('./ilu-adapter');
let {createGitCliBackend} = require('./git-cli-backend');

let runtime = null;

function createSyncRuntime(overrides = {}) {
  let config = (overrides.adapter || adapter).getSyncConfig();
  let backend = overrides.backend || createGitCliBackend({
    repoPath: overrides.repoPath || (overrides.adapter || adapter).getSourceRoot(),
    branch: config.branch,
    remote: 'origin',
    remoteUrl: config.remoteUrl
  });

  runtime = createEngineRuntime({
    adapter: overrides.adapter || adapter,
    stateStore: overrides.stateStore || stateStore,
    backend
  });

  return runtime;
}

function ensureRuntime() {
  if (!runtime) {
    runtime = createSyncRuntime();
  }

  return runtime;
}

function notifyLocalMutation(context) {
  return ensureRuntime().notifyLocalMutation(context);
}

function getSyncStatus() {
  return ensureRuntime().getSyncStatus();
}

function retry(context) {
  return ensureRuntime().retry(context);
}

module.exports = {
  createSyncRuntime,
  notifyLocalMutation,
  getSyncStatus,
  retry
};
