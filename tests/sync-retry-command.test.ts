const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const commandsModulePath = path.join(repoRoot, 'sync', 'commands.ts');

test('sync retry delegates to runtime retry and returns status', async () => {
  const originalLoad = Module._load;
  const calls = [];
  const runtimeCreationArgs = [];

  delete require.cache[require.resolve(commandsModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './index') {
      return {
        createSyncRuntime(...args) {
          runtimeCreationArgs.push(args);
          return {
            async retry(context) {
              calls.push(context);
            },
            getSyncStatus() {
              return {status: 'healthy'};
            }
          };
        },
        getSyncConfig() {
          return {enabled: false, remoteUrl: '/tmp/remote.git', branch: 'main', autoSync: true, autoPull: true, autoPush: true};
        }
      };
    }

    if (request === './ilu-adapter' || request === './state-store' || request === './git-cli-backend') {
      throw new Error(`commands.js should not import ${request} directly`);
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const commands = require(commandsModulePath);
    const result = await commands.retry();

    assert.deepEqual(calls, [{reason: 'manual'}]);
    assert.deepEqual(runtimeCreationArgs, [[]]);
    assert.deepEqual(result, {status: 'healthy'});
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(commandsModulePath)];
  }
});

test('sync enable re-enables runtime state instead of leaving it disabled', async () => {
  const originalLoad = Module._load;
  const repoRoot = path.resolve(__dirname, '..');
  const commandsModulePath = path.join(repoRoot, 'sync', 'commands.ts');
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
        },
        getSyncConfig() {
          return {enabled: false, remoteUrl: '/tmp/remote.git', branch: 'main', autoSync: true, autoPull: true, autoPush: true};
        }
      };
    }

    if (request === './ilu-adapter' || request === './state-store' || request === './git-cli-backend') {
      throw new Error(`commands.js should not import ${request} directly`);
    }

    if (request === '../utils/local-paths') {
      return {syncDirPath() { return '/tmp/.ilu/.config'; }, syncConfigFilePath() { return '/tmp/.ilu/.config/sync-config.json'; }};
    }

    if (request === 'node:fs') {
      return {
        existsSync() { return false; },
        mkdirSync() {},
        readFileSync() { return '{}'; },
        writeFileSync(file, value) { savedConfigs.push(JSON.parse(value)); }
      };
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

test('sync enable reescribe solo sync-config sin depender de config de tts', async () => {
  const originalLoad = Module._load;

  delete require.cache[require.resolve(commandsModulePath)];

  const savedConfigs = [];

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
        },
        getSyncConfig() {
          return {enabled: false, remoteUrl: '/tmp/remote.git', branch: 'main', autoSync: true, autoPull: true, autoPush: true};
        }
      };
    }

    if (request === './ilu-adapter' || request === './state-store' || request === './git-cli-backend') {
      throw new Error(`commands.js should not import ${request} directly`);
    }

    if (request === '../utils/config-store') {
      return {
        saveSyncConfig(config) {
          savedConfigs.push(config);
          return config;
        }
      };
    }

    if (request === '../utils/local-paths') {
      return {syncDirPath() { return '/tmp/.ilu/.config'; }, syncConfigFilePath() { return '/tmp/.ilu/.config/sync-config.json'; }};
    }

    if (request === 'node:fs') {
      return {mkdirSync() {}, writeFileSync() {}};
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const commands = require(commandsModulePath);
    await commands.enable();
    assert.deepEqual(savedConfigs.at(-1), {enabled: true, remoteUrl: '/tmp/remote.git', branch: 'main', autoSync: true, autoPull: true, autoPush: true});
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(commandsModulePath)];
  }
});
