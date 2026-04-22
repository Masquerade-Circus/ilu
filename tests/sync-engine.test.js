const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const engineModulePath = path.join(repoRoot, 'sync', 'engine.js');

function loadEngine() {
  delete require.cache[require.resolve(engineModulePath)];
  return require(engineModulePath);
}

function createHarness(overrides = {}) {
  const events = [];
  const state = overrides.state || {
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

  const adapter = overrides.adapter || {
    getSyncConfig() {
      return {
        enabled: state.enabled !== false,
        remoteUrl: '/tmp/remote.git',
        branch: 'main',
        autoSync: true,
        autoPull: true,
        autoPush: true
      };
    },
    getSourceRoot() {
      return '/tmp/source';
    },
    listTrackedEntries() {
      return ['todos.json'];
    },
    buildCommitMessage() {
      return 'sync(todos): save local data snapshot';
    },
    logger: {
      info(message) {
        events.push(['info', message]);
      },
      warn(message) {
        events.push(['warn', message]);
      },
      error(message) {
        events.push(['error', message]);
      },
      debug(message) {
        events.push(['debug', message]);
      }
    },
    now() {
      return 100;
    }
  };

  const stateStore = overrides.stateStore || {
    loadState() {
      return {...state};
    },
    saveState(nextState) {
      Object.assign(state, nextState);
      return {...state};
    }
  };

  const backend = overrides.backend || {
    ensureReady() {
      events.push('ensureReady');
    },
    syncWorkingTree() {
      events.push('syncWorkingTree');
    },
    hasChanges() {
      events.push('hasChanges');
      return true;
    },
    commit() {
      events.push('commit');
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

  return {adapter, stateStore, backend, state, events};
}

test('sync engine loads persisted state and reports status', () => {
  const {createSyncRuntime} = loadEngine();
  const harness = createHarness({state: {enabled: false, status: 'disabled'}});

  const runtime = createSyncRuntime(harness);
  const status = runtime.getSyncStatus();

  assert.equal(status.status, 'disabled');
  assert.equal(status.enabled, false);
});

test('sync engine marks pending remote and runs snapshot/fetch/integrate/push in order', async () => {
  const {createSyncRuntime} = loadEngine();
  const harness = createHarness();
  const runtime = createSyncRuntime(harness);

  await runtime.notifyLocalMutation({domain: 'todos', action: 'save'});

  assert.deepEqual(harness.events.slice(0, 6), [
    'ensureReady',
    'syncWorkingTree',
    'hasChanges',
    'commit',
    'fetch',
    'integrate'
  ]);
  assert.equal(harness.events.includes('push'), true);
  assert.equal(runtime.getSyncStatus().status, 'healthy');
});

test('sync engine maps backend failures to degraded state and persists pending remote', async () => {
  const {createSyncRuntime} = loadEngine();
  const harness = createHarness({
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
  });
  const runtime = createSyncRuntime(harness);

  await runtime.notifyLocalMutation({domain: 'todos', action: 'save'});

  const status = runtime.getSyncStatus();
  assert.equal(status.status, 'degraded_network');
  assert.equal(status.hasPendingRemote, true);
  assert.equal(status.lastErrorKind, 'network');
});

test('sync engine coalesces repeated mutation calls while syncing', async () => {
  const {createSyncRuntime} = loadEngine();
  let release;
  const harness = createHarness({
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
  });
  const runtime = createSyncRuntime(harness);

  const first = runtime.notifyLocalMutation({domain: 'todos', action: 'save'});
  const second = runtime.notifyLocalMutation({domain: 'todos', action: 'save'});
  await new Promise(resolve => setImmediate(resolve));
  release();

  await Promise.all([first, second]);

  assert.equal(runtime.getSyncStatus().status, 'healthy');
});

test('sync engine retry uses retry transition for degraded states and preserves pending flag on boot', async () => {
  const {createSyncRuntime} = loadEngine();
  const harness = createHarness({
    state: {
      enabled: true,
      status: 'degraded_network',
      hasPendingRemote: true,
      retryCount: 1,
      lastErrorKind: 'network'
    }
  });
  const runtime = createSyncRuntime(harness);

  await runtime.retry({reason: 'manual'});

  assert.equal(runtime.getSyncStatus().status, 'healthy');
  assert.equal(runtime.machine.context.hasPendingRemote, false);
});

test('sync engine retry also works from pending_remote bootstrap state', async () => {
  const {createSyncRuntime} = loadEngine();
  const harness = createHarness({
    state: {
      enabled: true,
      status: 'pending_remote',
      hasPendingRemote: true,
      retryCount: 0,
      lastErrorKind: null
    }
  });
  const runtime = createSyncRuntime(harness);

  await runtime.retry({reason: 'init'});

  assert.equal(runtime.getSyncStatus().status, 'healthy');
});

test('sync engine does not preserve stale misconfigured state when config is currently valid', () => {
  const {createSyncRuntime} = loadEngine();
  const harness = createHarness({
    state: {
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

  const runtime = createSyncRuntime(harness);
  const status = runtime.getSyncStatus();

  assert.equal(status.status, 'healthy');
  assert.equal(harness.state.status, 'healthy');
});

test('sync engine clears stale pending and error flags when healthy state is rehydrated', () => {
  const {createSyncRuntime} = loadEngine();
  const harness = createHarness({
    state: {
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

  const runtime = createSyncRuntime(harness);
  const status = runtime.getSyncStatus();

  assert.equal(status.status, 'healthy');
  assert.equal(status.hasPendingRemote, false);
  assert.equal(status.lastErrorKind, null);
  assert.equal(status.lastErrorMessage, null);
  assert.equal(harness.state.hasPendingRemote, false);
  assert.equal(harness.state.lastErrorKind, null);
  assert.equal(harness.state.lastErrorMessage, null);
});
