import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as __cjsImport54 from 'node:child_process';
const { execFileSync } = __cjsImport54;
import * as __cjsImport55 from '../support/home-sandbox';
const { withTempHome } = __cjsImport55;
import localPaths from '../utils/local-paths';
const repoRoot = path.resolve(import.meta.dirname, '..');

test('utils/local-paths resuelve .ilu, bases de datos y sync bajo HOME', () => {
  return withTempHome(tempHome => {
    assert.equal(localPaths.storageDirPath(), path.join(tempHome, '.ilu'));
    assert.equal(localPaths.dbFilePath('notes'), path.join(tempHome, '.ilu', 'notes.json'));
    assert.equal(localPaths.dbFilePath('clocks'), path.join(tempHome, '.ilu', 'clocks.json'));
    assert.equal(typeof localPaths.noteTempFilePath, 'undefined');
    assert.equal(localPaths.syncDirPath(), path.join(tempHome, '.ilu', '.config'));
    assert.equal(localPaths.syncConfigFilePath(), path.join(tempHome, '.ilu', '.config', 'sync-config.json'));
    assert.equal(localPaths.ttsConfigFilePath(), path.join(tempHome, '.ilu', '.config', 'tts-config.json'));
    assert.equal(localPaths.syncStateFilePath(), path.join(tempHome, '.ilu', '.config', 'sync-state.json'));
  }, {prefix: 'ilu-paths-'});
});

test('puede correr con HOME temporal sin tocar datos reales', () => {
  return withTempHome(tempHome => {
    const script = `
      import fs from 'node:fs';
      import paths from './utils/local-paths.ts';
      import TodosModel from './todos/model.ts';
      import Notes from './notes/notes.ts';
      TodosModel.add({title: 'phase2', description: ''});

      process.stdout.write(JSON.stringify({
        storageDir: paths.storageDirPath(),
        todosDbFile: paths.dbFilePath('todos'),
        notesDir: Notes.dir,
        noteGetter: typeof Notes.getTempFilePath,
        todosDbExists: fs.existsSync(paths.dbFilePath('todos'))
      }));
    `;

    const output = execFileSync(process.execPath, ['--import', 'tsx', '-e', script], {
      cwd: repoRoot,
      env: {...process.env, HOME: tempHome},
      encoding: 'utf8'
    });

    const result = JSON.parse(output);
    const expectedStorageDir = path.join(tempHome, '.ilu');

    assert.equal(result.storageDir, expectedStorageDir);
    assert.equal(result.todosDbFile, path.join(expectedStorageDir, 'todos.json'));
    assert.equal(result.notesDir, `${expectedStorageDir}/`);
    assert.equal(result.noteGetter, 'undefined');
    assert.equal(result.todosDbExists, true);
  }, {prefix: 'ilu-home-'});
});
