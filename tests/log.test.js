const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const logModulePath = path.join(repoRoot, 'utils', 'log.js');

test('utils/log.js no intenta cargar node-symbols', () => {
  const originalLoad = Module._load;
  const requestedModules = [];

  delete require.cache[require.resolve(logModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    requestedModules.push(request);
    return originalLoad.apply(this, arguments);
  };

  try {
    require(logModulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(logModulePath)];
  }

  assert.equal(
    requestedModules.includes('node-symbols'),
    false,
    'utils/log.js no debe depender de node-symbols'
  );
});
