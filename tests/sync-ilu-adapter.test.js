const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const adapterModulePath = path.join(repoRoot, 'sync', 'ilu-adapter.js');

function loadAdapterWithHome(tempHome) {
  const originalHome = process.env.HOME;
  delete require.cache[require.resolve(adapterModulePath)];
  process.env.HOME = tempHome;

  const adapter = require(adapterModulePath);

  return {
    adapter,
    restore() {
      process.env.HOME = originalHome;
      delete require.cache[require.resolve(adapterModulePath)];
    }
  };
}

test('ilu adapter resolves source root and tracked entries under ~/.ilu', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-adapter-'));
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
    fs.rmSync(tempHome, {recursive: true, force: true});
  }
});

test('ilu adapter exposes normalized sync config and commit message builder', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-adapter-config-'));
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
    fs.rmSync(tempHome, {recursive: true, force: true});
  }
});
