import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return {promise, resolve, reject};
}

test('TUI sync runner rejects malformed IPC messages without touching sync runtime', async () => {
  const { createTuiSyncRunner } = await import('../sync/tui-sync-runner');
  const sent = [];
  let calls = 0;
  const runner = createTuiSyncRunner({
    syncIndex: {
      notifyLocalMutation() {
        calls += 1;
        return {status: 'healthy', hasPendingRemote: false};
      }
    },
    send: (message) => sent.push(message)
  });

  await runner.handleMessage({type: 'sync:mutation', payload: {context: {domain: 'todo'}}});
  await runner.handleMessage({type: 'sync:mutation', payload: {id: 'bad-missing-context'}});
  await runner.handleMessage({type: 'unknown', payload: {id: 'bad-type'}});

  assert.equal(calls, 0);
  assert.deepEqual(sent, [
    {type: 'sync:error', payload: {ok: false, message: 'Invalid sync message'}},
    {type: 'sync:error', payload: {id: 'bad-missing-context', ok: false, message: 'Invalid sync message'}},
    {type: 'sync:error', payload: {id: 'bad-type', ok: false, message: 'Invalid sync message'}}
  ]);
});

test('TUI sync runner keeps one active Git sync and coalesces mutations for the next run', async () => {
  const { createTuiSyncRunner } = await import('../sync/tui-sync-runner');
  const sent = [];
  const first = deferred();
  const second = deferred();
  const calls = [];
  const runner = createTuiSyncRunner({
    syncIndex: {
      notifyLocalMutation(context) {
        calls.push(context);
        return calls.length === 1 ? first.promise : second.promise;
      }
    },
    send: (message) => sent.push(message)
  });

  const firstRequest = runner.handleMessage({type: 'sync:mutation', payload: {id: 'm1', context: {domain: 'todo', action: 'add'}}});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [{domain: 'todo', action: 'add'}]);

  const secondRequest = runner.handleMessage({type: 'sync:mutation', payload: {id: 'm2', context: {domain: 'todo', action: 'edit'}}});
  const thirdRequest = runner.handleMessage({type: 'sync:mutation', payload: {id: 'm3', context: {domain: 'board', action: 'move'}}});
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(calls.length, 1);
  first.resolve({status: 'healthy', hasPendingRemote: false});
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls, [
    {domain: 'todo', action: 'add'},
    {domain: 'board', action: 'move'}
  ]);
  second.resolve({status: 'pending_remote', hasPendingRemote: true});
  await Promise.all([firstRequest, secondRequest, thirdRequest]);

  const results = sent.filter(message => message.type === 'sync:result').map(message => message.payload);
  assert.deepEqual(results, [
    {id: 'm1', ok: true, status: {status: 'healthy', hasPendingRemote: false}},
    {id: 'm2', ok: true, status: {status: 'pending_remote', hasPendingRemote: true}},
    {id: 'm3', ok: true, status: {status: 'pending_remote', hasPendingRemote: true}}
  ]);
  assert.deepEqual(sent.filter(message => message.type === 'sync:event').map(message => message.payload.state), [
    'syncing', 'pending'
  ]);
});


test('TUI sync runner does not start queued mutation after active sync fails', async () => {
  const { createTuiSyncRunner } = await import('../sync/tui-sync-runner');
  const sent = [];
  const first = deferred();
  const calls = [];
  const runner = createTuiSyncRunner({
    syncIndex: {
      notifyLocalMutation(context) {
        calls.push(context);
        return first.promise;
      }
    },
    send: (message) => sent.push(message)
  });

  const firstRequest = runner.handleMessage({type: 'sync:mutation', payload: {id: 'm1', context: {domain: 'todo', action: 'add'}}});
  await new Promise(resolve => setImmediate(resolve));
  const secondRequest = runner.handleMessage({type: 'sync:mutation', payload: {id: 'm2', context: {domain: 'todo', action: 'edit'}}});
  await new Promise(resolve => setImmediate(resolve));

  first.reject(new Error('backend failed'));
  await Promise.all([firstRequest, secondRequest]);

  assert.deepEqual(calls, [
    {domain: 'todo', action: 'add'}
  ]);
  assert.deepEqual(sent.filter(message => message.type === 'sync:event').map(message => message.payload.state), [
    'syncing', 'failed'
  ]);
  assert.deepEqual(sent.filter(message => message.type === 'sync:error').map(message => message.payload), [
    {id: 'm1', ok: false, message: 'Sync failed'},
    {id: 'm2', ok: false, message: 'Sync failed'}
  ]);
});


test('TUI sync runner reports failed instead of setup when a coalesced mutation hits a backend error with valid config', async () => {
  const { createTuiSyncRunner } = await import('../sync/tui-sync-runner');
  const { createSyncRuntimeAdvanced } = await import('../sync-core/advanced');
  const sent = [];
  const firstFetch = deferred();
  let fetchCalls = 0;
  const persistedState = {
    enabled: true,
    status: 'healthy',
    hasPendingRemote: false,
    retryCount: 0,
    lastErrorKind: null,
    lastErrorMessage: null
  };
  const runtime = createSyncRuntimeAdvanced({
    config: {
      enabled: true,
      remoteUrl: 'file://redacted-remote.git',
      branch: 'main',
      autoSync: true,
      autoPull: true,
      autoPush: true
    },
    sourceRoot: './tmp/source',
    ignorePatterns: ['.config/**'],
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
      ensureReady() {},
      syncWorkingTree() {},
      hasChanges() { return true; },
      commit() {},
      fetch() {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return firstFetch.promise;
        }
        throw new Error('simulated backend failure after queued mutation');
      },
      integrate() {},
      push() {},
      getStatus() { return '## main'; }
    }
  });
  const runner = createTuiSyncRunner({
    syncIndex: runtime,
    send: (message) => sent.push(message)
  });

  const firstRequest = runner.handleMessage({type: 'sync:mutation', payload: {id: 'm1', context: {domain: 'todo', action: 'add'}}});
  await new Promise(resolve => setImmediate(resolve));
  const secondRequest = runner.handleMessage({type: 'sync:mutation', payload: {id: 'm2', context: {domain: 'todo', action: 'edit'}}});
  await new Promise(resolve => setImmediate(resolve));

  firstFetch.resolve();
  await Promise.all([firstRequest, secondRequest]);

  assert.deepEqual(sent.filter(message => message.type === 'sync:event').map(message => message.payload.state), [
    'syncing', 'failed'
  ]);
  assert.equal(sent.some(message => message.type === 'sync:event' && message.payload.state === 'setup'), false);
  assert.equal(persistedState.status, 'failed');
  assert.equal(persistedState.hasPendingRemote, true);
  assert.equal(persistedState.lastErrorKind, 'unknown');
});

test('TUI sync runner flush waits for active and queued mutation before shutdown result', async () => {
  const { createTuiSyncRunner } = await import('../sync/tui-sync-runner');
  const sent = [];
  const first = deferred();
  const second = deferred();
  const calls = [];
  let closed = false;
  const runner = createTuiSyncRunner({
    syncIndex: {
      notifyLocalMutation(context) {
        calls.push(context);
        return calls.length === 1 ? first.promise : second.promise;
      },
      getSyncStatus() {
        return {status: 'healthy', hasPendingRemote: false};
      }
    },
    send: (message) => sent.push(message),
    close: () => { closed = true; }
  });

  const mutation = runner.handleMessage({type: 'sync:mutation', payload: {id: 'm1', context: {domain: 'notes', action: 'add'}}});
  await new Promise(resolve => setImmediate(resolve));
  const queued = runner.handleMessage({type: 'sync:mutation', payload: {id: 'm2', context: {domain: 'notes', action: 'edit'}}});
  const flush = runner.handleMessage({type: 'sync:flush', payload: {id: 'flush-1'}});
  const shutdown = runner.handleMessage({type: 'sync:shutdown', payload: {id: 'shutdown-1'}});

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  assert.deepEqual(calls, [{domain: 'notes', action: 'add'}]);

  first.resolve({status: 'healthy', hasPendingRemote: false});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [
    {domain: 'notes', action: 'add'},
    {domain: 'notes', action: 'edit'}
  ]);

  second.resolve({status: 'healthy', hasPendingRemote: false});
  await Promise.all([mutation, queued, flush, shutdown]);

  const resultIds = sent.filter(message => message.type === 'sync:result').map(message => message.payload.id);
  assert.deepEqual(resultIds, ['m1', 'm2', 'flush-1', 'shutdown-1']);
  assert.equal(closed, true);
});

test('TUI sync runner closes after shutdown flush even when close throws', async () => {
  const { createTuiSyncRunner } = await import('../sync/tui-sync-runner');
  const sent = [];
  const closeErrors = [];
  const runner = createTuiSyncRunner({
    syncIndex: {
      getSyncStatus() {
        return {status: 'healthy', hasPendingRemote: false};
      }
    },
    send: (message) => sent.push(message),
    onCloseError(error) {
      closeErrors.push(error.message);
    },
    close() {
      throw new Error('close failed');
    }
  });

  await runner.handleMessage({type: 'sync:shutdown', payload: {id: 'shutdown-throws'}});

  assert.deepEqual(sent.filter(message => message.type === 'sync:result').map(message => message.payload), [
    {id: 'shutdown-throws', ok: true, status: {status: 'healthy', hasPendingRemote: false}}
  ]);
  assert.deepEqual(closeErrors, ['close failed']);
});

test('TUI sync client forks runner with ignored stdout and stderr', async () => {
  const { createTuiSyncClient } = await import('../sync/tui-sync-client');
  const forkCalls = [];
  const fakeChild = {
    connected: true,
    on() {},
    once() {},
    send(message) {
      this.lastMessage = message;
      return true;
    },
    disconnect() {
      this.connected = false;
    }
  };

  const client = createTuiSyncClient({
    fork(modulePath, args, options) {
      forkCalls.push({modulePath, args, options});
      return fakeChild;
    }
  });

  assert.equal(forkCalls.length, 1);
  assert.equal(path.basename(forkCalls[0].modulePath), 'tui-sync-runner.ts');
  assert.deepEqual(forkCalls[0].options.stdio, ['ignore', 'ignore', 'ignore', 'ipc']);
  assert.equal(forkCalls[0].options.env, process.env);
  client.dispose();
});
