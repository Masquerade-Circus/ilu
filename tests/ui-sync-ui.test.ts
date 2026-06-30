import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..');
import 'tsx/cjs';
const uiModulePath = path.join(repoRoot, 'ui', 'app.tsx');

function stripAnsi(output) {
  return output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function visibleLines(output) {
  return stripAnsi(output).split(/\r?\n/);
}

function baseSnapshot(overrides: any = {}) {
  return {
    todo: {title: 'Today', items: [], remaining: 0},
    notes: {title: 'Notes list', items: [], remaining: 0},
    board: {title: 'Board view', columns: [], totalCards: 0},
    clocks: {items: [], remaining: 0},
    ...overrides
  };
}

function createSyncActions(calls) {
  return {
    status() {
      calls.push(['status']);
      return {ok: true, label: 'Pending sync', details: ['Status: Pending sync', 'Pending sync: yes']};
    },
    retry() {
      calls.push(['retry']);
      return {ok: true, label: 'Synced', details: ['Status: Synced']};
    },
    enable() {
      calls.push(['enable']);
      return {ok: true, label: 'Synced', details: ['Status: Synced']};
    },
    disable() {
      calls.push(['disable']);
      return {ok: true, label: 'Sync off', details: ['Status: Sync off']};
    },
    init(values) {
      calls.push(['init', values]);
      return {ok: true, label: 'Synced', details: ['Status: Synced']};
    }
  };
}

test('Sync app opens from top nav and shows detailed status', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(calls)});

  session.click('tab-sync');

  const output = session.output();
  const lines = visibleLines(output);
  const navLine = lines.find(line => /Todo/.test(line) && /Notes/.test(line) && /Board/.test(line) && /Clocks/.test(line));

  assert.deepEqual(calls, [['status']]);
  assert.equal(session.state().activeTab, 'Sync');
  assert.ok(navLine, 'expected global top nav');
  assert.match(navLine, /Sync/);
  assert.match(output, /Sync/);
  assert.match(output, /Status: Pending sync/);
  assert.match(output, /Retry sync/);
  assert.match(output, /Enable sync/);
  assert.match(output, /Disable sync/);
  assert.match(output, /Set up sync/);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});


test('Sync app renders action controls in the bottom action area', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(calls)});

  try {
    session.click('tab-sync');

    const lines = visibleLines(session.output());
    const actionRow = lines.findIndex(line => /Retry sync/.test(line) && /Enable sync/.test(line) && /Disable sync/.test(line));
    const setupRow = lines.findIndex(line => /Set up sync/.test(line));

    assert.equal(actionRow, 22, `Sync primary actions must render in the fixed action area:
${lines.join('\n')}`);
    assert.equal(setupRow, 22, `Sync setup action must share the fixed action area:
${lines.join('\n')}`);
    assert.equal(lines.slice(2, 22).some(line => /Retry sync|Enable sync|Disable sync|Set up sync/.test(line)), false, `Sync panel body must stay for status/content only:
${lines.join('\n')}`);
    assert.equal(lines.filter(line => line.length > 80).length, 0);
  } finally {
    session.destroy();
  }
});

test('Sync retry updates visible status through the utility command path', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(calls)});

  session.click('tab-sync');
  session.click('sync-retry');

  assert.deepEqual(calls, [['status'], ['retry']]);
  assert.match(session.output(), /Status: Synced/);
  assert.doesNotMatch(session.output(), /stack|\/home|token|secret/i);
  session.destroy();
});



test('Sync setup overlay pins setup actions to the overlay bottom', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(calls)});

  session.click('tab-sync');
  session.click('sync-setup');

  const lines = visibleLines(session.output());
  const actionRow = lines.findIndex(line => /Confirm setup/.test(line) && /Set up sync/.test(line) && /Cancel/.test(line));

  assert.notEqual(actionRow, -1, `expected Sync setup actions:\n${lines.join('\n')}`);
  assert.equal(actionRow, 20, `Sync setup actions must render on the last internal overlay row:\n${lines.join('\n')}`);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});

test('Ctrl+C exits when Help is above Sync setup overlay', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(calls)});

  try {
    session.click('tab-sync');
    session.click('sync-setup');
    assert.equal(session.state().utilities.activeOverlay, 'sync-init');

    session.dispatchKey('CTRL_K');
    assert.equal(session.state().overlay, 'help');
    assert.equal(session.state().utilities.activeOverlay, 'sync-init');

    session.dispatchKey('CTRL_C');

    assert.equal(session.state().running, false);
    assert.equal(session.state().overlay, 'help');
    assert.equal(session.state().utilities.activeOverlay, 'sync-init');
  } finally {
    session.destroy();
  }
});

test('Sync init form requires explicit confirmation and keeps test remote under repo tmp', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(calls)});

  session.click('tab-sync');
  session.click('sync-setup');

  assert.equal(session.state().utilities.activeOverlay, 'sync-init');
  assert.match(session.output(), /Remote URL/);
  assert.match(session.output(), /Branch/);
  assert.match(session.output(), /Start sync with this remote and branch\?/);
  assert.match(session.output(), /If this device and the remote already contain data,/);
  assert.match(session.output(), /setup may stop to protect your files\./);

  session.click('sync-init-start');

  assert.deepEqual(calls, [['status']]);
  assert.match(session.output(), /Remote URL is required\./);

  session.focus('sync-init-remote');
  session.dispatchText('./tmp/sync-ui-remote.git');
  session.click('sync-init-confirm');
  session.click('sync-init-start');

  assert.deepEqual(calls.at(-1), ['init', {remoteUrl: './tmp/sync-ui-remote.git', branch: 'main', confirmed: true}]);
  assert.equal(session.state().utilities.activeOverlay, null);
  assert.match(session.output(), /Status: Synced/);
  assert.doesNotMatch(session.output(), /api key|secret|provider|stack|\/home/i);
  session.destroy();
});

test('Sync init blocks embedded credentials before calling the action', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    snapshot: baseSnapshot(),
    state: {
      utilities: {
        sync: {
          initForm: {
            remoteUrl: 'https://user:token@example.test/repo.git',
            branch: 'main',
            confirmed: true
          }
        }
      }
    },
    syncActions: createSyncActions(calls)
  });

  session.click('tab-sync');
  session.click('sync-setup');
  session.focus('sync-init-remote');
  session.dispatchText('https://user:token@example.test/repo.git');
  session.click('sync-init-confirm');
  session.click('sync-init-start');

  assert.deepEqual(calls, [['status']]);
  assert.match(session.output(), /Remote URL must not include embedded credentials\./);
  assert.doesNotMatch(session.output(), /token/);
  session.destroy();
});

test('Sync init blocks SSH password before calling the action', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(calls)});

  session.click('tab-sync');
  session.click('sync-setup');
  session.focus('sync-init-remote');
  session.dispatchText('ssh://git:token@example.test/repo.git');
  session.click('sync-init-confirm');
  session.click('sync-init-start');

  assert.deepEqual(calls, [['status']]);
  assert.match(session.output(), /Remote URL must not include embedded credentials\./);
  assert.doesNotMatch(session.output(), /token/);
  session.destroy();
});

test('Sync init form allows SSH remotes with a normal user', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(calls)});

  session.click('tab-sync');
  session.click('sync-setup');
  session.focus('sync-init-remote');
  session.dispatchText('ssh://git@github.com/org/repo.git');
  session.click('sync-init-confirm');
  session.click('sync-init-start');

  assert.deepEqual(calls.at(-1), ['init', {remoteUrl: 'ssh://git@github.com/org/repo.git', branch: 'main', confirmed: true}]);
  assert.equal(session.state().utilities.activeOverlay, null);
  assert.match(session.output(), /Status: Synced/);
  session.destroy();
});

test('Esc keeps Sync app open when no secondary overlay is active', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(calls)});

  session.click('tab-sync');
  session.dispatchKey('ESCAPE');

  assert.equal(session.state().utilities.activeOverlay, null);
  assert.equal(session.state().running, true);
  assert.match(session.output(), /Retry sync/);
  session.destroy();
});


test('Sync enable and disable update status through visible utility controls', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(calls)});

  session.click('tab-sync');
  session.click('sync-enable');
  assert.deepEqual(calls, [['status'], ['enable']]);
  assert.match(session.output(), /Status: Synced/);

  session.click('sync-disable');
  assert.deepEqual(calls, [['status'], ['enable'], ['disable']]);
  assert.match(session.output(), /Status: Sync off/);
  session.destroy();
});

test('Sync utility prevents duplicate operation while a command is pending', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  let resolveRetry = null;
  const syncActions = {
    status() {
      calls.push(['status']);
      return {ok: true, label: 'Pending sync', details: ['Status: Pending sync']};
    },
    retry() {
      calls.push(['retry']);
      return new Promise(resolve => {
        resolveRetry = () => resolve({ok: true, label: 'Synced', details: ['Status: Synced']});
      });
    },
    enable() {
      calls.push(['enable']);
      return {ok: true, label: 'Synced', details: ['Status: Synced']};
    },
    disable() {
      calls.push(['disable']);
      return {ok: true, label: 'Sync off', details: ['Status: Sync off']};
    },
    init(values) {
      calls.push(['init', values]);
      return {ok: true, label: 'Synced', details: ['Status: Synced']};
    }
  };
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions});

  session.click('tab-sync');
  session.click('sync-retry');
  session.click('sync-retry');

  assert.deepEqual(calls, [['status'], ['retry']]);
  assert.equal(session.state().utilities.sync.operation, 'retry');
  assert.match(session.output(), /Pending sync/);

  resolveRetry();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(session.state().utilities.sync.operation, null);
  assert.match(session.output(), /Status: Synced/);
  session.destroy();
});

test('Sync retry can replace the initial status load when status is still pending', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  let resolveStatus = null;
  const syncActions = {
    status() {
      calls.push(['status']);
      return new Promise(resolve => {
        resolveStatus = () => resolve({ok: true, label: 'Pending sync', details: ['Status: Pending sync']});
      });
    },
    retry() {
      calls.push(['retry']);
      return {ok: true, label: 'Synced', details: ['Status: Synced']};
    },
    enable() {
      calls.push(['enable']);
      return {ok: true, label: 'Synced', details: ['Status: Synced']};
    },
    disable() {
      calls.push(['disable']);
      return {ok: true, label: 'Sync off', details: ['Status: Sync off']};
    },
    init(values) {
      calls.push(['init', values]);
      return {ok: true, label: 'Synced', details: ['Status: Synced']};
    }
  };
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions});

  session.click('tab-sync');
  assert.equal(session.state().utilities.sync.operation, 'status');

  session.click('sync-retry');

  assert.deepEqual(calls, [['status'], ['retry']]);
  assert.equal(session.state().utilities.sync.operation, null);
  assert.match(session.output(), /Status: Synced/);

  resolveStatus();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(session.state().utilities.sync.operation, null);
  assert.match(session.output(), /Status: Synced/);
  assert.doesNotMatch(session.output(), /Status: Pending sync/);
  session.destroy();
});
