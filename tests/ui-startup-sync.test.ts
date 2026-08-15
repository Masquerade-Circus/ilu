import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FakeStdin,
  FakeStdout,
  baseSnapshot,
  loadUiWithPatchedModules,
  repoRoot,
  uiModulePath
} from './test-helpers/ui-app.ts';
import { setTestHome } from '../support/home-sandbox.ts';

async function withStartupTestHome(run, prefix) {
  const root = path.join(repoRoot, '.tmp');
  fs.mkdirSync(root, {recursive: true});
  const home = fs.mkdtempSync(path.join(root, prefix));
  const restoreHome = setTestHome(home);

  try {
    return await run();
  } finally {
    restoreHome();
    fs.rmSync(home, {recursive: true, force: true});
  }
}

function syncHook(events: string[]) {
  const hook = function notifySync() {};
  hook.onSyncStatus = () => () => events.push('unsubscribe');
  hook.flushPending = () => false;
  hook.configureSyncRunner = () => {
    events.push('configure-runner');
    return () => events.push('restore-runner');
  };
  return hook;
}

function loadUiWithStartupSync(status, events, run, configOverrides = {}) {
  return loadUiWithPatchedModules((request, parent, loaded) => {
    if (!parent || parent.filename !== uiModulePath) {
      return loaded;
    }

    if (request === '../sync/ilu-hooks') {
      return syncHook(events);
    }

    if (request === '../sync') {
      return {
        getSyncConfig() {
          return {
            enabled: true,
            autoSync: true,
            autoPull: true,
            remoteUrl: './synthetic-remote.git',
            ...configOverrides
          };
        }
      };
    }

    if (request === '../sync/tui-sync-client') {
      return {
        createTuiSyncClient() {
          events.push('create-client');
          return {
            async sync() {
              events.push('startup-sync');
              return status;
            },
            async shutdown() {
              events.push('shutdown');
            },
            dispose() {
              events.push('dispose');
            }
          };
        }
      };
    }

    return loaded;
  }, run);
}

test('TUI bloquea la sesión y evita el snapshot inicial cuando startup sync detecta conflicto', async () => {
  const events: string[] = [];

  await withStartupTestHome(async () => {
    await loadUiWithStartupSync(
      {status: 'conflict', hasPendingRemote: true},
      events,
      async (Ui) => {
        await assert.rejects(
          Ui.mountInteractiveSession({
            stdin: new FakeStdin(),
            stdout: new FakeStdout(),
            buildSnapshot() {
              events.push('snapshot');
              return baseSnapshot();
            }
          }),
          error => error instanceof Error
        );
      }
    );
  }, 'ilu-ui-startup-conflict-');

  assert.deepEqual(events.slice(0, 2), ['create-client', 'startup-sync']);
  assert.equal(events.includes('snapshot'), false);
  assert.equal(events.includes('shutdown') || events.includes('dispose'), true);
});

test('TUI continúa local y muestra estado degradado cuando startup sync falla por red', async () => {
  const events: string[] = [];

  await withStartupTestHome(async () => {
    await loadUiWithStartupSync(
      {status: 'degraded_network', hasPendingRemote: true, lastErrorKind: 'network'},
      events,
      async (Ui) => {
        const session = await Ui.mountInteractiveSession({
          stdin: new FakeStdin(),
          stdout: new FakeStdout(),
          buildSnapshot() {
            events.push('snapshot');
            return baseSnapshot({
              todo: {title: 'Local', items: [{text: 'Available offline', done: false}], remaining: 0}
            });
          }
        });

        try {
          assert.match(session.output(), /Available offline/);
          assert.match(session.output(), /Sync failed/);
        } finally {
          await session.destroy();
        }
      }
    );
  }, 'ilu-ui-startup-offline-');

  assert.deepEqual(events.slice(0, 3), ['create-client', 'startup-sync', 'snapshot']);
  assert.equal(events.filter(event => event === 'startup-sync').length, 1);
});

test('TUI completa startup sync una vez antes de construir su snapshot inicial', async () => {
  const events: string[] = [];

  await withStartupTestHome(async () => {
    await loadUiWithStartupSync(
      {status: 'healthy', hasPendingRemote: false},
      events,
      async (Ui) => {
        const session = await Ui.mountInteractiveSession({
          stdin: new FakeStdin(),
          stdout: new FakeStdout(),
          buildSnapshot() {
            events.push('snapshot');
            return baseSnapshot();
          }
        });

        await session.destroy();
      }
    );
  }, 'ilu-ui-startup-healthy-');

  assert.deepEqual(events.slice(0, 3), ['create-client', 'startup-sync', 'snapshot']);
  assert.equal(events.filter(event => event === 'startup-sync').length, 1);
  assert.equal(events.includes('configure-runner'), true);
  assert.equal(events.includes('shutdown'), true);
});

test('TUI omite startup sync cuando la recepción remota está desactivada', async () => {
  const events: string[] = [];

  await withStartupTestHome(async () => {
    await loadUiWithStartupSync(
      {status: 'healthy', hasPendingRemote: false},
      events,
      async (Ui) => {
        const session = await Ui.mountInteractiveSession({
          stdin: new FakeStdin(),
          stdout: new FakeStdout(),
          buildSnapshot() {
            events.push('snapshot');
            return baseSnapshot();
          }
        });

        await session.destroy();
      },
      {autoPull: false}
    );
  }, 'ilu-ui-startup-no-pull-');

  assert.deepEqual(events, ['snapshot', 'unsubscribe']);
});
