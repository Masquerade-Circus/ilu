const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {setTestHome, withTempHome} = require('../support/home-sandbox');

const repoRoot = path.resolve(__dirname, '..');
const adapterModulePath = path.join(repoRoot, 'sync', 'ilu-adapter.js');

function loadAdapterWithHome(tempHome) {
  const restoreHome = setTestHome(tempHome);
  delete require.cache[require.resolve(adapterModulePath)];

  const adapter = require(adapterModulePath);

  return {
    adapter,
    restore() {
      restoreHome();
      delete require.cache[require.resolve(adapterModulePath)];
    }
  };
}

test('ilu adapter resolves source root and tracked entries under ~/.ilu', () => {
  return withTempHome(tempHome => {
    const {adapter, restore} = loadAdapterWithHome(tempHome);
    try {
      assert.equal(adapter.getSourceRoot(), path.join(tempHome, '.ilu'));
      assert.deepEqual(adapter.listTrackedEntries(), [
        'todos.json',
        'notes.json',
        'boards.json',
        'clocks.json'
      ]);
    } finally {
      restore();
    }
  }, {prefix: 'ilu-sync-adapter-'});
});

test('ilu adapter exposes normalized sync config and commit message builder', () => {
  return withTempHome(tempHome => {
    const {adapter, restore} = loadAdapterWithHome(tempHome);
    try {
      assert.deepEqual(adapter.getSyncConfig(), {
        enabled: false,
        remoteUrl: null,
        branch: 'main',
        autoSync: true,
        autoPull: true,
        autoPush: true
      });
      assert.match(adapter.buildCommitMessage({domain: 'todos', action: 'save'}), /todos/i);
    } finally {
      restore();
    }
  }, {prefix: 'ilu-sync-adapter-config-'});
});

test('ilu adapter ignora compatibilidad legacy y solo lee sync-config.json en .config', () => {
  return withTempHome(tempHome => {
    const legacyConfigFile = path.join(tempHome, '.ilu', '.sync', 'config.json');
    const currentConfigFile = path.join(tempHome, '.ilu', '.config', 'sync-config.json');
    fs.mkdirSync(path.dirname(legacyConfigFile), {recursive: true});
    fs.mkdirSync(path.dirname(currentConfigFile), {recursive: true});
    fs.writeFileSync(legacyConfigFile, JSON.stringify({
      enabled: true,
      remoteUrl: '/tmp/legacy.git',
      branch: 'legacy',
    autoSync: false,
    autoPull: false,
    autoPush: false
    }, null, 2), 'utf8');
    fs.writeFileSync(currentConfigFile, JSON.stringify({
      enabled: true,
      remoteUrl: '/tmp/remote.git',
      branch: 'main',
    autoSync: true,
    autoPull: false,
    autoPush: true
    }, null, 2), 'utf8');

    const {adapter, restore} = loadAdapterWithHome(tempHome);
    try {
      assert.deepEqual(adapter.getSyncConfig(), {
        enabled: true,
        remoteUrl: '/tmp/remote.git',
        branch: 'main',
        autoSync: true,
        autoPull: false,
        autoPush: true
      });
    } finally {
      restore();
    }
  }, {prefix: 'ilu-sync-adapter-legacy-'});
});
