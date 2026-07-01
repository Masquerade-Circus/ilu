import * as __cjsImport29 from '../sync-core/engine.ts';
const { createSyncRuntime: createEngineRuntime } = __cjsImport29;
import * as __cjsImport30 from '../sync-core/advanced.ts';
const { createSyncRuntimeAdvanced: createEngineRuntimeAdvanced } = __cjsImport30;
import adapter from './ilu-adapter.ts';
import * as __cjsImport31 from './git-cli-backend.ts';
const { createGitCliBackend } = __cjsImport31;
import stateStore from './state-store.ts';
type SyncMutationContext = {
  domain?: string;
  action?: string;
  reason?: string;
} & Record<string, unknown>;

type SyncAdapter = {
  getSyncConfig: () => Record<string, unknown>;
  getSourceRoot: () => string;
  getIgnorePatterns?: () => string[];
  buildCommitMessage: (context: SyncMutationContext) => string;
};

type SyncRuntimeOverrides = Record<string, unknown> & {
  buildCommitMessage?: (context: SyncMutationContext) => string;
};

type SyncRuntimeAdvancedOptions = NonNullable<Parameters<typeof createEngineRuntimeAdvanced>[0]>;
type SyncStatus = Record<string, unknown>;
type SyncRuntime = {
  notifyLocalMutation: (context: SyncMutationContext) => Promise<SyncStatus>;
  getSyncStatus: () => SyncStatus;
  retry: (context: SyncMutationContext) => Promise<unknown>;
  enable?: () => Promise<SyncStatus>;
  disable?: () => Promise<SyncStatus>;
};

let runtime: SyncRuntime | null = null;

function getRuntimeOptions(consumerAdapter: SyncAdapter = adapter, overrides: SyncRuntimeOverrides = {}) {
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
      : (context: SyncMutationContext) => consumerAdapter.buildCommitMessage(context)
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

function createBootstrapBackend(options: Record<string, string | null> = {}) {
  let config = getSyncConfig();
  let bootstrapContext = getBootstrapContext();

  return createGitCliBackend({
    repoPath: options.repoPath || bootstrapContext.sourceRoot,
    branch: options.branch || config.branch,
    remote: options.remote || 'origin',
    remoteUrl: options.remoteUrl || config.remoteUrl
  });
}

function initializeSyncState(state: Record<string, unknown> = {}) {
  return stateStore.saveState({
    ...stateStore.defaultState(),
    ...state
  });
}

function createSyncRuntime(overrides: SyncRuntimeOverrides = {}) {
  let forbidden = ['backend', 'stateStore', 'adapter', 'config']
    .filter((key) => Object.prototype.hasOwnProperty.call(overrides, key));

  if (forbidden.length > 0) {
    throw new Error(`sync.createSyncRuntime does not accept ${forbidden.join(' or ')} overrides`);
  }

  runtime = createEngineRuntime(getRuntimeOptions(adapter, overrides)) as unknown as SyncRuntime;

  return runtime;
}

function createSyncRuntimeAdvanced(options: SyncRuntimeAdvancedOptions = {}) {
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
      : (context: SyncMutationContext) => adapter.buildCommitMessage(context),
    stateStore: options.stateStore || (stateStore as unknown as NonNullable<SyncRuntimeAdvancedOptions['stateStore']>)
  }) as unknown as SyncRuntime;

  return runtime;
}

function ensureRuntime() {
  if (!runtime) {
    runtime = createSyncRuntime();
  }

  return runtime;
}

function notifyLocalMutation(context: SyncMutationContext) {
  return ensureRuntime().notifyLocalMutation(context);
}

function getSyncStatus() {
  return ensureRuntime().getSyncStatus();
}

function retry(context: SyncMutationContext) {
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
