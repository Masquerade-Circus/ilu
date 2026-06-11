const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const engineModulePath = path.join(repoRoot, 'sync-core', 'engine.js');
const advancedModulePath = path.join(repoRoot, 'sync-core', 'advanced.js');
const coreDefaultsModulePath = path.join(repoRoot, 'sync-core', 'defaults.js');
const coreRuntimeOptionsModulePath = path.join(repoRoot, 'sync-core', 'runtime-options.js');
const coreGitCliBackendModulePath = path.join(repoRoot, 'sync-core', 'backends', 'git-cli.js');
const coreFileStateStoreModulePath = path.join(repoRoot, 'sync-core', 'state', 'file-store.js');
const consumerIndexModulePath = path.join(repoRoot, 'sync', 'index.js');
const consumerAdapterModulePath = path.join(repoRoot, 'sync', 'ilu-adapter.js');
const consumerBackendModulePath = path.join(repoRoot, 'sync', 'git-cli-backend.js');
const consumerStateStoreModulePath = path.join(repoRoot, 'sync', 'state-store.js');

function loadEngine() {
  delete require.cache[require.resolve(engineModulePath)];
  return require(engineModulePath);
}

function loadAdvanced() {
  delete require.cache[require.resolve(advancedModulePath)];
  return require(advancedModulePath);
}

function loadEngineWithCoreStubs({gitCliBackendExports, fileStoreExports} = {}) {
  const restoredEntries = [];

  function stubModule(modulePath, exports) {
    const resolvedPath = require.resolve(modulePath);
    restoredEntries.push([resolvedPath, require.cache[resolvedPath]]);
    require.cache[resolvedPath] = {
      id: resolvedPath,
      filename: resolvedPath,
      loaded: true,
      exports
    };
  }

  delete require.cache[require.resolve(engineModulePath)];

  try {
    delete require.cache[require.resolve(coreDefaultsModulePath)];
  } catch (error) {
    // ignore cache misses before defaults module exists
  }

  if (gitCliBackendExports) {
    stubModule(coreGitCliBackendModulePath, gitCliBackendExports);
  }

  if (fileStoreExports) {
    stubModule(coreFileStateStoreModulePath, fileStoreExports);
  }

  return {
    ...require(engineModulePath),
    restore() {
      delete require.cache[require.resolve(engineModulePath)];
      restoredEntries.reverse().forEach(([modulePath, previousEntry]) => {
        if (previousEntry) {
          require.cache[modulePath] = previousEntry;
        } else {
          delete require.cache[modulePath];
        }
      });
    }
  };
}

function loadEngineWithRuntimeStubs({runtimeOptionsExports, defaultsExports} = {}) {
  const restoredEntries = [];

  function stubModule(modulePath, exports) {
    const resolvedPath = require.resolve(modulePath);
    restoredEntries.push([resolvedPath, require.cache[resolvedPath]]);
    require.cache[resolvedPath] = {
      id: resolvedPath,
      filename: resolvedPath,
      loaded: true,
      exports
    };
  }

  delete require.cache[require.resolve(engineModulePath)];
  stubModule(coreRuntimeOptionsModulePath, runtimeOptionsExports);
  stubModule(coreDefaultsModulePath, defaultsExports);

  return {
    ...require(engineModulePath),
    restore() {
      delete require.cache[require.resolve(engineModulePath)];
      restoredEntries.reverse().forEach(([modulePath, previousEntry]) => {
        if (previousEntry) {
          require.cache[modulePath] = previousEntry;
        } else {
          delete require.cache[modulePath];
        }
      });
    }
  };
}

function loadSyncConsumer({engineExports, adapterExports, backendExports, stateStoreExports}) {
  const restoredEntries = [];

  function stubModule(modulePath, exports) {
    const resolvedPath = require.resolve(modulePath);
    restoredEntries.push([resolvedPath, require.cache[resolvedPath]]);
    require.cache[resolvedPath] = {
      id: resolvedPath,
      filename: resolvedPath,
      loaded: true,
      exports
    };
  }

  delete require.cache[require.resolve(consumerIndexModulePath)];
  stubModule(engineModulePath, engineExports);
  stubModule(consumerAdapterModulePath, adapterExports);
  stubModule(consumerBackendModulePath, backendExports);

   if (stateStoreExports) {
    stubModule(consumerStateStoreModulePath, stateStoreExports);
  }

  const syncIndex = require(consumerIndexModulePath);

  return {
    syncIndex,
    restore() {
      delete require.cache[require.resolve(consumerIndexModulePath)];
      restoredEntries.reverse().forEach(([modulePath, previousEntry]) => {
        if (previousEntry) {
          require.cache[modulePath] = previousEntry;
        } else {
          delete require.cache[modulePath];
        }
      });
    }
  };
}

function createHarness(overrides = {}) {
  const activityLog = [];
  const persistedState = overrides.persistedState || {
    enabled: true,
    status: 'healthy',
    hasPendingRemote: false,
    retryCount: 0,
    lastErrorKind: null,
    lastErrorMessage: null,
    lastSyncReason: null,
    lastPhase: null,
    lastSnapshotId: null,
    lastSyncedSnapshotId: null
  };

  const runtimeOptions = {
    config: {
      enabled: persistedState.enabled !== false,
      remoteUrl: '/tmp/remote.git',
      branch: 'main',
      autoSync: true,
      autoPull: true,
      autoPush: true,
      ...(overrides.runtimeOptions?.config || {})
    },
    sourceRoot: overrides.runtimeOptions?.sourceRoot || '/tmp/source',
    ignorePatterns: overrides.runtimeOptions?.ignorePatterns || ['.config/**'],
    buildCommitMessage: overrides.runtimeOptions?.buildCommitMessage || function buildCommitMessage() {
      return 'sync(todos): save local data snapshot';
    }
  };

  const defaultDependencies = {
    stateStore: {
      loadState() {
        return {...persistedState};
      },
      saveState(nextState) {
        Object.assign(persistedState, nextState);
        return {...persistedState};
      }
    },
    backend: {
      ensureReady() {
        activityLog.push('ensureReady');
      },
      syncWorkingTree(args) {
        activityLog.push(['syncWorkingTree', args]);
      },
      hasChanges() {
        activityLog.push('hasChanges');
        return true;
      },
      commit() {
        activityLog.push('commit');
      },
      fetch() {
        activityLog.push('fetch');
      },
      integrate() {
        activityLog.push('integrate');
      },
      push() {
        activityLog.push('push');
      },
      getStatus() {
        return '## main';
      }
    }
  };

  const dependencies = {
    ...defaultDependencies,
    ...(overrides.dependencies || {})
  };

  return {runtimeOptions, dependencies, persistedState, activityLog};
}

function createAdvancedRuntimeFromHarness(harness) {
  const {createSyncRuntimeAdvanced} = loadAdvanced();

  return createSyncRuntimeAdvanced({
    ...harness.runtimeOptions,
    stateStore: harness.dependencies.stateStore,
    backend: harness.dependencies.backend
  });
}

function createFlatRuntimeScenario(overrides = {}) {
  const events = [];
  const buildCommitContexts = [];
  const state = overrides.state || {
    enabled: true,
    status: 'healthy',
    hasPendingRemote: false,
    retryCount: 0,
    backoffUntil: null,
    lastErrorKind: null,
    lastErrorMessage: null,
    lastSyncReason: null,
    lastPhase: null,
    lastSnapshotId: null,
    lastSyncedSnapshotId: null
  };

  const backend = overrides.backend || {
    ensureReady() {
      events.push('ensureReady');
    },
    syncWorkingTree(args) {
      events.push(['syncWorkingTree', args]);
    },
    hasChanges() {
      events.push('hasChanges');
      return true;
    },
    commit(message) {
      events.push(['commit', message]);
    },
    fetch() {
      events.push('fetch');
    },
    integrate() {
      events.push('integrate');
    },
    push() {
      events.push('push');
    },
    getStatus() {
      return '## main';
    }
  };

  const stateStore = overrides.stateStore || {
    loadState() {
      events.push('loadState');
      return {...state};
    },
    saveState(nextState) {
      events.push(['saveState', nextState]);
      Object.assign(state, nextState);
      return {...state};
    }
  };

  const runtimeOptions = {
    enabled: true,
    remoteUrl: '/tmp/flat-remote.git',
    branch: 'main',
    autoSync: true,
    autoPull: true,
    autoPush: true,
    sourceRoot: '/tmp/flat-source',
    ignorePatterns: ['.config/**'],
    buildCommitMessage(context) {
      buildCommitContexts.push(context);
      return 'sync(todos): save local data snapshot';
    },
    ...overrides.runtimeOptions
  };

  return {
    events,
    state,
    backend,
    stateStore,
    runtimeOptions,
    buildCommitContexts
  };
}

function loadFlatRuntimeWithScenario(overrides = {}) {
  const scenario = createFlatRuntimeScenario(overrides);
  const engine = loadEngineWithCoreStubs({
    gitCliBackendExports: {
      createGitCliBackend() {
        return scenario.backend;
      }
    },
    fileStoreExports: {
      createFileStateStore() {
        return scenario.stateStore;
      }
    }
  });

  return {
    ...engine,
    scenario
  };
}

test('sync engine accepts flat runtime options without requiring adapter', () => {
  const {createSyncRuntime, restore, scenario} = loadFlatRuntimeWithScenario();

  try {
    assert.doesNotThrow(() => createSyncRuntime(scenario.runtimeOptions));
  } finally {
    restore();
  }
});

test('sync engine flat runtime starts with a coherent initial status', () => {
  const {createSyncRuntime, restore, scenario} = loadFlatRuntimeWithScenario();

  try {
    const runtime = createSyncRuntime(scenario.runtimeOptions);
    const status = runtime.getSyncStatus();

    assert.equal(status.enabled, true);
    assert.equal(status.status, 'healthy');
    assert.equal(status.hasPendingRemote, false);
    assert.equal(status.retryCount, 0);
    assert.equal(status.lastErrorKind, null);
    assert.equal(status.lastErrorMessage, null);
  } finally {
    restore();
  }
});

test('sync engine flat runtime uses sourceRoot and ignorePatterns during notifyLocalMutation', async () => {
  const {createSyncRuntime, restore, scenario} = loadFlatRuntimeWithScenario();

  try {
    const runtime = createSyncRuntime(scenario.runtimeOptions);

    await runtime.notifyLocalMutation({domain: 'todos', action: 'save'});

    assert.deepEqual(scenario.events.find(event => Array.isArray(event) && event[0] === 'syncWorkingTree'), [
      'syncWorkingTree',
      {
        sourceRoot: '/tmp/flat-source',
        ignorePatterns: ['.config/**']
      }
    ]);
  } finally {
    restore();
  }
});

test('sync engine flat runtime builds commit messages from the mutation context', async () => {
  const {createSyncRuntime, restore, scenario} = loadFlatRuntimeWithScenario();

  try {
    const runtime = createSyncRuntime(scenario.runtimeOptions);
    const context = {domain: 'todos', action: 'save'};

    await runtime.notifyLocalMutation(context);

    assert.deepEqual(scenario.buildCommitContexts, [context]);
    assert.deepEqual(scenario.events.find(event => Array.isArray(event) && event[0] === 'commit'), [
      'commit',
      'sync(todos): save local data snapshot'
    ]);
  } finally {
    restore();
  }
});

test('sync engine flat runtime rejects enabled sync without remoteUrl', () => {
  const scenario = createFlatRuntimeScenario({
    runtimeOptions: {
      remoteUrl: ''
    }
  });
  const {createSyncRuntime} = loadEngine();

  assert.throws(() => createSyncRuntime(scenario.runtimeOptions), /remoteUrl/i);
});

test('sync engine reads config from normalized runtime options instead of raw adapter config', () => {
  const normalized = {
    config: {
      enabled: false,
      remoteUrl: '/tmp/normalized-remote.git',
      branch: 'main',
      autoSync: true,
      autoPull: true,
      autoPush: true
    },
    sourceRoot: '/tmp/normalized-source',
    ignorePatterns: ['.config/**'],
    buildCommitMessage() {
      return 'sync(data): save local data snapshot';
    },
    stateStore: {
      loadState() {
        return {
          enabled: true,
          status: 'healthy'
        };
      },
      saveState(nextState) {
        return nextState;
      }
    },
    backend: {
      ensureReady() {},
      syncWorkingTree() {},
      hasChanges() {
        return false;
      },
      commit() {},
      fetch() {},
      integrate() {},
      push() {}
    }
  };
  const {createSyncRuntime, restore} = loadEngineWithRuntimeStubs({
    runtimeOptionsExports: {
      normalizeRuntimeOptions(options) {
        assert.equal(typeof options.adapter?.getSyncConfig, 'function');
        return normalized;
      }
    },
    defaultsExports: {
      resolveRuntimeDependencies() {
        return normalized;
      }
    }
  });

  try {
    const runtime = createSyncRuntime({
      adapter: {
        getSyncConfig() {
          return {
            enabled: true,
            remoteUrl: '/tmp/raw-remote.git',
            branch: 'main'
          };
        }
      }
    });

    const status = runtime.getSyncStatus();

    assert.equal(status.enabled, false);
    assert.equal(status.status, 'disabled');
  } finally {
    restore();
  }
});

test('sync engine uses normalized dependencies and pipeline inputs after runtime normalization', async () => {
  const events = [];
  const commitContexts = [];
  const normalized = {
    config: {
      enabled: true,
      remoteUrl: '/tmp/normalized-remote.git',
      branch: 'main',
      autoSync: true,
      autoPull: true,
      autoPush: true
    },
    sourceRoot: '/tmp/normalized-source',
    ignorePatterns: ['.cache/**'],
    buildCommitMessage(context) {
      commitContexts.push(context);
      return `normalized:${context.action}`;
    },
    stateStore: {
      loadState() {
        events.push('loadState');
        return {
          enabled: true,
          status: 'healthy',
          hasPendingRemote: false,
          retryCount: 0,
          backoffUntil: null,
          lastErrorKind: null,
          lastErrorMessage: null,
          lastSyncReason: null,
          lastPhase: null,
          lastSnapshotId: null,
          lastSyncedSnapshotId: null
        };
      },
      saveState(nextState) {
        events.push(['saveState', nextState.status]);
        return nextState;
      }
    },
    backend: {
      ensureReady() {
        events.push('ensureReady');
      },
      syncWorkingTree(args) {
        events.push(['syncWorkingTree', args]);
      },
      hasChanges() {
        events.push('hasChanges');
        return true;
      },
      commit(message) {
        events.push(['commit', message]);
      },
      fetch() {
        events.push('fetch');
      },
      integrate() {
        events.push('integrate');
      },
      push() {
        events.push('push');
      }
    }
  };
  const {createSyncRuntime, restore} = loadEngineWithRuntimeStubs({
    runtimeOptionsExports: {
      normalizeRuntimeOptions() {
        return normalized;
      }
    },
    defaultsExports: {
      resolveRuntimeDependencies() {
        return normalized;
      }
    }
  });

  try {
    const runtime = createSyncRuntime({
      adapter: {
        getSourceRoot() {
          throw new Error('engine should not read adapter sourceRoot after normalization');
        },
        getIgnorePatterns() {
          throw new Error('engine should not read adapter ignorePatterns after normalization');
        },
        buildCommitMessage() {
          throw new Error('engine should not read adapter buildCommitMessage after normalization');
        }
      }
    });
    const context = {domain: 'todos', action: 'save'};

    await runtime.notifyLocalMutation(context);

    assert.deepEqual(commitContexts, [context]);
    assert.deepEqual(events.filter(event => event !== 'loadState' && !(Array.isArray(event) && event[0] === 'saveState')), [
      'ensureReady',
      ['syncWorkingTree', {
        sourceRoot: '/tmp/normalized-source',
        ignorePatterns: ['.cache/**']
      }],
      'hasChanges',
      ['commit', 'normalized:save'],
      'fetch',
      'integrate',
      'push'
    ]);
  } finally {
    restore();
  }
});

test('sync engine flat runtime applies defaults for optional fields during normalization', async () => {
  const {createSyncRuntime, restore, scenario} = loadFlatRuntimeWithScenario({
    runtimeOptions: {
      branch: undefined,
      autoSync: undefined,
      autoPull: undefined,
      autoPush: undefined,
      ignorePatterns: undefined,
      buildCommitMessage: undefined
    }
  });

  try {
    const runtime = createSyncRuntime(scenario.runtimeOptions);

    await runtime.notifyLocalMutation({});

    assert.deepEqual(scenario.events.find(event => Array.isArray(event) && event[0] === 'syncWorkingTree'), [
      'syncWorkingTree',
      {
        sourceRoot: '/tmp/flat-source',
        ignorePatterns: []
      }
    ]);
    assert.deepEqual(scenario.events.find(event => Array.isArray(event) && event[0] === 'commit'), [
      'commit',
      'sync(data): save local data snapshot'
    ]);
  } finally {
    restore();
  }
});

test('sync engine flat runtime resolves default backend and state store internally with state coherent to config.enabled', () => {
  const created = {
    backendOptions: null,
    stateStoreOptions: null,
    savedStates: []
  };
  const {createSyncRuntime, restore} = loadEngineWithCoreStubs({
    gitCliBackendExports: {
      createGitCliBackend(options) {
        created.backendOptions = options;
        return {
          ensureReady() {},
          syncWorkingTree() {},
          hasChanges() {
            return false;
          },
          commit() {},
          fetch() {},
          integrate() {},
          push() {},
          getStatus() {
            return '## main';
          }
        };
      }
    },
    fileStoreExports: {
      createFileStateStore(options) {
        created.stateStoreOptions = options;

        return {
          defaultState: options.defaultState,
          getStateFilePath: options.getStateFilePath,
          loadState() {
            return options.defaultState();
          },
          saveState(state) {
            created.savedStates.push(state);
            return state;
          }
        };
      }
    }
  });

  try {
    const runtime = createSyncRuntime({
      enabled: true,
      remoteUrl: '/tmp/flat-remote.git',
      branch: 'main',
      autoSync: false,
      autoPull: true,
      autoPush: true,
      sourceRoot: '/tmp/flat-source',
      ignorePatterns: ['.config/**']
    });

    const status = runtime.getSyncStatus();

    assert.deepEqual(created.backendOptions, {
      repoPath: '/tmp/flat-source',
      branch: 'main',
      remote: 'origin',
      remoteUrl: '/tmp/flat-remote.git',
      ignorePatterns: ['.config/**', '.config/sync-state.json']
    });
    assert.equal(typeof created.stateStoreOptions.defaultState, 'function');
    assert.equal(created.stateStoreOptions.getStateFilePath(), path.join('/tmp/flat-source', '.config', 'sync-state.json'));
    assert.equal(created.stateStoreOptions.defaultState().enabled, true);
    assert.equal(status.enabled, true);
    assert.equal(status.status, 'healthy');
    assert.deepEqual(created.savedStates[0], status);
  } finally {
    restore();
  }
});

test('sync engine flat runtime skips fetch and integrate when autoPull is false', async () => {
  const {createSyncRuntime, restore, scenario} = loadFlatRuntimeWithScenario({
    runtimeOptions: {
      autoPull: false,
      autoPush: true
    }
  });

  try {
    const runtime = createSyncRuntime(scenario.runtimeOptions);

    await runtime.notifyLocalMutation({domain: 'todos', action: 'save'});

    assert.equal(scenario.events.includes('fetch'), false);
    assert.equal(scenario.events.includes('integrate'), false);
    assert.equal(scenario.events.includes('push'), true);
  } finally {
    restore();
  }
});

test('sync engine keeps public pending flags coherent when autoSync is false after local mutation', async () => {
  const {createSyncRuntime, restore, scenario} = loadFlatRuntimeWithScenario({
    runtimeOptions: {
      autoSync: false
    }
  });

  try {
    const runtime = createSyncRuntime(scenario.runtimeOptions);

    const status = await runtime.notifyLocalMutation({domain: 'todos', action: 'save'});

    assert.equal(status.status, 'pending_remote');
    assert.equal(status.hasPendingRemote, true);
    assert.equal(runtime.machine.current, 'pending_remote');
    assert.equal(runtime.machine.context.hasPendingRemote, true);
    assert.equal(scenario.events.includes('fetch'), false);
    assert.equal(scenario.events.includes('push'), false);
  } finally {
    restore();
  }
});

test('sync engine flat runtime skips push when autoPush is false', async () => {
  const {createSyncRuntime, restore, scenario} = loadFlatRuntimeWithScenario({
    runtimeOptions: {
      autoPull: true,
      autoPush: false
    }
  });

  try {
    const runtime = createSyncRuntime(scenario.runtimeOptions);

    await runtime.notifyLocalMutation({domain: 'todos', action: 'save'});

    assert.equal(scenario.events.includes('fetch'), true);
    assert.equal(scenario.events.includes('integrate'), true);
    assert.equal(scenario.events.includes('push'), false);
  } finally {
    restore();
  }
});

test('sync advanced runtime accepts explicit dependency injection without changing the main API', () => {
  const {createSyncRuntime} = loadEngine();
  const {createSyncRuntimeAdvanced} = loadAdvanced();
  const scenario = createFlatRuntimeScenario();

  assert.equal(typeof createSyncRuntimeAdvanced, 'function');
  assert.throws(() => createSyncRuntime({
    config: {
      enabled: true,
      remoteUrl: '/tmp/advanced-remote.git',
      branch: 'main',
      autoSync: true,
      autoPull: true,
      autoPush: true
    },
    sourceRoot: '/tmp/advanced-source',
    stateStore: scenario.stateStore,
    backend: scenario.backend
  }), /config|stateStore|backend/i);

  const runtime = createSyncRuntimeAdvanced({
    config: {
      enabled: true,
      remoteUrl: '/tmp/advanced-remote.git',
      branch: 'main',
      autoSync: true,
      autoPull: true,
      autoPush: true
    },
    sourceRoot: '/tmp/advanced-source',
    ignorePatterns: ['.config/**'],
    buildCommitMessage(context) {
      scenario.buildCommitContexts.push(context);
      return 'sync(test): save local data snapshot';
    },
    stateStore: scenario.stateStore,
    backend: scenario.backend
  });

  assert.equal(typeof runtime.getSyncStatus, 'function');
});

test('sync advanced runtime shares runtime semantics with the main API while using explicit dependencies', async () => {
  const {createSyncRuntimeAdvanced} = loadAdvanced();
  const scenario = createFlatRuntimeScenario();
  const runtime = createSyncRuntimeAdvanced({
    config: {
      enabled: true,
      remoteUrl: '/tmp/advanced-remote.git',
      branch: 'main',
      autoSync: true,
      autoPull: true,
      autoPush: true
    },
    sourceRoot: '/tmp/advanced-source',
    ignorePatterns: ['.config/**'],
    buildCommitMessage(context) {
      scenario.buildCommitContexts.push(context);
      return 'sync(test): save local data snapshot';
    },
    stateStore: scenario.stateStore,
    backend: scenario.backend
  });

  await runtime.notifyLocalMutation({domain: 'test', action: 'save'});

  assert.deepEqual(scenario.events.find(event => Array.isArray(event) && event[0] === 'syncWorkingTree'), [
    'syncWorkingTree',
    {
      sourceRoot: '/tmp/advanced-source',
      ignorePatterns: ['.config/**']
    }
  ]);
  assert.deepEqual(scenario.events.find(event => Array.isArray(event) && event[0] === 'commit'), [
    'commit',
    'sync(test): save local data snapshot'
  ]);
  assert.deepEqual(scenario.buildCommitContexts, [{domain: 'test', action: 'save'}]);
  assert.equal(runtime.getSyncStatus().status, 'healthy');
});

test('sync advanced runtime test harness no longer exposes old top-level keys', () => {
  const harness = createHarness();

  assert.deepEqual(Object.keys(harness).sort(), [
    'activityLog',
    'dependencies',
    'persistedState',
    'runtimeOptions'
  ]);
  assert.equal('adapter' in harness, false);
  assert.equal('stateStore' in harness, false);
  assert.equal('backend' in harness, false);
  assert.equal('state' in harness, false);
  assert.equal('events' in harness, false);
});

test('sync engine loads persisted state and reports status', () => {
  const harness = createHarness({persistedState: {enabled: false, status: 'disabled'}});

  const runtime = createAdvancedRuntimeFromHarness(harness);
  const status = runtime.getSyncStatus();

  assert.equal(status.status, 'disabled');
  assert.equal(status.enabled, false);
});

test('sync engine preserves snapshot identifiers from persisted state on boot', () => {
  const harness = createHarness({
    persistedState: {
      enabled: true,
      status: 'pending_remote',
      hasPendingRemote: true,
      retryCount: 0,
      lastErrorKind: null,
      lastErrorMessage: null,
      lastSyncReason: 'save',
      lastPhase: 'commit',
      lastSnapshotId: 'snap-123',
      lastSyncedSnapshotId: 'snap-122'
    }
  });

  const runtime = createAdvancedRuntimeFromHarness(harness);
  const status = runtime.getSyncStatus();

  assert.equal(status.lastSnapshotId, 'snap-123');
  assert.equal(status.lastSyncedSnapshotId, 'snap-122');
  assert.equal(harness.persistedState.lastSnapshotId, 'snap-123');
  assert.equal(harness.persistedState.lastSyncedSnapshotId, 'snap-122');
});

test('sync engine bootstraps misconfigured state when sync is enabled without remote url', () => {
  const harness = createHarness({
    runtimeOptions: {
      config: {
        enabled: true,
        remoteUrl: '',
        branch: 'main',
        autoSync: true,
        autoPull: true,
        autoPush: true
      },
      sourceRoot: '/tmp/source',
      ignorePatterns: ['.config/**'],
      buildCommitMessage() {
        return 'sync(todos): save local data snapshot';
      }
    }
  });

  const runtime = createAdvancedRuntimeFromHarness(harness);
  const status = runtime.getSyncStatus();

  assert.equal(status.status, 'misconfigured');
  assert.equal(harness.persistedState.status, 'misconfigured');
});

test('sync engine marks pending remote and runs snapshot/fetch/integrate/push in order', async () => {
  const harness = createHarness();
  const runtime = createAdvancedRuntimeFromHarness(harness);

  await runtime.notifyLocalMutation({domain: 'todos', action: 'save'});

  assert.deepEqual(harness.activityLog[1], [
    'syncWorkingTree',
    {
      sourceRoot: '/tmp/source',
      ignorePatterns: ['.config/**']
    }
  ]);
  assert.deepEqual(harness.activityLog.filter(event => typeof event === 'string').slice(0, 5), [
    'ensureReady',
    'hasChanges',
    'commit',
    'fetch',
    'integrate'
  ]);
  assert.equal(harness.activityLog.includes('push'), true);
  assert.equal(runtime.getSyncStatus().status, 'healthy');
});

test('sync engine maps backend failures to degraded state and persists pending remote', async () => {
  const harness = createHarness({
    dependencies: {
      backend: {
        ensureReady() {},
        syncWorkingTree() {},
        hasChanges() { return true; },
        commit() {},
        fetch() { throw new Error('Could not resolve host github.com'); },
        integrate() {},
        push() {},
        getStatus() { return '## main'; }
      }
    }
  });
  const runtime = createAdvancedRuntimeFromHarness(harness);

  await runtime.notifyLocalMutation({domain: 'todos', action: 'save'});

  const status = runtime.getSyncStatus();
  assert.equal(status.status, 'degraded_network');
  assert.equal(status.hasPendingRemote, true);
  assert.equal(status.lastErrorKind, 'network');
});

test('sync engine accepts a local mutation after a failed sync with valid setup', async () => {
  const harness = createHarness({
    persistedState: {
      enabled: true,
      status: 'failed',
      hasPendingRemote: true,
      retryCount: 1,
      lastErrorKind: 'unknown',
      lastErrorMessage: 'provider failed',
      lastSyncReason: 'save'
    }
  });
  const runtime = createAdvancedRuntimeFromHarness(harness);

  await assert.doesNotReject(runtime.notifyLocalMutation({domain: 'todos', action: 'save-again'}));

  assert.equal(runtime.getSyncStatus().status, 'healthy');
  assert.equal(harness.persistedState.status, 'healthy');
  assert.equal(harness.persistedState.hasPendingRemote, false);
});

test('sync engine coalesces repeated mutation calls while syncing', async () => {
  let release;
  const harness = createHarness({
    dependencies: {
      backend: {
        ensureReady() {},
        syncWorkingTree() {},
        hasChanges() { return true; },
        commit() {},
        fetch() {
          return new Promise(resolve => {
            release = resolve;
          });
        },
        integrate() {},
        push() {},
        getStatus() { return '## main'; }
      }
    }
  });
  const runtime = createAdvancedRuntimeFromHarness(harness);

  const first = runtime.notifyLocalMutation({domain: 'todos', action: 'save'});
  const second = runtime.notifyLocalMutation({domain: 'todos', action: 'save'});
  await new Promise(resolve => setImmediate(resolve));
  release();

  await Promise.all([first, second]);

  assert.equal(runtime.getSyncStatus().status, 'healthy');
});

test('sync engine rehydrates stale syncing state as pending remote and syncs next mutation', async () => {
  const harness = createHarness({
    persistedState: {
      enabled: true,
      status: 'syncing',
      hasPendingRemote: true,
      retryCount: 0,
      lastErrorKind: null,
      lastErrorMessage: null
    }
  });
  const runtime = createAdvancedRuntimeFromHarness(harness);

  await runtime.notifyLocalMutation({domain: 'boards', action: 'add-card'});

  assert.equal(runtime.getSyncStatus().status, 'healthy');
  assert.equal(harness.persistedState.status, 'healthy');
  assert.equal(harness.persistedState.hasPendingRemote, false);
});

test('sync engine retry uses retry transition for degraded states and preserves pending flag on boot', async () => {
  const harness = createHarness({
    persistedState: {
      enabled: true,
      status: 'degraded_network',
      hasPendingRemote: true,
      retryCount: 1,
      lastErrorKind: 'network'
    }
  });
  const runtime = createAdvancedRuntimeFromHarness(harness);

  await runtime.retry({reason: 'manual'});

  assert.equal(runtime.getSyncStatus().status, 'healthy');
  assert.equal(runtime.machine.context.hasPendingRemote, false);
});

test('sync engine retry also works from pending_remote bootstrap state', async () => {
  const harness = createHarness({
    persistedState: {
      enabled: true,
      status: 'pending_remote',
      hasPendingRemote: true,
      retryCount: 0,
      lastErrorKind: null
    }
  });
  const runtime = createAdvancedRuntimeFromHarness(harness);

  await runtime.retry({reason: 'init'});

  assert.equal(runtime.getSyncStatus().status, 'healthy');
});

test('sync engine does not preserve stale misconfigured state when config is currently valid', () => {
  const harness = createHarness({
    persistedState: {
      enabled: true,
      status: 'misconfigured',
      hasPendingRemote: false,
      retryCount: 0,
      lastErrorKind: null,
      lastErrorMessage: null,
      lastSyncReason: null,
      lastPhase: null,
      lastSnapshotId: null,
      lastSyncedSnapshotId: null
    }
  });

  const runtime = createAdvancedRuntimeFromHarness(harness);
  const status = runtime.getSyncStatus();

  assert.equal(status.status, 'healthy');
  assert.equal(harness.persistedState.status, 'healthy');
});

test('sync engine clears stale pending and error flags when healthy state is rehydrated', () => {
  const harness = createHarness({
    persistedState: {
      enabled: true,
      status: 'healthy',
      hasPendingRemote: true,
      retryCount: 2,
      lastErrorKind: 'unknown',
      lastErrorMessage: 'stale error',
      lastSyncReason: 'save',
      lastPhase: null,
      lastSnapshotId: null,
      lastSyncedSnapshotId: null
    }
  });

  const runtime = createAdvancedRuntimeFromHarness(harness);
  const status = runtime.getSyncStatus();

  assert.equal(status.status, 'healthy');
  assert.equal(status.hasPendingRemote, false);
  assert.equal(status.lastErrorKind, null);
  assert.equal(status.lastErrorMessage, null);
  assert.equal(harness.persistedState.hasPendingRemote, false);
  assert.equal(harness.persistedState.lastErrorKind, null);
  assert.equal(harness.persistedState.lastErrorMessage, null);
});

test('sync consumer calls core runtime with flat options from ilu adapter by default', async () => {
  const captured = {
    engineCalls: 0,
    runtimeArgs: []
  };
  const runtime = {
    async notifyLocalMutation(context) {
      return {kind: 'notified', context};
    },
    getSyncStatus() {
      return {status: 'healthy'};
    },
    async retry(context) {
      return {kind: 'retried', context};
    }
  };

  const {syncIndex, restore} = loadSyncConsumer({
    engineExports: {
      createSyncRuntime(args) {
        captured.engineCalls += 1;
        captured.runtimeArgs.push(args);
        return runtime;
      }
    },
    adapterExports: {
      getSyncConfig() {
        return {
          enabled: true,
          remoteUrl: '/tmp/consumer-remote.git',
          branch: 'trunk',
          autoSync: true,
          autoPull: true,
          autoPush: true
        };
      },
      getSourceRoot() {
        return '/tmp/consumer-source';
      },
      getIgnorePatterns() {
        return ['.config/**'];
      },
      buildCommitMessage() {
        return 'sync(todos): save local data snapshot';
      }
    },
    backendExports: {
      createGitCliBackend() {
        throw new Error('default consumer runtime should not build backend outside core');
      }
    },
    stateStoreExports: {
      saveState() {
        throw new Error('default consumer runtime should not inject state store');
      }
    }
  });

  try {
    const createdRuntime = syncIndex.createSyncRuntime();

    assert.equal(createdRuntime, runtime);
    assert.equal(captured.engineCalls, 1);
    assert.deepEqual(captured.runtimeArgs[0], {
      enabled: true,
      remoteUrl: '/tmp/consumer-remote.git',
      branch: 'trunk',
      autoSync: true,
      autoPull: true,
      autoPush: true,
      sourceRoot: '/tmp/consumer-source',
      ignorePatterns: ['.config/**'],
      buildCommitMessage: captured.runtimeArgs[0].buildCommitMessage
    });
    assert.equal(typeof captured.runtimeArgs[0].buildCommitMessage, 'function');
    assert.equal('backend' in captured.runtimeArgs[0], false);
    assert.equal('stateStore' in captured.runtimeArgs[0], false);

    await syncIndex.notifyLocalMutation({domain: 'todos', action: 'save'});
    assert.equal(captured.engineCalls, 1);
    assert.deepEqual(syncIndex.getSyncStatus(), {status: 'healthy'});
  } finally {
    restore();
  }
});
