import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..');
const commandsModulePath = path.join(repoRoot, 'sync', 'commands.ts');

function loadCommands(status) {
  const originalLoad = Module._load;
  const calls = [];
  const syncIndex = {
    createSyncRuntime(...args) {
      calls.push(args);
      return {
        getSyncStatus() {
          return status;
        },
        retry: async () => status
      };
    },
    getSyncConfig() {
      return {enabled: true, remoteUrl: '/tmp/remote.git', branch: 'main', autoSync: true, autoPull: true, autoPush: true};
    }
  };

  delete require.cache[require.resolve(commandsModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './index') {
      return syncIndex;
    }

    if (request === './ilu-adapter' || request === './state-store' || request === './git-cli-backend') {
      throw new Error(`commands.js should not import ${request} directly`);
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const commands = require(commandsModulePath);
    commands.configureCommandDependencies({sync: syncIndex});
    return {commands, calls};
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(commandsModulePath)];
  }
}

test('sync status returns current runtime status for healthy and degraded cases', async () => {
  let {commands, calls} = loadCommands({status: 'healthy', hasPendingRemote: false});
  assert.deepEqual(await commands.status(), {status: 'healthy', hasPendingRemote: false});
  assert.deepEqual(calls, [[]]);

  ({commands, calls} = loadCommands({status: 'degraded_network', hasPendingRemote: true, lastErrorKind: 'network'}));
  assert.deepEqual(await commands.status(), {status: 'degraded_network', hasPendingRemote: true, lastErrorKind: 'network'});
  assert.deepEqual(calls, [[]]);
});

test('sync status prints user-facing status output', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const {commands, calls} = loadCommands({status: 'healthy', hasPendingRemote: false});
    await commands.status();
    assert.equal(logs.some(line => /healthy/i.test(line)), true);
    assert.deepEqual(calls, [[]]);
  } finally {
    console.log = originalLog;
  }
});
