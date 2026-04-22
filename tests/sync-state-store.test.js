const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const stateStoreModulePath = path.join(repoRoot, 'sync', 'state-store.js');

function loadStateStoreWithHome(tempHome) {
  const originalHome = process.env.HOME;
  delete require.cache[require.resolve(stateStoreModulePath)];
  process.env.HOME = tempHome;

  const stateStore = require(stateStoreModulePath);

  return {
    stateStore,
    restore() {
      process.env.HOME = originalHome;
      delete require.cache[require.resolve(stateStoreModulePath)];
    }
  };
}

test('sync state store bootstraps defaults and persists roundtrip under HOME temporal', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-state-'));
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
    fs.rmSync(tempHome, {recursive: true, force: true});
  }
});

test('sync state store ensures metadata directory exists before writing', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-state-dir-'));
  const {stateStore, restore} = loadStateStoreWithHome(tempHome);

  try {
    stateStore.saveState(stateStore.defaultState());
    assert.equal(fs.existsSync(stateStore.getStateFilePath()), true);
  } finally {
    restore();
    fs.rmSync(tempHome, {recursive: true, force: true});
  }
});
