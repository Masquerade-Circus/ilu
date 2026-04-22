const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const commandsModulePath = path.join(repoRoot, 'sync', 'commands.js');

test('sync retry delegates to runtime retry and returns status', async () => {
  const originalLoad = Module._load;
  const calls = [];

  delete require.cache[require.resolve(commandsModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './index') {
      return {
        createSyncRuntime() {
          return {
            async retry(context) {
              calls.push(context);
            },
            getSyncStatus() {
              return {status: 'healthy'};
            }
          };
        }
      };
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const commands = require(commandsModulePath);
    const result = await commands.retry();

    assert.deepEqual(calls, [{reason: 'manual'}]);
    assert.deepEqual(result, {status: 'healthy'});
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(commandsModulePath)];
  }
});

test('sync enable re-enables runtime state instead of leaving it disabled', async () => {
  const originalLoad = Module._load;
  const repoRoot = path.resolve(__dirname, '..');
  const commandsModulePath = path.join(repoRoot, 'sync', 'commands.js');
  const savedConfigs = [];
  const savedStates = [];

  delete require.cache[require.resolve(commandsModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './index') {
      return {
        createSyncRuntime() {
          return {
            async enable() {},
            getSyncStatus() {
              return {status: 'healthy', enabled: true};
            }
          };
        }
      };
    }

    if (request === './ilu-adapter') {
      return {
        getSyncConfig() {
          return {enabled: false, remoteUrl: '/tmp/remote.git', branch: 'main', autoSync: true, autoPull: true, autoPush: true};
        }
      };
    }

    if (request === './state-store') {
      return {
        loadState() {
          return {enabled: false, status: 'disabled'};
        },
        saveState(state) {
          savedStates.push(state);
          return state;
        }
      };
    }

    if (request === '../utils/local-paths') {
      return {syncDirPath() { return '/tmp/.ilu/.sync'; }, syncConfigFilePath() { return '/tmp/.ilu/.sync/config.json'; }};
    }

    if (request === 'node:fs') {
      return {mkdirSync() {}, writeFileSync(file, value) { savedConfigs.push(JSON.parse(value)); }};
    }

    if (request === './git-cli-backend') {
      return {createGitCliBackend() { return {}; }};
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const commands = require(commandsModulePath);
    const result = await commands.enable();
    assert.deepEqual(result, {status: 'healthy', enabled: true});
    assert.equal(savedConfigs.at(-1).enabled, true);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(commandsModulePath)];
  }
});
