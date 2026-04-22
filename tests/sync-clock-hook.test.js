const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const modelModulePath = path.join(repoRoot, 'clocks', 'model.js');

function loadClocksModel(events) {
  const originalLoad = Module._load;
  let content = [];

  delete require.cache[require.resolve(modelModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
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
    if (request === '../sync/ilu-hooks') {
      return async (context) => {
        events.push(context);
      };
    }
    if (request === '../utils/local-paths') {
      return {
        dbFilePath() { return '/tmp/clocks.json'; }
      };
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    return require(modelModulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(modelModulePath)];
  }
}

test('clock model notifies sync after writes', async () => {
  const events = [];
  const Model = loadClocksModel(events);

  Model.add({name: 'UTC', timezone: 'UTC'});
  Model.remove(1);
  Model.remove([]);

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length >= 3, true);
  assert.equal(events.every(event => event.domain === 'clocks'), true);
});
