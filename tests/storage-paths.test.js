const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const {execFileSync} = require('node:child_process');
const {withTempHome} = require('../support/home-sandbox');

const repoRoot = path.resolve(__dirname, '..');
const localPathsModulePath = path.join(repoRoot, 'utils', 'local-paths.js');
const notesModulePath = path.join(repoRoot, 'notes', 'notes.js');

test('el helper legado para abrir editor externo ya no existe en notes', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'notes', 'open-with-editor.js')), false);
});

test('utils/local-paths resuelve .ilu, bases de datos y sync bajo HOME', () => {
  const localPaths = require(localPathsModulePath);
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

test('notes/notes usa prompt inline y ya no depende de archivo temporal para capturar contenido', async () => {
  const originalLoad = Module._load;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-notes-home-'));
  const addedNotes = [];
  const currentList = {notes: [], labels: []};

  delete require.cache[require.resolve(notesModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../utils/inquirer') {
      return {
        prompt: async () => ({title: 'Idea', labels: []})
      };
    }

    if (request === '../utils') {
      return {
        required: () => () => true,
        log: Object.assign(() => {}, {info() {}, cross() {}, pointerSmall() {}}),
        getLabel: () => ''
      };
    }

    if (request === './model') {
      return {
        getCurrent() {
          return currentList;
        },
        notes: {
          add(note) {
            addedNotes.push(note);
            currentList.notes.push(note);
          },
          edit() {},
          remove() {}
        }
      };
    }

    if (request === 'lodash/isUndefined') {
      return value => typeof value === 'undefined';
    }

    if (request === 'lodash/find') {
      return () => undefined;
    }

    if (request === './inline-note-prompt') {
      return async ({message, initialValue}) => {
        assert.equal(message, 'Content of the note');
        assert.equal(initialValue, '');
        return 'Texto inline';
      };
    }

    if (request === '../utils/local-paths') {
      return {
        storageDirPath() {
          return path.join(tempHome, '.ilu');
        }
      };
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const Notes = require(notesModulePath);

    await Notes.add();

    assert.deepEqual(addedNotes, [{title: 'Idea', labels: [], content: 'Texto inline'}]);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(notesModulePath)];
    fs.rmSync(tempHome, {recursive: true, force: true});
  }
});

test('puede correr con HOME temporal sin tocar datos reales', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-home-'));

  const script = `
    const fs = require('node:fs');
    const paths = require('./utils/local-paths');
    const TodosModel = require('./todos/model');
    const Notes = require('./notes/notes');

    TodosModel.add({title: 'phase2', description: ''});

    process.stdout.write(JSON.stringify({
      storageDir: paths.storageDirPath(),
      todosDbFile: paths.dbFilePath('todos'),
      notesDir: Notes.dir,
      noteGetter: typeof Notes.getTempFilePath,
      todosDbExists: fs.existsSync(paths.dbFilePath('todos'))
    }));
  `;

  try {
    const output = execFileSync(process.execPath, ['-e', script], {
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
  } finally {
    fs.rmSync(tempHome, {recursive: true, force: true});
  }
});
