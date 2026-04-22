const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {setTestHome, withTempHome} = require('../support/home-sandbox');

const repoRoot = path.resolve(__dirname, '..');
const stateStoreModulePath = path.join(repoRoot, 'sync', 'state-store.js');

function loadStateStoreWithHome(tempHome) {
  const restoreHome = setTestHome(tempHome);
  delete require.cache[require.resolve(stateStoreModulePath)];

  const stateStore = require(stateStoreModulePath);

  return {
    stateStore,
    restore() {
      restoreHome();
      delete require.cache[require.resolve(stateStoreModulePath)];
    }
  };
}

test('sync state store bootstraps defaults and persists roundtrip under HOME temporal', () => {
  return withTempHome(tempHome => {
    const {stateStore, restore} = loadStateStoreWithHome(tempHome);
    try {
      const initial = stateStore.loadState();

      assert.equal(initial.status, 'disabled');
      assert.equal(initial.enabled, false);
      assert.equal(initial.lastErrorKind, null);

      const saved = stateStore.saveState({
        ...initial,
        enabled: true,
        status: 'pending_remote',
        retryCount: 2,
        lastErrorKind: 'network'
      });

      const roundtrip = stateStore.loadState();

      assert.equal(saved.status, 'pending_remote');
      assert.equal(roundtrip.enabled, true);
      assert.equal(roundtrip.retryCount, 2);
      assert.equal(roundtrip.lastErrorKind, 'network');
    } finally {
      restore();
    }
  }, {prefix: 'ilu-sync-state-'});
});

test('sync state store ensures metadata directory exists before writing', () => {
  return withTempHome(tempHome => {
    const {stateStore, restore} = loadStateStoreWithHome(tempHome);
    try {
      stateStore.saveState(stateStore.defaultState());
      assert.equal(fs.existsSync(stateStore.getStateFilePath()), true);
    } finally {
      restore();
    }
  }, {prefix: 'ilu-sync-state-dir-'});
});

test('sync state store persists under sync-state.json', () => {
  return withTempHome(tempHome => {
    const {stateStore, restore} = loadStateStoreWithHome(tempHome);
    try {
      assert.equal(stateStore.getStateFilePath(), path.join(tempHome, '.ilu', '.config', 'sync-state.json'));
    } finally {
      restore();
    }
  }, {prefix: 'ilu-sync-state-file-'});
});
