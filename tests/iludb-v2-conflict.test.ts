import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withTempHome } from '../support/home-sandbox.ts';
import { dbFilePath } from '../utils/local-paths.ts';
import loadDb, { DataConflictError } from '../utils/load-db.ts';
import createListModel from '../utils/create-list-model.ts';
import { configureSyncExecutor, configureSyncRunner } from '../sync/ilu-hooks.ts';
import { DataRecoveryError } from '../sync/iludb-recovery.ts';
import { createUiErrorResult } from '../ui/action-results.ts';
import syncIndex from '../sync/index.ts';
import { savePendingMarker } from '../sync/state-store.ts';

function legacySnapshot({collectionName, itemKey}: {collectionName: string; itemKey: 'tasks' | 'notes' | 'columns'}) {
  const timestamp = '2026-08-13T00:00:00.000Z';
  const nested = itemKey === 'columns'
    ? [{id: 'backlog', title: 'Backlog', wipLimit: null, cards: [], index: 1}]
    : [{title: 'Preserve me', description: '', content: 'Legacy content', labels: [], done: false}];
  const document = itemKey === 'columns'
    ? {
        $id: 1,
        $createdAt: timestamp,
        $modifiedAt: timestamp,
        title: 'Legacy',
        description: '',
        current: true,
        index: 1,
        defaultColumnId: 'backlog',
        columns: nested
      }
    : {
        $id: 1,
        $createdAt: timestamp,
        $modifiedAt: timestamp,
        title: 'Legacy',
        description: '',
        current: true,
        index: 1,
        [itemKey]: nested,
        labels: []
      };

  return {
    collections: {
      [collectionName]: {
        data: [document],
        index: 1,
        createdAt: timestamp,
        modifiedAt: timestamp
      }
    },
    createdAt: timestamp,
    modifiedAt: timestamp
  };
}

test('iludb 2 migrates a legacy snapshot without revision and preserves its domain data', async () => {
  await withTempHome(async () => {
    const fixtures = [
      {dbName: 'todos', collectionName: 'todos', itemKey: 'tasks' as const},
      {dbName: 'notes', collectionName: 'notes', itemKey: 'notes' as const},
      {dbName: 'boards', collectionName: 'boards', itemKey: 'columns' as const}
    ];

    for (const fixture of fixtures) {
      fs.mkdirSync(path.dirname(dbFilePath(fixture.dbName)), {recursive: true});
      fs.writeFileSync(dbFilePath(fixture.dbName), JSON.stringify(legacySnapshot(fixture)));

      const database = loadDb(fixture.dbName);
      const collection = database.getCollection(fixture.collectionName);
      const legacy = collection.get(1);

      assert.equal(database.data.revision, 0, fixture.dbName);
      assert.equal(legacy?.title, 'Legacy', fixture.dbName);

      collection.update({...legacy!, description: 'Migrated'});

      const persisted = JSON.parse(fs.readFileSync(dbFilePath(fixture.dbName), 'utf8'));
      const document = persisted.collections[fixture.collectionName].data[0];
      assert.equal(persisted.revision, 1, fixture.dbName);
      assert.equal(document.description, 'Migrated', fixture.dbName);
      assert.equal(document[fixture.itemKey][0].title, fixture.itemKey === 'columns' ? 'Backlog' : 'Preserve me', fixture.dbName);
    }
  }, {prefix: 'ilu-iludb-v2-legacy-'});
});

test('iludb 2 rejects invalid snapshots without overwriting them', async () => {
  await withTempHome(async () => {
    fs.mkdirSync(path.dirname(dbFilePath('notes')), {recursive: true});
    const invalid = '{"collections":';
    fs.writeFileSync(dbFilePath('notes'), invalid);

    assert.throws(() => loadDb('notes'), SyntaxError);
    assert.equal(fs.readFileSync(dbFilePath('notes'), 'utf8'), invalid);
  }, {prefix: 'ilu-iludb-v2-invalid-'});
});

test('a stale writer fails closed, reconciles through sync and reloads the external snapshot', async () => {
  await withTempHome(async () => {
    const first = loadDb('boards');
    const second = loadDb('boards');
    const firstBoards = first.getCollection('boards');
    const secondBoards = second.getCollection('boards');

    firstBoards.add({title: 'Remote'});

    let conflict: DataConflictError | null = null;
    try {
      secondBoards.add({title: 'Local stale'});
    } catch (error: unknown) {
      conflict = error as DataConflictError;
    }

    assert.ok(conflict instanceof DataConflictError);
    const result = await conflict.reconciliation;
    assert.equal(result.status, 'reloaded-local');
    assert.equal(secondBoards.findOne({title: 'Remote'})?.title, 'Remote');
    assert.equal(secondBoards.findOne({title: 'Local stale'}), undefined);

    const persisted = JSON.parse(fs.readFileSync(dbFilePath('boards'), 'utf8'));
    assert.deepEqual(persisted.collections.boards.data.map((board: {title: string}) => board.title), ['Remote']);
  }, {prefix: 'ilu-iludb-v2-conflict-'});
});

test('a failed model save does not notify sync and reload discards its unsaved in-memory mutation', async () => {
  await withTempHome(async () => {
    const syncEvents: unknown[] = [];
    const restoreExecutor = configureSyncExecutor({
      sync: async (context) => {
        syncEvents.push(context);
      }
    });

    try {
      const model = createListModel({dbName: 'todos', collectionName: 'todos', itemKey: 'tasks', itemHasCheck: true});
      model.add({title: 'Current', description: ''});
      await new Promise((resolve) => setImmediate(resolve));
      syncEvents.length = 0;

      const external = loadDb('todos');
      const externalTodos = external.getCollection('todos');
      const current = externalTodos.findOne({current: true});
      externalTodos.update({...current!, description: 'External update'});

      let conflict: DataConflictError | null = null;
      try {
        model.tasks.add({title: 'Unsaved local task'});
      } catch (error: unknown) {
        conflict = error as DataConflictError;
      }

      assert.ok(conflict instanceof DataConflictError);
      assert.equal(syncEvents.length, 0);
      assert.equal((await conflict.reconciliation).status, 'reloaded-local');
      assert.equal(model.getCurrent().description, 'External update');
      assert.deepEqual(model.getCurrent().tasks, []);
      assert.equal(syncEvents.length, 0);
    } finally {
      restoreExecutor();
    }
  }, {prefix: 'ilu-iludb-v2-no-sync-on-failure-'});
});

test('recovery is deduplicated by file and every stale instance receives the same typed conflict', async () => {
  await withTempHome(async () => {
    fs.mkdirSync(path.dirname(dbFilePath('notes')), {recursive: true});
    fs.writeFileSync(dbFilePath('notes'), JSON.stringify(legacySnapshot({collectionName: 'notes', itemKey: 'notes'})));
    const first = loadDb('notes');
    const second = loadDb('notes');
    const external = loadDb('notes');
    const externalNotes = external.getCollection('notes');
    externalNotes.update({...externalNotes.get(1)!, description: 'External'});

    let firstError: DataConflictError | null = null;
    let secondError: DataConflictError | null = null;
    try {
      first.getCollection('notes').update({...first.getCollection('notes').get(1)!, title: 'First stale'});
    } catch (error: unknown) {
      firstError = error as DataConflictError;
    }
    try {
      second.getCollection('notes').update({...second.getCollection('notes').get(1)!, title: 'Second stale'});
    } catch (error: unknown) {
      secondError = error as DataConflictError;
    }

    assert.ok(firstError instanceof DataConflictError);
    assert.strictEqual(secondError, firstError);
    assert.strictEqual(secondError?.reconciliation, firstError.reconciliation);
    assert.equal((await firstError.reconciliation).status, 'reloaded-local');
    assert.equal(first.getCollection('notes').get(1)?.description, 'External');
    assert.equal(second.getCollection('notes').get(1)?.description, 'External');
  }, {prefix: 'ilu-iludb-v2-dedupe-'});
});

test('enabled recovery uses the configured TUI authority and rejects terminal sync status', async () => {
  await withTempHome(async () => {
    fs.mkdirSync(path.dirname(dbFilePath('boards')), {recursive: true});
    fs.writeFileSync(dbFilePath('boards'), JSON.stringify(legacySnapshot({collectionName: 'boards', itemKey: 'columns'})));
    const configPath = path.join(path.dirname(dbFilePath('boards')), '.config', 'sync-config.json');
    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    fs.writeFileSync(configPath, JSON.stringify({enabled: true, autoSync: true, remoteUrl: './tmp/unused.git', branch: 'main'}));
    const stale = loadDb('boards');
    const external = loadDb('boards');
    const externalBoards = external.getCollection('boards');
    externalBoards.update({...externalBoards.get(1)!, description: 'External'});
    const calls: unknown[] = [];
    const restore = configureSyncRunner({
      sync: async () => ({status: 'healthy'}),
      reconcileFile: async (input) => {
        calls.push(input);
        return {status: 'conflict', hasPendingRemote: true};
      }
    });

    try {
      let conflict: DataConflictError | null = null;
      try {
        stale.getCollection('boards').update({...stale.getCollection('boards').get(1)!, title: 'Stale'});
      } catch (error: unknown) {
        conflict = error as DataConflictError;
      }
      assert.ok(conflict instanceof DataConflictError);
      await assert.rejects(conflict.reconciliation, DataRecoveryError);
      assert.equal(calls.length, 1);
      assert.equal(JSON.parse(fs.readFileSync(dbFilePath('boards'), 'utf8')).collections.boards.data[0].description, 'External');
    } finally {
      restore();
    }
  }, {prefix: 'ilu-iludb-v2-terminal-'});
});

test('reload failure rejects recovery with a typed safe error', async () => {
  await withTempHome(async () => {
    fs.mkdirSync(path.dirname(dbFilePath('todos')), {recursive: true});
    fs.writeFileSync(dbFilePath('todos'), JSON.stringify(legacySnapshot({collectionName: 'todos', itemKey: 'tasks'})));
    const stale = loadDb('todos');
    const external = loadDb('todos');
    const externalTodos = external.getCollection('todos');
    externalTodos.update({...externalTodos.get(1)!, description: 'External'});

    let conflict: DataConflictError | null = null;
    try {
      stale.getCollection('todos').update({...stale.getCollection('todos').get(1)!, title: 'Stale'});
    } catch (error: unknown) {
      conflict = error as DataConflictError;
    }
    assert.ok(conflict instanceof DataConflictError);
    fs.writeFileSync(dbFilePath('todos'), '{"invalid":');
    await assert.rejects(conflict.reconciliation, DataRecoveryError);
    assert.equal(fs.readFileSync(dbFilePath('todos'), 'utf8'), '{"invalid":');
  }, {prefix: 'ilu-iludb-v2-reload-error-'});
});

test('TUI action boundary maps a data conflict to safe recovery copy without a stack', async () => {
  await withTempHome(async () => {
    fs.mkdirSync(path.dirname(dbFilePath('notes')), {recursive: true});
    fs.writeFileSync(dbFilePath('notes'), JSON.stringify(legacySnapshot({collectionName: 'notes', itemKey: 'notes'})));
    const stale = loadDb('notes');
    const external = loadDb('notes');
    const externalNotes = external.getCollection('notes');
    externalNotes.update({...externalNotes.get(1)!, description: 'External'});
    let conflict: DataConflictError | null = null;
    try {
      stale.getCollection('notes').update({...stale.getCollection('notes').get(1)!, title: 'Stale'});
    } catch (error: unknown) {
      conflict = error as DataConflictError;
    }

    assert.ok(conflict instanceof DataConflictError);
    const result = createUiErrorResult(conflict, 'Fallback');
    assert.equal(result.ok, false);
    assert.match(result.error, /recover/i);
    assert.doesNotMatch(result.error, /at |\/home\/|stack/i);
    await conflict.reconciliation;
  }, {prefix: 'ilu-iludb-v2-ui-error-'});
});

test('queued recovery keeps a newer revision integrated by the active sync instead of restoring its old capture', async () => {
  await withTempHome(async () => {
    const filePath = dbFilePath('todos');
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    const snapshotB = {...legacySnapshot({collectionName: 'todos', itemKey: 'tasks'}), revision: 1};
    const snapshotC = {...legacySnapshot({collectionName: 'todos', itemKey: 'tasks'}), revision: 2};
    snapshotC.collections.todos.data[0].description = 'Revision C';
    fs.writeFileSync(filePath, JSON.stringify(snapshotB));
    const configPath = path.join(path.dirname(filePath), '.config', 'sync-config.json');
    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    fs.writeFileSync(configPath, JSON.stringify({enabled: true, autoSync: true, remoteUrl: './tmp/local.git', branch: 'main'}));
    let calls = 0;
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const seen: string[] = [];
    const runtime = await syncIndex.createSyncRuntime({
      rootPath: path.dirname(filePath),
      backend: {
        async synchronize() {
          calls += 1;
          if (calls === 1) {
            await activeGate;
            fs.writeFileSync(filePath, JSON.stringify(snapshotC));
            return;
          }
          seen.push(fs.readFileSync(filePath, 'utf8'));
        },
        classifyError() {
          return {kind: 'unknown', retryable: false};
        }
      }
    });

    const active = runtime.sync({reason: 'active'});
    const recovery = syncIndex.reconcileFile({filePath, snapshot: JSON.stringify(snapshotB), context: {reason: 'recovery'}});
    releaseActive();
    await Promise.all([active, recovery]);

    assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).revision, 2);
    assert.equal(JSON.parse(seen[0]).revision, 2);
  }, {prefix: 'ilu-iludb-v2-current-base-'});
});

test('terminal recovery restores the file that existed when its serialized turn began', async () => {
  await withTempHome(async () => {
    const filePath = dbFilePath('notes');
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    const before = {...legacySnapshot({collectionName: 'notes', itemKey: 'notes'}), revision: 4};
    fs.writeFileSync(filePath, JSON.stringify(before));
    const configPath = path.join(path.dirname(filePath), '.config', 'sync-config.json');
    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    fs.writeFileSync(configPath, JSON.stringify({enabled: true, autoSync: true, remoteUrl: './tmp/local.git', branch: 'main'}));
    await syncIndex.createSyncRuntime({
      rootPath: path.dirname(filePath),
      backend: {
        async synchronize() {
          fs.writeFileSync(filePath, '{"collections":');
          throw new Error('terminal conflict');
        },
        classifyError() {
          return {kind: 'conflict', retryable: false};
        }
      }
    });

    const status = await syncIndex.reconcileFile({filePath, snapshot: JSON.stringify(before), context: {reason: 'terminal'}});

    assert.equal(status.hasPendingRemote, true);
    assert.equal(fs.readFileSync(filePath, 'utf8'), JSON.stringify(before));
  }, {prefix: 'ilu-iludb-v2-rollback-'});
});

test('sync retry enable and recovery share one backend queue', async () => {
  await withTempHome(async () => {
    const filePath = dbFilePath('boards');
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    const snapshot = {...legacySnapshot({collectionName: 'boards', itemKey: 'columns'}), revision: 1};
    fs.writeFileSync(filePath, JSON.stringify(snapshot));
    const configPath = path.join(path.dirname(filePath), '.config', 'sync-config.json');
    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    fs.writeFileSync(configPath, JSON.stringify({enabled: true, autoSync: true, remoteUrl: './tmp/local.git', branch: 'main'}));
    let concurrent = 0;
    let maximum = 0;
    const backend = {
      async synchronize() {
        concurrent += 1;
        maximum = Math.max(maximum, concurrent);
        await new Promise((resolve) => setImmediate(resolve));
        concurrent -= 1;
      },
      classifyError() {
        return {kind: 'unknown' as const, retryable: false};
      }
    };
    const runtime = await syncIndex.createSyncRuntime({rootPath: path.dirname(filePath), backend});
    savePendingMarker({reason: 'enable'});

    await Promise.all([
      runtime.sync({reason: 'normal'}),
      syncIndex.retry({reason: 'retry'}),
      syncIndex.enable(),
      syncIndex.reconcileFile({filePath, snapshot: JSON.stringify(snapshot), context: {reason: 'recovery'}})
    ]);

    assert.equal(maximum, 1);
  }, {prefix: 'ilu-iludb-v2-one-queue-'});
});
