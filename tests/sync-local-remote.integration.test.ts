import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as __cjsImport58 from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { execFileSync } = __cjsImport58;
import * as __cjsImport59 from '../support/home-sandbox';
const { withTempHome } = __cjsImport59;
const repoRoot = path.resolve(import.meta.dirname, '..');
import createTempGitRemote from './test-helpers/create-temp-git-remote';
function clearRuntimeCaches() {
  [
    path.join(repoRoot, 'sync', 'commands.ts'),
    path.join(repoRoot, 'sync', 'index.ts'),
    path.join(repoRoot, 'sync', 'ilu-adapter.ts'),
    path.join(repoRoot, 'sync', 'ilu-hooks.ts'),
    path.join(repoRoot, 'sync', 'state-store.ts'),
    path.join(repoRoot, 'sync', 'git-cli-backend.ts'),
    path.join(repoRoot, 'utils', 'local-paths.ts'),
    path.join(repoRoot, 'utils', 'load-db.ts'),
    path.join(repoRoot, 'utils', 'persistence-sync.ts'),
    path.join(repoRoot, 'utils', 'create-list-model.ts'),
    path.join(repoRoot, 'todos', 'model.ts')
  ].forEach(modulePath => {
    try {
      delete (require.cache as any)[require.resolve(modulePath)];
    } catch (error) {
      // ignore cache misses
    }
  });
}

function loadFresh(modulePath) {
  clearRuntimeCaches();
  return require(modulePath);
}

function git(args, options: any = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ilu test',
      GIT_AUTHOR_EMAIL: 'test@ilu.local',
      GIT_COMMITTER_NAME: 'ilu test',
      GIT_COMMITTER_EMAIL: 'test@ilu.local'
    },
    ...options
  }).trim();
}

function runCli(args, options: any = {}) {
  return require('node:child_process').spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options
  });
}

async function waitForCondition(predicate, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for sync condition');
}

test('bootstrap local data to empty local bare remote', async () => {
  const remote = createTempGitRemote();

  await withTempHome(async tempHome => {
    const TodosModel = loadFresh(path.join(repoRoot, 'todos', 'model.ts'));
    const SyncCommands = loadFresh(path.join(repoRoot, 'sync', 'commands.ts'));
    const localPaths = loadFresh(path.join(repoRoot, 'utils', 'local-paths.ts'));

    TodosModel.add({title: 'Inbox', description: ''});
    await SyncCommands.init([], {remote: remote.remotePath});

    const heads = git(['ls-remote', '--heads', remote.remotePath]);
    assert.match(heads, /main/);
    assert.equal(fs.existsSync(localPaths.syncConfigFilePath()), true);
    assert.equal(fs.existsSync(path.join(tempHome, '.ilu', '.sync-core', 'state.json')), true);
    assert.equal(fs.existsSync(path.join(tempHome, '.ilu', '.git')), true);
    const tracked = git(['-C', path.join(tempHome, '.ilu'), 'ls-files'], {cwd: repoRoot});
    assert.equal(/\.config\//.test(tracked), false);
  }, {prefix: 'ilu-sync-home-'});

  remote.cleanup();
});

test('bootstrap empty local storage from remote with history', async () => {
  const remote = createTempGitRemote({
    seedFiles: {
      'todos.json': JSON.stringify([{title: 'Seed', description: '', tasks: [], labels: [], current: true, index: 1}], null, 2)
    }
  });

  await withTempHome(async () => {
    const SyncCommands = loadFresh(path.join(repoRoot, 'sync', 'commands.ts'));
    const localPaths = loadFresh(path.join(repoRoot, 'utils', 'local-paths.ts'));

    await SyncCommands.init([], {remote: remote.remotePath});

    const todosFile = localPaths.dbFilePath('todos');
    assert.equal(fs.existsSync(todosFile), true);
    assert.match(fs.readFileSync(todosFile, 'utf8'), /Seed/);
  }, {prefix: 'ilu-sync-home-'});

  remote.cleanup();
});

test('cli sync init no deja bootstrap parcial cuando HOME inicia vacío y el remoto ya tiene historia', () => {
  const remote = createTempGitRemote({
    seedFiles: {
      'todos.json': JSON.stringify([{title: 'Seed', description: '', tasks: [], labels: [], current: true, index: 1}], null, 2),
      'notes.json': JSON.stringify([{title: 'Seed note', notes: [], labels: [], current: true, index: 1}], null, 2),
      'boards.json': JSON.stringify([{title: 'Seed board', description: '', current: true, index: 1, defaultColumnId: 'backlog', columns: [{id: 'backlog', title: 'Backlog', wipLimit: null, cards: [], index: 1}]}], null, 2),
      'clocks.json': JSON.stringify([{name: 'CDMX', timezone: 'America/Mexico_City'}], null, 2)
    }
  });

  return withTempHome(async tempHome => {
    const result = runCli(['bin/cli.js', 'sync', 'init', '--remote', remote.remotePath, '--branch', 'main'], {
      env: {...process.env, HOME: tempHome}
    });
    const iluRoot = path.join(tempHome, '.ilu');
    const localPaths = loadFresh(path.join(repoRoot, 'utils', 'local-paths.ts'));

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(localPaths.dbFilePath('todos')), true);
    assert.equal(fs.existsSync(localPaths.dbFilePath('notes')), true);
    assert.equal(fs.existsSync(localPaths.dbFilePath('boards')), true);
    assert.equal(fs.existsSync(localPaths.dbFilePath('clocks')), true);
    assert.equal(fs.existsSync(localPaths.syncConfigFilePath()), true);
    assert.equal(fs.existsSync(path.join(iluRoot, '.sync-core', 'state.json')), true);
    assert.match(fs.readFileSync(localPaths.dbFilePath('todos'), 'utf8'), /Seed/);
    assert.match(fs.readFileSync(localPaths.dbFilePath('notes'), 'utf8'), /Seed note/);
    assert.match(fs.readFileSync(localPaths.dbFilePath('boards'), 'utf8'), /Seed board/);
    assert.match(fs.readFileSync(localPaths.dbFilePath('clocks'), 'utf8'), /Mexico_City/);
    assert.equal(fs.existsSync(path.join(iluRoot, '.git')), true);
  }, {prefix: 'ilu-sync-home-'}).finally(() => {
    remote.cleanup();
  });
});

test('auto-sync after mutation pushes to local bare remote', async () => {
  const remote = createTempGitRemote();

  await withTempHome(async () => {
    const TodosModel = loadFresh(path.join(repoRoot, 'todos', 'model.ts'));
    const SyncCommands = loadFresh(path.join(repoRoot, 'sync', 'commands.ts'));
    const syncIndex = loadFresh(path.join(repoRoot, 'sync', 'index.ts'));

    await SyncCommands.init([], {remote: remote.remotePath});
    TodosModel.add({title: 'Inbox', description: ''});

    await new Promise(resolve => setTimeout(resolve, 250));
    const heads = git(['ls-remote', '--heads', remote.remotePath]);
    assert.match(heads, /main/);
    const status = await syncIndex.getSyncStatus();
    assert.equal(status.status, 'healthy', JSON.stringify(status));
    assert.equal(status.hasPendingRemote, false);
  }, {prefix: 'ilu-sync-home-'});

  remote.cleanup();
});

test('sync consumer createSyncRuntime() sin argumentos sigue funcionando después de bootstrap', async () => {
  const remote = createTempGitRemote();

  await withTempHome(async () => {
    const SyncCommands = loadFresh(path.join(repoRoot, 'sync', 'commands.ts'));
    const syncIndex = loadFresh(path.join(repoRoot, 'sync', 'index.ts'));

    await SyncCommands.init([], {remote: remote.remotePath});

    const runtime = await syncIndex.createSyncRuntime();
    const status = runtime.getSyncStatus();

    assert.equal(typeof runtime.sync, 'function');
    assert.equal(status.status, 'healthy');
  }, {prefix: 'ilu-sync-home-'});

  remote.cleanup();
});

test('remote unavailable does not remove local data', async () => {
  const remote = createTempGitRemote();

  await withTempHome(async () => {
    const TodosModel = loadFresh(path.join(repoRoot, 'todos', 'model.ts'));
    const SyncCommands = loadFresh(path.join(repoRoot, 'sync', 'commands.ts'));
    const localPaths = loadFresh(path.join(repoRoot, 'utils', 'local-paths.ts'));
    const syncIndex = loadFresh(path.join(repoRoot, 'sync', 'index.ts'));

    await SyncCommands.init([], {remote: remote.remotePath});
    fs.rmSync(remote.remotePath, {recursive: true, force: true});

    TodosModel.add({title: 'Inbox', description: ''});
    await new Promise(resolve => setTimeout(resolve, 250));

    assert.equal(fs.existsSync(localPaths.dbFilePath('todos')), true);
    assert.match(fs.readFileSync(localPaths.dbFilePath('todos'), 'utf8'), /Inbox/);
  }, {prefix: 'ilu-sync-home-'});

  remote.cleanup();
});

test('sync enable and disable are idempotent with the real runtime', async () => {
  const remote = createTempGitRemote();

  await withTempHome(async () => {
    const SyncCommands = loadFresh(path.join(repoRoot, 'sync', 'commands.ts'));
    await SyncCommands.init([], {remote: remote.remotePath});

    assert.deepEqual(
      {status: (await SyncCommands.disable()).status, enabled: (await SyncCommands.status()).enabled},
      {status: 'disabled', enabled: false}
    );
    assert.equal((await SyncCommands.disable()).status, 'disabled');
    assert.equal((await SyncCommands.enable()).status, 'healthy');
    assert.equal((await SyncCommands.enable()).status, 'healthy');
  }, {prefix: 'ilu-sync-enable-disable-'});

  remote.cleanup();
});

test('legacy sync state migrates once into private core state without carrying enabled', async () => {
  await withTempHome(async tempHome => {
    const localPaths = loadFresh(path.join(repoRoot, 'utils', 'local-paths.ts'));
    const legacyPath = localPaths.syncStateFilePath();
    fs.mkdirSync(path.dirname(legacyPath), {recursive: true});
    fs.writeFileSync(legacyPath, JSON.stringify({
      enabled: false,
      status: 'degraded_network',
      hasPendingRemote: true,
      pendingOperationId: 'legacy-operation',
      retryCount: 9,
      backoffUntil: Date.now() + 5000,
      lastErrorKind: 'network',
      lastErrorMessage: 'Network unavailable'
    }));
    const migration = loadFresh(path.join(repoRoot, 'sync', 'state-store.ts'));
    const rootPath = path.join(tempHome, '.ilu');
    const statePath = path.join(rootPath, '.sync-core', 'state.json');

    assert.equal(migration.migrateLegacySyncState(rootPath), true);
    const migrated = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(migrated.pendingOperationId, 'legacy-operation');
    assert.equal(migrated.hasPendingRemote, true);
    assert.equal(migrated.retryCount, 0);
    assert.equal(migrated.lastErrorMessage, 'Network unavailable');
    assert.equal('enabled' in migrated, false);

    fs.writeFileSync(legacyPath, JSON.stringify({pendingOperationId: 'must-not-overwrite'}));
    assert.equal(migration.migrateLegacySyncState(rootPath), false);
    assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).pendingOperationId, 'legacy-operation');
  }, {prefix: 'ilu-sync-migration-'});
});

test('legacy network pending state remains retryable without a backoff timestamp', async () => {
  await withTempHome(async (home) => {
    const localPaths = loadFresh(path.join(repoRoot, 'utils', 'local-paths.ts'));
    const rootPath = path.join(home, 'data');
    fs.mkdirSync(rootPath, {recursive: true});
    fs.mkdirSync(path.dirname(localPaths.syncStateFilePath()), {recursive: true});
    fs.writeFileSync(localPaths.syncStateFilePath(), JSON.stringify({
      status: 'degraded_network',
      hasPendingRemote: true,
      pendingOperationId: 'legacy-network',
      lastErrorKind: 'network'
    }));
    const migration = loadFresh(path.join(repoRoot, 'sync', 'state-store.ts'));

    assert.equal(migration.migrateLegacySyncState(rootPath), true);
    const migrated = JSON.parse(fs.readFileSync(path.join(rootPath, '.sync-core', 'state.json'), 'utf8'));
    assert.equal(migrated.retryable, true);
    assert.equal(migrated.backoffUntil, null);
  }, {prefix: 'ilu-sync-migration-network-'});
});

test('legacy auth pending state remains terminal even when it has a backoff timestamp', async () => {
  await withTempHome(async (home) => {
    const localPaths = loadFresh(path.join(repoRoot, 'utils', 'local-paths.ts'));
    const rootPath = path.join(home, 'data');
    fs.mkdirSync(rootPath, {recursive: true});
    fs.mkdirSync(path.dirname(localPaths.syncStateFilePath()), {recursive: true});
    fs.writeFileSync(localPaths.syncStateFilePath(), JSON.stringify({
      status: 'degraded_auth',
      hasPendingRemote: true,
      pendingOperationId: 'legacy-auth',
      lastErrorKind: 'auth',
      backoffUntil: Date.now() + 5000
    }));
    const migration = loadFresh(path.join(repoRoot, 'sync', 'state-store.ts'));

    assert.equal(migration.migrateLegacySyncState(rootPath), true);
    const migrated = JSON.parse(fs.readFileSync(path.join(rootPath, '.sync-core', 'state.json'), 'utf8'));
    assert.equal(migrated.retryable, false);
  }, {prefix: 'ilu-sync-migration-auth-'});
});

test('autoSync false persists pending policy across module reload and retry clears it only after success', async () => {
  await withTempHome(async () => {
    const localPaths = loadFresh(path.join(repoRoot, 'utils', 'local-paths.ts'));
    const configStore = loadFresh(path.join(repoRoot, 'utils', 'config-store.ts'));
    configStore.saveSyncConfig({enabled: true, remoteUrl: '/tmp/controlled.git', branch: 'main', autoSync: false});
    let backendCalls = 0;
    let syncIndex = loadFresh(path.join(repoRoot, 'sync', 'index.ts'));

    const pending = await syncIndex.sync({domain: 'todos', action: 'save'});
    assert.equal(pending.status, 'pending_remote');
    assert.equal(fs.existsSync(localPaths.syncPendingFilePath()), true);

    syncIndex = loadFresh(path.join(repoRoot, 'sync', 'index.ts'));
    const status = await syncIndex.getSyncStatus();
    assert.equal(status.status, 'pending_remote');
    const runtime = await syncIndex.createSyncRuntime({
      backend: {
        async synchronize() { backendCalls += 1; },
        classifyError() { return {kind: 'unknown', retryable: false}; }
      },
      rootPath: localPaths.storageDirPath()
    });
    const result = await runtime.sync({reason: 'manual'});

    assert.equal(result.status, 'healthy');
    assert.equal(backendCalls, 1);
    assert.equal(fs.existsSync(localPaths.syncPendingFilePath()), false);
  }, {prefix: 'ilu-sync-policy-pending-'});
});

test('disable during backoff prevents another backend call and enable reconciles pending work', async () => {
  await withTempHome(async () => {
    const localPaths = loadFresh(path.join(repoRoot, 'utils', 'local-paths.ts'));
    const configStore = loadFresh(path.join(repoRoot, 'utils', 'config-store.ts'));
    configStore.saveSyncConfig({enabled: true, remoteUrl: '/tmp/controlled.git', branch: 'main', autoSync: true});
    const syncIndex = loadFresh(path.join(repoRoot, 'sync', 'index.ts'));
    let backendCalls = 0;
    let fail = true;
    const backend = {
      async synchronize() {
        backendCalls += 1;
        if (fail) throw new Error('controlled transport failure');
      },
      classifyError() {
        return {kind: 'network', retryable: true, safeMessage: 'Remote unavailable'};
      }
    };
    const options = {backend, rootPath: localPaths.storageDirPath(), retryDelayMs: 25, maxRetryDelayMs: 25};
    const runtime = await syncIndex.createSyncRuntime(options);
    const active = runtime.sync({domain: 'todos', action: 'save'});
    await waitForCondition(() => runtime.getSyncStatus().backoffUntil !== null);

    configStore.saveSyncConfig({enabled: false, remoteUrl: '/tmp/controlled.git', branch: 'main', autoSync: true});
    const disabled = await syncIndex.disable();
    assert.equal(disabled.status, 'disabled');
    assert.equal(backendCalls, 1);

    fail = false;
    configStore.saveSyncConfig({enabled: true, remoteUrl: '/tmp/controlled.git', branch: 'main', autoSync: true});
    const enabled = await syncIndex.enable(options);
    await active;
    assert.equal(enabled.status, 'healthy');
    assert.equal(backendCalls, 2);
    assert.equal(fs.existsSync(localPaths.syncPendingFilePath()), false);
  }, {prefix: 'ilu-sync-disable-backoff-'});
});

test('disable waits for an automatic rehydrated backend before rapid enable starts another runtime', async () => {
  await withTempHome(async () => {
    const localPaths = loadFresh(path.join(repoRoot, 'utils', 'local-paths.ts'));
    const configStore = loadFresh(path.join(repoRoot, 'utils', 'config-store.ts'));
    const rootPath = localPaths.storageDirPath();
    const stateDirectory = path.join(rootPath, '.sync-core');
    fs.mkdirSync(stateDirectory, {recursive: true, mode: 0o700});
    fs.writeFileSync(path.join(stateDirectory, 'state.json'), JSON.stringify({
      status: 'degraded_network',
      hasPendingRemote: true,
      pendingOperationId: 'automatic-rehydrated',
      retryCount: 0,
      backoffUntil: null,
      lastErrorKind: 'network',
      lastErrorMessage: 'Remote unavailable',
      lastSyncReason: 'save',
      lastPhase: null,
      lastSnapshotId: null,
      lastSyncedSnapshotId: null,
      retryable: true,
      pendingContext: {action: 'save'}
    }), {mode: 0o600});
    configStore.saveSyncConfig({enabled: true, remoteUrl: '/tmp/controlled.git', branch: 'main', autoSync: true});
    const syncIndex = loadFresh(path.join(repoRoot, 'sync', 'index.ts'));
    let backendCalls = 0;
    let releaseFirstBackend;
    const firstBackend = new Promise(resolve => {
      releaseFirstBackend = resolve;
    });
    const backend = {
      async synchronize() {
        backendCalls += 1;
        if (backendCalls === 1) {
          await firstBackend;
        }
      },
      classifyError() {
        return {kind: 'network', retryable: true};
      }
    };
    const options = {backend, rootPath, retryDelayMs: 1, maxRetryDelayMs: 1};
    await syncIndex.createSyncRuntime(options);
    await waitForCondition(() => backendCalls === 1);

    configStore.saveSyncConfig({enabled: false, remoteUrl: '/tmp/controlled.git', branch: 'main', autoSync: true});
    await syncIndex.disable();
    configStore.saveSyncConfig({enabled: true, remoteUrl: '/tmp/controlled.git', branch: 'main', autoSync: true});
    const enabling = syncIndex.enable(options);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(backendCalls, 1);

    releaseFirstBackend();
    const enabled = await enabling;
    assert.equal(enabled.status, 'healthy');
    assert.equal(backendCalls, 2);
  }, {prefix: 'ilu-sync-rehydrated-backend-'});
});
