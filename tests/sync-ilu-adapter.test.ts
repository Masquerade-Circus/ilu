import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as __cjsImport56 from '../support/home-sandbox';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { setTestHome, withTempHome } = __cjsImport56;
const repoRoot = path.resolve(import.meta.dirname, '..');
const adapterModulePath = path.join(repoRoot, 'sync', 'ilu-adapter.ts');

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

test('ilu adapter resolves source root and ignore patterns under ~/.ilu', () => {
  return withTempHome(tempHome => {
    const {adapter, restore} = loadAdapterWithHome(tempHome);
    try {
      assert.equal(adapter.getSourceRoot(), path.join(tempHome, '.ilu'));
      assert.deepEqual(adapter.getIgnorePatterns(), ['.config/**']);
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

test('ilu adapter expone solo el contrato vigente del consumer', () => {
  return withTempHome(tempHome => {
    const {adapter, restore} = loadAdapterWithHome(tempHome);
    try {
      assert.equal(typeof adapter.getSourceRoot, 'function');
      assert.equal(typeof adapter.getIgnorePatterns, 'function');
      assert.equal(typeof adapter.getSyncConfig, 'function');
      assert.equal(typeof adapter.buildCommitMessage, 'function');
      assert.equal('backend' in adapter, false);
      assert.equal('stateStore' in adapter, false);
      assert.equal('logger' in adapter, false);
      assert.equal('now' in adapter, false);
      assert.equal('listTrackedEntries' in adapter, false);
      assert.equal('getStateStore' in adapter, false);
    } finally {
      restore();
    }
  }, {prefix: 'ilu-sync-adapter-surface-'});
});

test('ilu adapter ignora compatibilidad anterior y solo lee sync-config.json en .config', () => {
  return withTempHome(tempHome => {
    const oldConfigFile = path.join(tempHome, '.ilu', '.sync', 'config.json');
    const currentConfigFile = path.join(tempHome, '.ilu', '.config', 'sync-config.json');
    fs.mkdirSync(path.dirname(oldConfigFile), {recursive: true});
    fs.mkdirSync(path.dirname(currentConfigFile), {recursive: true});
    fs.writeFileSync(oldConfigFile, JSON.stringify({
      enabled: true,
      remoteUrl: '/tmp/old.git',
      branch: 'old',
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
  }, {prefix: 'ilu-sync-adapter-old-'});
});
