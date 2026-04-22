const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const commandsModulePath = path.join(repoRoot, 'sync', 'commands.js');

function loadCommandsWithStubs(overrides = {}) {
  const originalLoad = Module._load;
  const calls = [];

  delete require.cache[require.resolve(commandsModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
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
        }
      };
    }

    if (request === './ilu-adapter') {
      return overrides.adapter || {
        getSourceRoot() {
          return '/tmp/source';
        },
        listTrackedEntries() {
          return ['todos.json'];
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

    if (request === './state-store') {
      return overrides.stateStore || {
        defaultState() {
          return {enabled: false, status: 'disabled'};
        },
        loadState() {
          return {status: 'disabled'};
        },
        saveState(state) {
          calls.push(state);
          return state;
        }
      };
    }

    if (request === './git-cli-backend') {
      return overrides.gitBackend || {
        createGitCliBackend() {
          return {
            ensureReady() {},
            getStatus() { return ''; }
          };
        }
      };
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

test('sync init aborta si local y remoto ya tienen historia', async () => {
  const {commands} = loadCommandsWithStubs({
    gitBackend: {
      createGitCliBackend() {
        return {
          inspectBootstrap() {
            return {localHasData: true, remoteHasHistory: true};
          }
        };
      }
    }
  });

  await assert.rejects(() => commands.init([], {remote: '/tmp/remote.git'}), /avoid overwriting data/i);
});
