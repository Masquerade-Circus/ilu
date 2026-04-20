const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const notesModulePath = path.join(__dirname, 'notes.js');
const modelModulePath = path.join(__dirname, 'model.js');
const openWithEditorModulePath = path.join(__dirname, 'open-with-editor.js');
const localPathsModulePath = path.join(__dirname, '..', 'utils', 'local-paths.js');
const utilsModulePath = path.join(__dirname, '..', 'utils', 'index.js');
const inquirerModulePath = path.join(__dirname, '..', 'utils', 'inquirer.js');

function loadNotesWithStubs({platform, promptImpl, openWithEditorImpl, tempFilePath, model}) {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalAccessSync = fs.accessSync;
  const originalCacheEntries = new Map();
  const stubbedModules = new Map([
    [inquirerModulePath, {prompt: promptImpl}],
    [modelModulePath, model],
    [openWithEditorModulePath, openWithEditorImpl],
    [localPathsModulePath, {
      storageDirPath() {
        return path.dirname(tempFilePath);
      },
      noteTempFilePath() {
        return tempFilePath;
      }
    }],
    [utilsModulePath, {
      required() {
        return () => true;
      },
      log() {},
      getLabel(color, title) {
        return `${color}:${title}`;
      }
    }]
  ]);

  for (const [modulePath, exports] of stubbedModules) {
    originalCacheEntries.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports
    };
  }

  delete require.cache[notesModulePath];

  Object.defineProperty(process, 'platform', {
    configurable: true,
    enumerable: originalPlatform.enumerable,
    writable: originalPlatform.writable,
    value: platform
  });

  fs.accessSync = () => {
    throw new Error('ENOENT');
  };

  try {
    return require(notesModulePath);
  } finally {
    fs.accessSync = originalAccessSync;

    Object.defineProperty(process, 'platform', originalPlatform);

    delete require.cache[notesModulePath];

    for (const [modulePath, originalCacheEntry] of originalCacheEntries) {
      if (originalCacheEntry) {
        require.cache[modulePath] = originalCacheEntry;
      } else {
        delete require.cache[modulePath];
      }
    }
  }
}

test('notes.add usa textedit en macOS aunque no exista en PATH', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-notes-test-'));
  const tempFilePath = path.join(tempDir, 'note.txt');
  const promptCalls = [];
  const openCalls = [];
  const addedNotes = [];

  try {
    const Notes = loadNotesWithStubs({
      platform: 'darwin',
      tempFilePath,
      promptImpl(questions) {
        promptCalls.push(questions);
        return Promise.resolve({
          title: 'Idea rápida',
          labels: []
        });
      },
      async openWithEditorImpl(file, options) {
        openCalls.push({file, options});
      },
      model: {
        getCurrent() {
          return {
            labels: [],
            notes: []
          };
        },
        notes: {
          add(note) {
            addedNotes.push(note);
          }
        }
      }
    });

    Notes.show = () => {};

    await Notes.add();

    assert.equal(promptCalls.length, 1);
    assert.equal(promptCalls[0].some(question => question.name === 'content'), false);
    assert.deepEqual(openCalls, [{
      file: tempFilePath,
      options: {app: 'textedit'}
    }]);
    assert.equal(addedNotes.length, 1);
    assert.equal(addedNotes[0].content, '');
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true});
  }
});
