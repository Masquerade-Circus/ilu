const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const hooksModulePath = path.join(repoRoot, 'sync', 'ilu-hooks.ts');
const syncIndexModulePath = path.join(repoRoot, 'sync', 'index.ts');
const logModulePath = path.join(repoRoot, 'utils', 'log.ts');

function loadHooks(events, options: any = {}) {
  const originalLoad = Module._load;

  delete require.cache[require.resolve(hooksModulePath)];
  delete require.cache[require.resolve(syncIndexModulePath)];
  delete require.cache[require.resolve(logModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './index' && parent && parent.filename === hooksModulePath) {
      return {
        getSyncConfig() {
          return options.config || {enabled: true, remoteUrl: './remote.git', autoSync: true};
        },
        notifyLocalMutation: async (context) => {
          events.push(['sync', context]);

          if (typeof options.notifyLocalMutation === 'function') {
            return options.notifyLocalMutation(context);
          }

          return {status: 'healthy', hasPendingRemote: false};
        }
      };
    }

    if (request === '../utils/log' && parent && parent.filename === hooksModulePath) {
      return {
        info(message) {
          events.push(['log.info', message]);
        }
      };
    }

    return originalLoad.apply(this, arguments);
  };

  return {
    notifySync: require(hooksModulePath),
    restore() {
      Module._load = originalLoad;
      delete require.cache[require.resolve(hooksModulePath)];
      delete require.cache[require.resolve(syncIndexModulePath)];
      delete require.cache[require.resolve(logModulePath)];
    }
  };
}

test('ilu sync hook logs syncing before notifying a local mutation', async () => {
  const events = [];
  const {notifySync, restore} = loadHooks(events);

  try {
    const context = {domain: 'todos', action: 'save'};

    notifySync(context);
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(events, [
      ['log.info', 'Syncing...'],
      ['sync', context]
    ]);
  } finally {
    restore();
  }
});

test('ilu sync hook keeps direct auto sync when only a status subscriber is present', async () => {
  const events = [];
  const {notifySync, restore} = loadHooks(events);

  try {
    const statuses = [];
    assert.equal(typeof notifySync.onSyncStatus, 'function');
    const unsubscribe = notifySync.onSyncStatus((status) => statuses.push(status));
    const context = {domain: 'boards', action: 'add-card'};

    notifySync(context);
    await new Promise(resolve => setImmediate(resolve));
    unsubscribe();

    assert.deepEqual(events, [
      ['sync', context]
    ]);
    assert.deepEqual(statuses.map(status => status.state), ['syncing', 'synced']);
    assert.equal(statuses[0].context, context);
  } finally {
    restore();
  }
});


test('ilu sync hook does not debounce direct auto sync with status subscriber only', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const events = [];
  const {notifySync, restore} = loadHooks(events);

  try {
    const statuses = [];
    const firstContext = {domain: 'boards', action: 'add-card'};
    const secondContext = {domain: 'boards', action: 'edit-card'};
    const unsubscribe = notifySync.onSyncStatus((status) => statuses.push(status));

    notifySync(firstContext);
    await new Promise(resolve => setImmediate(resolve));

    notifySync(secondContext);
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(5000);
    await new Promise(resolve => setImmediate(resolve));

    unsubscribe();
    assert.deepEqual(events, [
      ['sync', firstContext],
      ['sync', secondContext]
    ]);
    assert.deepEqual(statuses.map(status => status.state), ['syncing', 'synced', 'syncing', 'synced']);
    assert.equal(statuses[0].context, firstContext);
    assert.equal(statuses[2].context, secondContext);
  } finally {
    restore();
  }
});

test('ilu sync hook flushPending is a no-op when only status subscriber exists', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const events = [];
  const {notifySync, restore} = loadHooks(events);

  try {
    const statuses = [];
    const context = {domain: 'boards', action: 'rename-column'};
    notifySync.onSyncStatus((status) => statuses.push(status));

    notifySync(context);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(typeof notifySync.flushPending, 'function');
    assert.equal(await notifySync.flushPending(), false);
    t.mock.timers.tick(5000);
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(events, [
      ['sync', context]
    ]);
    assert.deepEqual(statuses.map(status => status.state), ['syncing', 'synced']);
  } finally {
    restore();
  }
});

test('ilu sync hook reports failed instead of synced when runtime persists a degraded state', async () => {
  const events = [];
  const {notifySync, restore} = loadHooks(events, {
    notifyLocalMutation: async () => ({status: 'degraded_network', hasPendingRemote: true, lastErrorKind: 'network'})
  });

  try {
    const statuses = [];
    const context = {domain: 'todos', action: 'save'};
    notifySync.onSyncStatus((status) => statuses.push(status));

    notifySync(context);
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(events, [
      ['sync', context]
    ]);
    assert.deepEqual(statuses.map(status => status.state), ['syncing', 'failed']);
    assert.equal(statuses.some(status => status.state === 'synced'), false);
  } finally {
    restore();
  }
});

test('ilu sync hook does not report active syncing when autoSync is disabled', async () => {
  const events = [];
  const {notifySync, restore} = loadHooks(events, {
    config: {enabled: true, autoSync: false},
    notifyLocalMutation: async () => ({status: 'pending_remote', hasPendingRemote: true})
  });

  try {
    const statuses = [];
    notifySync.onSyncStatus((status) => statuses.push(status));

    notifySync({domain: 'todos', action: 'save'});
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(events, [
      ['sync', {domain: 'todos', action: 'save'}]
    ]);
    assert.deepEqual(statuses.map(status => status.state), ['pending']);
    assert.equal(statuses.some(status => status.state === 'syncing'), false);
    assert.equal(statuses.some(status => status.state === 'synced'), false);
  } finally {
    restore();
  }
});

test('ilu sync hook reports setup instead of failed when sync is enabled without remote config', async () => {
  const events = [];
  const {notifySync, restore} = loadHooks(events, {
    config: {enabled: true, remoteUrl: null, branch: 'main', autoSync: true, autoPull: true, autoPush: true},
    notifyLocalMutation: async () => {
      throw new Error('Sync runtime requires remoteUrl when sync is enabled');
    }
  });

  try {
    const statuses = [];
    notifySync.onSyncStatus((status) => statuses.push(status));

    notifySync({domain: 'boards', action: 'add-card'});
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(events, [
      ['sync', {domain: 'boards', action: 'add-card'}]
    ]);
    assert.deepEqual(statuses.map(status => status.state), ['setup']);
    assert.equal(statuses.at(-1).message, 'Sync setup needed');
    assert.equal(statuses.some(status => status.state === 'failed'), false);
  } finally {
    restore();
  }
});


test('ilu sync hook debounces configured TUI runner even without status subscribers', async () => {
  const events = [];
  const {notifySync, restore} = loadHooks(events);

  try {
    const runnerCalls = [];
    const runner = {
      notifyLocalMutation: async (context) => {
        runnerCalls.push(context);
        return {status: 'healthy', hasPendingRemote: false};
      },
      hasPendingWork: () => false
    };
    const restoreRunner = notifySync.configureSyncRunner(runner);
    const context = {domain: 'todos', action: 'save'};

    notifySync(context);
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(events, []);
    assert.deepEqual(runnerCalls, []);

    await notifySync.flushPending();
    restoreRunner();

    assert.deepEqual(events, []);
    assert.deepEqual(runnerCalls, [context]);
  } finally {
    restore();
  }
});



test('ilu sync hook sends interactive mutations through configured TUI runner instead of direct runtime', async () => {
  const events = [];
  const {notifySync, restore} = loadHooks(events);

  try {
    const statuses = [];
    const runnerCalls = [];
    const runner = {
      notifyLocalMutation: async (context) => {
        runnerCalls.push(context);
        return {status: 'healthy', hasPendingRemote: false};
      },
      hasPendingWork: () => false
    };
    const restoreRunner = notifySync.configureSyncRunner(runner);
    const unsubscribe = notifySync.onSyncStatus((status) => statuses.push(status));
    const context = {domain: 'todos', action: 'save'};

    notifySync(context);
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(events, []);
    assert.deepEqual(runnerCalls, []);
    assert.deepEqual(statuses.map(status => status.state), ['pending']);

    await notifySync.flushPending();
    unsubscribe();
    restoreRunner();

    assert.deepEqual(events, []);
    assert.deepEqual(runnerCalls, [context]);
    assert.deepEqual(statuses.map(status => status.state), ['pending', 'syncing', 'synced']);
  } finally {
    restore();
  }
});


test('ilu sync hook preserves setup classification from configured TUI runner errors', async () => {
  const events = [];
  const {notifySync, restore} = loadHooks(events);

  try {
    const statuses = [];
    const runner = {
      notifyLocalMutation: async () => {
        throw new Error('Sync setup needed');
      },
      hasPendingWork: () => false
    };
    const restoreRunner = notifySync.configureSyncRunner(runner);
    const unsubscribe = notifySync.onSyncStatus((status) => statuses.push(status));

    notifySync({domain: 'todos', action: 'save'});
    await new Promise(resolve => setImmediate(resolve));
    await notifySync.flushPending();
    unsubscribe();
    restoreRunner();

    assert.deepEqual(events, []);
    assert.deepEqual(statuses.map(status => status.state), ['pending', 'syncing', 'setup']);
    assert.equal(statuses.some(status => status.state === 'failed'), false);
  } finally {
    restore();
  }
});


test('ilu sync hook completes debounced board move status when runner resolves without a terminal event', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const events = [];
  const {notifySync, restore} = loadHooks(events);

  try {
    const statuses = [];
    let eventListener = null;
    const context = {domain: 'boards', action: 'save'};
    const runner = {
      notifyLocalMutation: async () => {
        eventListener({state: 'syncing', message: 'Syncing...', context});
        return {status: 'healthy', hasPendingRemote: false};
      },
      hasPendingWork: () => false,
      onEvent(listener) {
        eventListener = listener;
        return () => {
          eventListener = null;
        };
      }
    };
    const restoreRunner = notifySync.configureSyncRunner(runner);
    const unsubscribe = notifySync.onSyncStatus((status) => statuses.push(status));

    notifySync(context);
    await new Promise(resolve => setImmediate(resolve));
    await notifySync.flushPending();
    unsubscribe();
    restoreRunner();

    assert.deepEqual(events, []);
    assert.deepEqual(statuses.map(status => status.state), ['pending', 'syncing', 'synced']);
    assert.equal(statuses.at(-1).context, context);
  } finally {
    restore();
  }
});

test('ilu sync hook does not synthesize synced while runner has queued work', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const events = [];
  const {notifySync, restore} = loadHooks(events);

  try {
    const statuses = [];
    let eventListener = null;
    const context = {domain: 'boards', action: 'move-card'};
    const runner = {
      notifyLocalMutation: async () => {
        eventListener({state: 'syncing', message: 'Syncing...', context});
        return {status: 'healthy', hasPendingRemote: false};
      },
      hasPendingWork: () => true,
      onEvent(listener) {
        eventListener = listener;
        return () => {
          eventListener = null;
        };
      }
    };
    const restoreRunner = notifySync.configureSyncRunner(runner);
    const unsubscribe = notifySync.onSyncStatus((status) => statuses.push(status));

    notifySync(context);
    await new Promise(resolve => setImmediate(resolve));
    await notifySync.flushPending();
    unsubscribe();
    restoreRunner();

    assert.deepEqual(events, []);
    assert.deepEqual(statuses.map(status => status.state), ['pending', 'syncing']);
    assert.equal(statuses.some(status => status.state === 'synced'), false);
  } finally {
    restore();
  }
});
