const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const hooksModulePath = path.join(repoRoot, 'sync', 'ilu-hooks.js');
const syncIndexModulePath = path.join(repoRoot, 'sync', 'index.js');
const logModulePath = path.join(repoRoot, 'utils', 'log.js');

function loadHooks(events) {
  const originalLoad = Module._load;

  delete require.cache[require.resolve(hooksModulePath)];
  delete require.cache[require.resolve(syncIndexModulePath)];
  delete require.cache[require.resolve(logModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './index' && parent && parent.filename === hooksModulePath) {
      return {
        getSyncConfig() {
          return {enabled: true, autoSync: true};
        },
        notifyLocalMutation: async (context) => {
          events.push(['sync', context]);
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
