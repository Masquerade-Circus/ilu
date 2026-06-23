const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const {withTempHome} = require('../support/home-sandbox');

const repoRoot = path.resolve(__dirname, '..');
const commandsModulePath = path.join(repoRoot, 'sync', 'commands.ts');

function loadCommandsWithStubs(overrides: any = {}) {
  const originalLoad = Module._load;
  const calls = [];
  const defaultLocalPaths = {
    syncDirPath() {
      return '/tmp/ilu-test-sync';
    },
    syncConfigFilePath() {
      return '/tmp/ilu-test-sync/sync-config.json';
    }
  };
  const defaultFs = {
    mkdirSync() {},
    writeFileSync() {},
    existsSync() {
      return false;
    },
    readFileSync() {
      throw new Error('readFileSync should not be called in sync init test');
    }
  };
  const defaultConfigStore = {
    saveSyncConfig(config) {
      return {
        enabled: config.enabled === true,
        remoteUrl: typeof config.remoteUrl === 'string' && config.remoteUrl.trim() ? config.remoteUrl.trim() : null,
        branch: typeof config.branch === 'string' && config.branch.trim() ? config.branch.trim() : 'main',
        autoSync: config.autoSync !== false,
        autoPull: config.autoPull !== false,
        autoPush: config.autoPush !== false
      };
    }
  };

  delete require.cache[require.resolve(commandsModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'node:fs') {
      return overrides.fs || defaultFs;
    }

    if (request === '../utils/local-paths') {
      return overrides.localPaths || defaultLocalPaths;
    }

    if (request === '../utils/config-store') {
      return overrides.configStore || defaultConfigStore;
    }

    if (request === './index') {
      return overrides.syncIndex || {
        createSyncRuntime() {
          return {
            getSyncStatus() {
              return {status: 'healthy'};
            },
            retry: async () => {},
            notifyLocalMutation: async () => {}
          };
        },
        createSyncRuntimeAdvanced(options) {
          calls.push({kind: 'createSyncRuntimeAdvanced', options});
          return {
            getSyncStatus() {
              return {status: 'healthy'};
            },
            retry: async () => {},
            notifyLocalMutation: async () => {}
          };
        },
        createBootstrapBackend({branch, remoteUrl}) {
          return {
            inspectBootstrap(args) {
              calls.push({kind: 'inspectBootstrap', args, branch, remoteUrl});
              return {localHasData: false, remoteHasHistory: false};
            }
          };
        },
        getBootstrapContext() {
          return {
            sourceRoot: '/tmp/source',
            ignorePatterns: ['.config/**']
          };
        },
        initializeSyncState(state) {
          calls.push({kind: 'initializeSyncState', state});
          return state;
        },
        getSyncConfig() {
          return {
            enabled: false,
            remoteUrl: null,
            branch: 'main',
            autoSync: true,
            autoPull: true,
            autoPush: true
          };
        }
      };
    }

    if (request === './ilu-adapter') {
      throw new Error('commands.js should not import ilu-adapter directly');
    }

    if (request === './state-store') {
      throw new Error('commands.js should not import state-store directly');
    }

    if (request === './git-cli-backend') {
      throw new Error('commands.js should not import git-cli-backend directly');
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    return {commands: require(commandsModulePath), calls};
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(commandsModulePath)];
  }
}

test('sync init valida remote y usa branch main por default', async () => {
  const {commands} = loadCommandsWithStubs();

  await assert.rejects(() => commands.init([], {}), /remote/i);

  const result = await commands.init([], {remote: '/tmp/remote.git'});
  assert.equal(result.branch, 'main');
  assert.equal(result.remoteUrl, '/tmp/remote.git');
});

test('sync init en este test no escribe config real en disco', async () => {
  await withTempHome(async tempHome => {
    const tempConfigPath = path.join(tempHome, '.ilu', '.config', 'sync-config.json');
    const {commands} = loadCommandsWithStubs();
    await commands.init([], {remote: '/tmp/remote.git'});
    assert.equal(fs.existsSync(tempConfigPath), false);
  }, {prefix: 'ilu-sync-init-test-'});
});

test('sync init aborta si local y remoto ya tienen historia', async () => {
  const {commands} = loadCommandsWithStubs({
    syncIndex: {
      createSyncRuntime() {
        return {
          getSyncStatus() {
            return {status: 'healthy'};
          },
          retry: async () => {},
          notifyLocalMutation: async () => {}
        };
      },
      createBootstrapBackend() {
        return {
          inspectBootstrap() {
            return {localHasData: true, remoteHasHistory: true};
          }
        };
      },
      getBootstrapContext() {
        return {
          sourceRoot: '/tmp/source',
          ignorePatterns: ['.config/**']
        };
      },
      initializeSyncState(state) {
        return state;
      },
      getSyncConfig() {
        return {
          enabled: false,
          remoteUrl: null,
          branch: 'main',
          autoSync: true,
          autoPull: true,
          autoPush: true
        };
      }
    }
  });

  await assert.rejects(() => commands.init([], {remote: '/tmp/remote.git'}), /avoid overwriting data/i);
});

test('sync init inspecciona bootstrap usando source root e ignore patterns del consumer', async () => {
  let inspectArgs = null;

  const {commands} = loadCommandsWithStubs({
    syncIndex: {
      createSyncRuntime() {
        return {
          getSyncStatus() {
            return {status: 'healthy'};
          },
          retry: async () => {},
          notifyLocalMutation: async () => {}
        };
      },
      createBootstrapBackend() {
        return {
          inspectBootstrap(args) {
            inspectArgs = args;
            return {localHasData: false, remoteHasHistory: false};
          }
        };
      },
      getBootstrapContext() {
        return {
          sourceRoot: '/tmp/consumer-source',
          ignorePatterns: ['.config/**', '.cache/**']
        };
      },
      initializeSyncState(state) {
        return state;
      },
      getSyncConfig() {
        return {
          enabled: false,
          remoteUrl: null,
          branch: 'main',
          autoSync: true,
          autoPull: true,
          autoPush: true
        };
      }
    }
  });

  await commands.init([], {remote: '/tmp/remote.git'});

  assert.deepEqual(inspectArgs, {
    sourceRoot: '/tmp/consumer-source',
    ignorePatterns: ['.config/**', '.cache/**']
  });
});

test('sync init usa runtime avanzado explícito para publicar datos locales iniciales', async () => {
  const calls = [];

  const {commands} = loadCommandsWithStubs({
    syncIndex: {
      createSyncRuntime() {
        throw new Error('init should not use the default runtime path for bootstrap publishing');
      },
      createSyncRuntimeAdvanced(options) {
        calls.push({kind: 'createSyncRuntimeAdvanced', options});
        return {
          async retry(context) {
            calls.push({kind: 'retry', context});
          },
          getSyncStatus() {
            return {status: 'healthy'};
          }
        };
      },
      createBootstrapBackend() {
        return {
          inspectBootstrap() {
            return {localHasData: true, remoteHasHistory: false};
          }
        };
      },
      getBootstrapContext() {
        return {
          sourceRoot: '/tmp/consumer-source',
          ignorePatterns: ['.config/**']
        };
      },
      initializeSyncState(state) {
        return state;
      },
      getSyncConfig() {
        return {
          enabled: false,
          remoteUrl: null,
          branch: 'main',
          autoSync: true,
          autoPull: true,
          autoPush: true
        };
      }
    }
  });

  await commands.init([], {remote: '/tmp/remote.git'});

   assert.equal(calls[0]?.kind, 'createSyncRuntimeAdvanced');
   assert.equal(calls[0].options.backend.inspectBootstrap().localHasData, true);
   assert.equal(calls[0].options.config.remoteUrl, '/tmp/remote.git');
   assert.deepEqual(calls[1], {kind: 'retry', context: {reason: 'init'}});
});
