import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as __cjsImport49 from '../../support/home-sandbox';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { setTestHome, withTempHome } = __cjsImport49;
const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const defaultsModulePath = path.join(repoRoot, 'sync-core', 'defaults.ts');
const fileStoreModulePath = path.join(repoRoot, 'sync-core', 'state', 'file-store.ts');
const stateStoreModulePath = path.join(repoRoot, 'sync', 'state-store.ts');

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

test('sync core file state store persists roundtrip without ilu local paths', () => {
  return withTempHome(tempHome => {
    delete require.cache[require.resolve(fileStoreModulePath)];
    const {createFileStateStore} = require(fileStoreModulePath);
    const arbitraryStateFile = path.join(tempHome, 'consumer', 'state.json');
    const stateStore = createFileStateStore({
      defaultState() {
        return {
          enabled: false,
          status: 'disabled',
          retryCount: 0
        };
      },
      getStateFilePath() {
        return arbitraryStateFile;
      }
    });

    const initial = stateStore.loadState();
    const saved = stateStore.saveState({
      enabled: true,
      status: 'healthy'
    });
    const roundtrip = stateStore.loadState();

    assert.deepEqual(initial, {
      enabled: false,
      status: 'disabled',
      retryCount: 0
    });
    assert.equal(saved.retryCount, 0);
    assert.equal(roundtrip.enabled, true);
    assert.equal(roundtrip.status, 'healthy');
    assert.equal(fs.existsSync(arbitraryStateFile), true);

    delete require.cache[require.resolve(fileStoreModulePath)];
  }, {prefix: 'ilu-sync-core-state-'});
});

test('sync core default state store bootstraps default sync state under sourceRoot metadata', () => {
  return withTempHome(tempHome => {
    const sourceRoot = path.join(tempHome, 'workspace');
    fs.mkdirSync(sourceRoot, {recursive: true});

    delete require.cache[require.resolve(defaultsModulePath)];
    const {createDefaultStateStore, defaultSyncState} = require(defaultsModulePath);
    const stateStore = createDefaultStateStore({sourceRoot});

    const initial = stateStore.loadState();
    const stateFilePath = stateStore.getStateFilePath();

    assert.deepEqual(initial, defaultSyncState());
    assert.equal(stateFilePath, path.join(sourceRoot, '.config', 'sync-state.json'));
    assert.equal(fs.existsSync(stateFilePath), true);

    delete require.cache[require.resolve(defaultsModulePath)];
  }, {prefix: 'ilu-sync-core-default-state-'});
});
