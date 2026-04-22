const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {invoke} = require('x-robot');

const repoRoot = path.resolve(__dirname, '..');
const machineModulePath = path.join(repoRoot, 'sync', 'machine.js');

function createMachine(context = {}) {
  delete require.cache[require.resolve(machineModulePath)];
  const {createSyncMachine} = require(machineModulePath);
  return createSyncMachine(context);
}

test('sync machine starts in disabled by default', () => {
  const machine = createMachine();
  assert.equal(machine.current, 'disabled');
});

test('sync machine transitions healthy -> pending_remote -> syncing -> healthy', async () => {
  const machine = createMachine({enabled: true, status: 'healthy'});

  invoke(machine, 'LOCAL_PERSISTED', {domain: 'todos', action: 'save'});
  assert.equal(machine.current, 'pending_remote');

  await invoke(machine, 'SYNC_REQUESTED', {runSyncPipeline: async () => {}});
  assert.equal(machine.current, 'healthy');
});

test('sync machine transitions syncing failures to degraded states', async () => {
  const networkMachine = createMachine({enabled: true, status: 'pending_remote'});
  await invoke(networkMachine, 'SYNC_REQUESTED', {runSyncPipeline: async () => ({kind: 'network'})});
  assert.equal(networkMachine.current, 'degraded_network');

  const authMachine = createMachine({enabled: true, status: 'pending_remote'});
  await invoke(authMachine, 'SYNC_REQUESTED', {runSyncPipeline: async () => ({kind: 'auth'})});
  assert.equal(authMachine.current, 'degraded_auth');

  const conflictMachine = createMachine({enabled: true, status: 'pending_remote'});
  await invoke(conflictMachine, 'SYNC_REQUESTED', {runSyncPipeline: async () => ({kind: 'conflict'})});
  assert.equal(conflictMachine.current, 'conflict');
});

test('sync machine can disable and re-enable with configured context', () => {
  const machine = createMachine({enabled: true, status: 'healthy'});

  invoke(machine, 'DISABLE');
  assert.equal(machine.current, 'disabled');

  invoke(machine, 'ENABLE');
  assert.equal(machine.current, 'healthy');
});

test('sync machine rehydrates hasPendingRemote from persisted state', () => {
  const machine = createMachine({enabled: true, status: 'degraded_network', hasPendingRemote: true});
  assert.equal(machine.context.hasPendingRemote, true);
});
