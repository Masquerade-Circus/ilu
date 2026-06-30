import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import * as __cjsImport57 from '../support/home-sandbox';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { withTempHome } = __cjsImport57;
const repoRoot = path.resolve(import.meta.dirname, '..');
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
  const defaultSyncIndex = {
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
      return overrides.syncIndex || defaultSyncIndex;
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
    const commands = require(commandsModulePath);
    commands.configureCommandDependencies({
      fs: overrides.fs || defaultFs,
      localPaths: overrides.localPaths || defaultLocalPaths,
      configStore: overrides.configStore || defaultConfigStore,
      sync: overrides.syncIndex || defaultSyncIndex
    });
    return {commands, calls};
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

test('sync init rechaza branch vacío explícito sin cambiar el default omitido', async () => {
  const {commands, calls} = loadCommandsWithStubs();

  const result = await commands.init([], {remote: '/tmp/remote.git'});
  assert.equal(result.branch, 'main');

  await assert.rejects(
    () => commands.init([], {remote: '/tmp/remote.git', branch: '   '}),
    /branch is required/i
  );
  assert.equal(calls.filter(call => call.kind === 'inspectBootstrap').length, 1);
});

test('sync init rechaza nombres de branch inseguros antes de tocar bootstrap', async () => {
  const {commands, calls} = loadCommandsWithStubs();
  const branches = [
    '../main',
    'feature.lock',
    'feature..main',
    'feature@{main',
    'feature main',
    '-bad'
  ];

  for (const branch of branches) {
    await assert.rejects(
      () => commands.init([], {remote: '/tmp/remote.git', branch}),
      /Invalid sync branch/i,
      branch
    );
  }

  assert.deepEqual(calls, []);
});

test('sync init rechaza remotes con credenciales embebidas antes de tocar bootstrap', async () => {
  const {commands, calls} = loadCommandsWithStubs();
  const remotes = [
    'https://user:password@example.test/repo.git',
    'https://token@example.test/repo.git',
    'https://ghp_TOKEN@example.test/repo.git',
    'ssh://git:token@example.test/repo.git'
  ];

  for (const remote of remotes) {
    await assert.rejects(
      () => commands.init([], {remote}),
      /Remote URL must not include embedded credentials/i,
      remote
    );
  }

  assert.deepEqual(calls, []);
});

test('sync init rechaza remotes con formato ambiguo antes de tocar bootstrap', async () => {
  const {commands, calls} = loadCommandsWithStubs();
  const remotes = [
    'https://',
    'ftp://example.test/repo.git',
    'git@github.com',
    'git@github.com:',
    'github.com/org/repo.git',
    'repo with spaces.git',
    './tmp/repo.git\nnext'
  ];

  for (const remote of remotes) {
    await assert.rejects(
      () => commands.init([], {remote}),
      /Invalid sync remote URL/i,
      remote
    );
  }

  assert.deepEqual(calls, []);
});

test('sync init permite remotes SSH con usuario normal', async () => {
  const {commands, calls} = loadCommandsWithStubs();

  const result = await commands.init([], {remote: 'ssh://git@github.com/org/repo.git'});

  assert.equal(result.branch, 'main');
  assert.equal(result.remoteUrl, 'ssh://git@github.com/org/repo.git');
  assert.equal(calls.find(call => call.kind === 'inspectBootstrap').remoteUrl, 'ssh://git@github.com/org/repo.git');
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
