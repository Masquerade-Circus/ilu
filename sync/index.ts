import { createSyncRuntime as createCoreSyncRuntime } from 'sync-core';
import type { NormalizedSyncState, SyncBackend, SyncMutationContext, SyncRuntime, SyncRuntimeOptions } from 'sync-core';
import adapter from './ilu-adapter.ts';
import { createGitBackend } from './git-cli-backend.ts';
import { clearPendingMarker, loadPendingMarker, migrateLegacySyncState, savePendingMarker } from './state-store.ts';

type SyncRuntimeOverrides = Partial<SyncRuntimeOptions>;
type IluSyncState = Omit<NormalizedSyncState, 'status'> & {
  enabled: boolean;
  status: NormalizedSyncState['status'] | 'disabled';
};
type IluSyncRuntime = {
  sync(context?: SyncMutationContext): Promise<IluSyncState>;
  getSyncStatus(): IluSyncState;
};

let runtime: SyncRuntime | null = null;
let runtimePromise: Promise<SyncRuntime> | null = null;
let generation = 0;
let lastContext: SyncMutationContext = {};
let enableBarrier: Promise<void> = Promise.resolve();
const activeSyncs = new Set<Promise<NormalizedSyncState>>();
const activeBackendInvocations = new Set<Promise<void>>();
const runtimeGenerations = new WeakMap<SyncRuntime, number>();

function disabledState(): IluSyncState {
  const pending = loadPendingMarker() !== null;
  return {
    enabled: false,
    status: 'disabled',
    hasPendingRemote: pending,
    pendingOperationId: null,
    retryCount: 0,
    backoffUntil: null,
    lastErrorKind: null,
    lastErrorMessage: null,
    lastSyncReason: null,
    lastPhase: null,
    lastSnapshotId: null,
    lastSyncedSnapshotId: null
  };
}

function enabledState(state: NormalizedSyncState): IluSyncState {
  if (loadPendingMarker() !== null) {
    return {...state, enabled: true, status: 'pending_remote', hasPendingRemote: true};
  }
  return {...state, enabled: true};
}

function pendingState(): IluSyncState {
  return {
    ...disabledState(),
    enabled: true,
    status: 'pending_remote',
    hasPendingRemote: true
  };
}

function getSyncConfig() {
  return adapter.getSyncConfig();
}

function getBootstrapContext() {
  return {
    rootPath: adapter.getSourceRoot(),
    excludePatterns: typeof adapter.getIgnorePatterns === 'function' ? adapter.getIgnorePatterns() : []
  };
}

function createBootstrapBackend(options: Record<string, string | null> = {}) {
  const config = getSyncConfig();
  const bootstrapContext = getBootstrapContext();
  return createGitBackend({
    repoPath: options.repoPath || bootstrapContext.rootPath,
    branch: options.branch || config.branch,
    remote: options.remote || 'origin',
    remoteUrl: options.remoteUrl || config.remoteUrl,
    receiveRemote: config.autoPull !== false,
    publishLocal: config.autoPush !== false,
    describeChange: (context) => adapter.buildCommitMessage(context)
  });
}

function getRuntimeOptions(overrides: SyncRuntimeOverrides = {}): SyncRuntimeOptions {
  const config = getSyncConfig();
  const rootPath = overrides.rootPath ?? adapter.getSourceRoot();
  return {
    ...overrides,
    backend: overrides.backend ?? createGitBackend({
      repoPath: rootPath,
      branch: config.branch,
      remote: 'origin',
      remoteUrl: config.remoteUrl,
      receiveRemote: config.autoPull !== false,
      publishLocal: config.autoPush !== false,
      describeChange: (context) => adapter.buildCommitMessage(context)
    }),
    rootPath,
    excludePatterns: overrides.excludePatterns ?? adapter.getIgnorePatterns()
  };
}

function backendForGeneration(backend: SyncBackend, ownerGeneration: number): SyncBackend {
  return {
    async synchronize(request) {
      if (ownerGeneration !== generation) {
        return;
      }
      const invocation = Promise.resolve().then(() => backend.synchronize(request));
      activeBackendInvocations.add(invocation);
      try {
        await invocation;
      } finally {
        activeBackendInvocations.delete(invocation);
      }
    },
    classifyError(error, request) {
      return backend.classifyError(error, request);
    }
  };
}

async function startRuntime(overrides: SyncRuntimeOverrides = {}) {
  const options = getRuntimeOptions(overrides);
  migrateLegacySyncState(options.rootPath);
  generation += 1;
  const ownerGeneration = generation;
  const creatingRuntime = createCoreSyncRuntime({
    ...options,
    backend: backendForGeneration(options.backend, ownerGeneration)
  });
  runtimePromise = creatingRuntime;
  try {
    const createdRuntime = await creatingRuntime;
    runtimeGenerations.set(createdRuntime, ownerGeneration);
    if (ownerGeneration === generation) {
      runtime = createdRuntime;
    }
    return createdRuntime;
  } catch (error) {
    if (runtimePromise === creatingRuntime) {
      runtimePromise = null;
    }
    throw error;
  }
}

async function runCoreSync(core: SyncRuntime, context: SyncMutationContext = {}) {
  const operationGeneration = runtimeGenerations.get(core);
  const marker = loadPendingMarker();
  const mergedContext = {...(marker?.context ?? {}), ...context};
  lastContext = mergedContext;
  savePendingMarker(mergedContext);
  const operation = core.sync(mergedContext).then((state) => state);
  activeSyncs.add(operation);
  try {
    const state = await operation;
    if (
      operationGeneration === generation &&
      getSyncConfig().enabled === true &&
      state.status === 'healthy' &&
      state.hasPendingRemote === false
    ) {
      clearPendingMarker();
    }
    return state;
  } finally {
    activeSyncs.delete(operation);
  }
}

function wrapRuntime(core: SyncRuntime): IluSyncRuntime {
  return {
    async sync(context = {}) {
      return enabledState(await runCoreSync(core, context));
    },
    getSyncStatus() {
      return enabledState(core.getSyncStatus());
    }
  };
}

function disabledRuntime(): IluSyncRuntime {
  return {
    async sync() {
      return disabledState();
    },
    getSyncStatus() {
      return disabledState();
    }
  };
}

async function createSyncRuntime(overrides: SyncRuntimeOverrides = {}) {
  if (getSyncConfig().enabled !== true) {
    return disabledRuntime();
  }
  await enableBarrier;
  if (Object.keys(overrides).length === 0 && runtime !== null) {
    return wrapRuntime(runtime);
  }
  return wrapRuntime(await startRuntime(overrides));
}

async function ensureRuntime(): Promise<SyncRuntime> {
  if (getSyncConfig().enabled !== true) {
    throw new Error('Sync is disabled');
  }
  await enableBarrier;
  if (runtime !== null) {
    return runtime;
  }
  if (runtimePromise === null) {
    return startRuntime();
  }
  runtime = await runtimePromise;
  return runtime;
}

async function sync(context: SyncMutationContext = {}) {
  const config = getSyncConfig();
  if (config.enabled !== true) {
    return disabledState();
  }
  if (config.autoSync === false) {
    lastContext = {...context};
    savePendingMarker(lastContext);
    return pendingState();
  }
  return enabledState(await runCoreSync(await ensureRuntime(), context));
}

async function getSyncStatus() {
  if (getSyncConfig().enabled !== true) {
    return disabledState();
  }
  if (loadPendingMarker() !== null && runtime === null) {
    return pendingState();
  }
  return enabledState((await ensureRuntime()).getSyncStatus());
}

async function retry(context: SyncMutationContext = {}) {
  if (getSyncConfig().enabled !== true) {
    return disabledState();
  }
  return enabledState(await runCoreSync(await ensureRuntime(), context));
}

async function disable() {
  const currentState = runtime?.getSyncStatus() ?? null;
  if (currentState?.hasPendingRemote === true || activeSyncs.size > 0) {
    savePendingMarker(lastContext);
  }
  generation += 1;
  const operations = [...activeSyncs, ...activeBackendInvocations];
  const backoffUntil = currentState?.backoffUntil ?? null;
  const previousBarrier = enableBarrier;
  enableBarrier = Promise.all([previousBarrier, Promise.allSettled(operations)]).then(async () => {
    if (operations.length === 0 && backoffUntil !== null && backoffUntil > Date.now()) {
      await new Promise<void>((resolve) => setTimeout(resolve, backoffUntil - Date.now()));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });
  runtime = null;
  runtimePromise = null;
  return disabledState();
}

async function enable(overrides: SyncRuntimeOverrides = {}) {
  await enableBarrier;
  const core = Object.keys(overrides).length > 0 ? await startRuntime(overrides) : await ensureRuntime();
  if (loadPendingMarker() !== null || core.getSyncStatus().hasPendingRemote) {
    return enabledState(await runCoreSync(core, {reason: 'enable'}));
  }
  return enabledState(core.getSyncStatus());
}

export {
  getSyncConfig,
  getBootstrapContext,
  getRuntimeOptions,
  createBootstrapBackend,
  createSyncRuntime,
  sync,
  getSyncStatus,
  retry,
  disable,
  enable
};
export default {
  getSyncConfig,
  getBootstrapContext,
  getRuntimeOptions,
  createBootstrapBackend,
  createSyncRuntime,
  sync,
  getSyncStatus,
  retry,
  disable,
  enable
};
