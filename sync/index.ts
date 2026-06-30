import * as __cjsImport29 from '../sync-core/engine.ts';
const { createSyncRuntime: createEngineRuntime } = __cjsImport29;
import * as __cjsImport30 from '../sync-core/advanced.ts';
const { createSyncRuntimeAdvanced: createEngineRuntimeAdvanced } = __cjsImport30;
import adapter from './ilu-adapter.ts';
import * as __cjsImport31 from './git-cli-backend.ts';
const { createGitCliBackend } = __cjsImport31;
import stateStore from './state-store.ts';
let runtime: any = null;

function getRuntimeOptions(consumerAdapter: any = adapter, overrides: any = {}) {
  let config = consumerAdapter.getSyncConfig();

  return {
    enabled: Object.prototype.hasOwnProperty.call(overrides, 'enabled')
      ? overrides.enabled
      : config.enabled,
    remoteUrl: Object.prototype.hasOwnProperty.call(overrides, 'remoteUrl')
      ? overrides.remoteUrl
      : config.remoteUrl,
    branch: Object.prototype.hasOwnProperty.call(overrides, 'branch')
      ? overrides.branch
      : config.branch,
    autoSync: Object.prototype.hasOwnProperty.call(overrides, 'autoSync')
      ? overrides.autoSync
      : config.autoSync,
    autoPull: Object.prototype.hasOwnProperty.call(overrides, 'autoPull')
      ? overrides.autoPull
      : config.autoPull,
    autoPush: Object.prototype.hasOwnProperty.call(overrides, 'autoPush')
      ? overrides.autoPush
      : config.autoPush,
    sourceRoot: Object.prototype.hasOwnProperty.call(overrides, 'sourceRoot')
      ? overrides.sourceRoot
      : consumerAdapter.getSourceRoot(),
    ignorePatterns: Object.prototype.hasOwnProperty.call(overrides, 'ignorePatterns')
      ? overrides.ignorePatterns
      : (typeof consumerAdapter.getIgnorePatterns === 'function'
        ? consumerAdapter.getIgnorePatterns()
        : []),
    buildCommitMessage: typeof overrides.buildCommitMessage === 'function'
      ? overrides.buildCommitMessage
      : (context: any) => consumerAdapter.buildCommitMessage(context)
  };
}

function getSyncConfig() {
  return adapter.getSyncConfig();
}

function getBootstrapContext() {
  return {
    sourceRoot: adapter.getSourceRoot(),
    ignorePatterns: typeof adapter.getIgnorePatterns === 'function'
      ? adapter.getIgnorePatterns()
      : []
  };
}

function createBootstrapBackend(options: any = {}) {
  let config = getSyncConfig();
  let bootstrapContext = getBootstrapContext();

  return createGitCliBackend({
    repoPath: options.repoPath || bootstrapContext.sourceRoot,
    branch: options.branch || config.branch,
    remote: options.remote || 'origin',
    remoteUrl: options.remoteUrl || config.remoteUrl
  });
}

function initializeSyncState(state: any = {}) {
  return stateStore.saveState({
    ...stateStore.defaultState(),
    ...state
  });
}

function createSyncRuntime(overrides: any = {}) {
  let forbidden = ['backend', 'stateStore', 'adapter', 'config']
    .filter((key: any) => Object.prototype.hasOwnProperty.call(overrides, key));

  if (forbidden.length > 0) {
    throw new Error(`sync.createSyncRuntime does not accept ${forbidden.join(' or ')} overrides`);
  }

  runtime = createEngineRuntime(getRuntimeOptions(adapter, overrides));

  return runtime;
}

function createSyncRuntimeAdvanced(options: any = {}) {
  runtime = createEngineRuntimeAdvanced({
    ...options,
    sourceRoot: options.sourceRoot || adapter.getSourceRoot(),
    ignorePatterns: Object.prototype.hasOwnProperty.call(options, 'ignorePatterns')
      ? options.ignorePatterns
      : (typeof adapter.getIgnorePatterns === 'function'
        ? adapter.getIgnorePatterns()
        : []),
    buildCommitMessage: typeof options.buildCommitMessage === 'function'
      ? options.buildCommitMessage
      : (context: any) => adapter.buildCommitMessage(context),
    stateStore: options.stateStore || stateStore
  });

  return runtime;
}

function ensureRuntime() {
  if (!runtime) {
    runtime = createSyncRuntime();
  }

  return runtime;
}

function notifyLocalMutation(context: any) {
  return ensureRuntime().notifyLocalMutation(context);
}

function getSyncStatus() {
  return ensureRuntime().getSyncStatus();
}

function retry(context: any) {
  return ensureRuntime().retry(context);
}

export { getSyncConfig, getBootstrapContext, getRuntimeOptions, createBootstrapBackend, initializeSyncState, createSyncRuntime, createSyncRuntimeAdvanced, notifyLocalMutation, getSyncStatus, retry };
export default {
  getSyncConfig,
  getBootstrapContext,
  getRuntimeOptions,
  createBootstrapBackend,
  initializeSyncState,
  createSyncRuntime,
  createSyncRuntimeAdvanced,
  notifyLocalMutation,
  getSyncStatus,
  retry
};
