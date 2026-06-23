const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const modelModulePath = path.join(repoRoot, 'clocks', 'model.ts');
const hooksModulePath = path.join(repoRoot, 'sync', 'ilu-hooks.ts');
const syncIndexModulePath = path.join(repoRoot, 'sync', 'index.ts');

function loadClocksModel(events) {
  const originalLoad = Module._load;
  let content = [];
  const state = {syncIndexLoadCount: 0};

  delete require.cache[require.resolve(modelModulePath)];
  delete require.cache[require.resolve(hooksModulePath)];
  delete require.cache[require.resolve(syncIndexModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (/sync-core/.test(request)) {
      throw new Error(`Unexpected sync-core import: ${request}`);
    }
    if (request === 'node:fs') {
      return {
        mkdirSync() {},
        existsSync() { return true; },
        readFileSync() { return JSON.stringify(content); },
        writeFileSync(_file, value) {
          content = JSON.parse(value);
        }
      };
    }
    if (request === './index' && parent && parent.filename === hooksModulePath) {
      state.syncIndexLoadCount += 1;
      return {
        notifyLocalMutation: async (context) => {
          events.push(context);
        }
      };
    }
    if (request === '../utils/local-paths') {
      return {
        dbFilePath() { return '/tmp/clocks.json'; }
      };
    }
    return originalLoad.apply(this, arguments);
  };

  return {
    Model: require(modelModulePath),
    state,
    restore() {
      Module._load = originalLoad;
      delete require.cache[require.resolve(modelModulePath)];
      delete require.cache[require.resolve(hooksModulePath)];
      delete require.cache[require.resolve(syncIndexModulePath)];
    }
  };
}

test('clock model routes persistence notifications through consumer hooks lazily', async () => {
  const events = [];
  const {Model, state, restore} = loadClocksModel(events);

  try {
    assert.equal(state.syncIndexLoadCount, 0);

    Model.add({name: 'UTC', timezone: 'UTC'});
    Model.remove(1);
    Model.remove([]);

    await new Promise(resolve => setImmediate(resolve));

    assert.equal(state.syncIndexLoadCount, 3);
    assert.deepEqual(events, [
      {domain: 'clocks', action: 'save'},
      {domain: 'clocks', action: 'save'},
      {domain: 'clocks', action: 'save'}
    ]);
  } finally {
    restore();
  }
});
