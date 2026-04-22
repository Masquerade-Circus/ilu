const HOST_CONTRACT_METHODS = {
  getSyncConfig: 'getSyncConfig',
  getSourceRoot: 'getSourceRoot',
  listTrackedEntries: 'listTrackedEntries',
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

const SYNC_DIRNAME = '.config';
const SYNC_CONFIG_FILENAME = 'sync-config.json';
const TTS_CONFIG_FILENAME = 'tts-config.json';
const SYNC_STATE_FILENAME = 'sync-state.json';
const SYNC_LOCK_FILENAME = 'sync.lock';

module.exports = {
  HOST_CONTRACT_METHODS,
  GIT_BACKEND_METHODS,
  SYNC_DIRNAME,
  SYNC_CONFIG_FILENAME,
  TTS_CONFIG_FILENAME,
  SYNC_STATE_FILENAME,
  SYNC_LOCK_FILENAME
};
