require('colors');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const notesModulePath = path.join(repoRoot, 'notes', 'notes.js');
const promptSelectionModulePath = path.join(repoRoot, 'utils', 'prompt-index-selection.js');

function loadNotesWithStubs({promptAnswers = [], savedNotes = [], labels = [], events} = {}) {
  const originalLoad = Module._load;
  const originalPathEnv = process.env.PATH;
  const logs = [];
  const promptCalls = [];
  const inlinePromptCalls = [];
  const queuedAnswers = Array.isArray(promptAnswers) ? [...promptAnswers] : [promptAnswers];
  const modelState = {
    list: {
      notes: savedNotes.map(note => ({labels: [], content: '', ...note})),
      labels: labels.map(label => ({...label}))
    },
    addCalls: [],
    removeCalls: [],
    editCalls: []
  };

  delete require.cache[require.resolve(notesModulePath)];
  delete require.cache[require.resolve(promptSelectionModulePath)];
  process.env.PATH = '';

  Module._load = function patchedLoad(request, parent, isMain) {
    const isPromptSelectionHelper = parent && parent.filename && parent.filename.endsWith(path.join('utils', 'prompt-index-selection.js'));

    if (request === '../utils/inquirer' || (isPromptSelectionHelper && request === './inquirer')) {
      return {
        prompt: async (questions) => {
          promptCalls.push(questions);

          if (queuedAnswers.length === 0) {
            throw new Error('No prompt answers left');
          }

          return queuedAnswers.shift();
        }
      };
    }

    if (request === '../utils' || (isPromptSelectionHelper && request === './')) {
      return {
        required: () => true,
        getLabel: (color, title) => `[${title}]`,
        log: Object.assign(
          (message) => {
            if (events) {
              events.push('log');
            }
            logs.push(message);
          },
          {
            info(message) {
              if (events) {
                events.push('log.info');
              }
              logs.push(message);
            },
            pointerSmall(message) {
              if (events) {
                events.push('log.pointerSmall');
              }
              logs.push(message);
            },
            cross(message) {
              if (events) {
                events.push('log.cross');
              }
              logs.push(message);
            }
          }
        )
      };
    }

    if (request === './model') {
      return {
        getCurrent() {
          return modelState.list;
        },
        notes: {
          add(note) {
            modelState.addCalls.push(note);
            modelState.list.notes.push(note);
          },
          edit(index, answers) {
            modelState.editCalls.push({index, answers});
            Object.assign(modelState.list.notes[index - 1], answers);
          },
          remove(index) {
            modelState.removeCalls.push(index);
            modelState.list.notes.splice(index - 1, 1);
          }
        }
      };
    }

    if (request === './open-with-editor') {
      return async () => {};
    }

    if (request === './inline-note-prompt') {
      return async (options) => {
        inlinePromptCalls.push(options);

        if (queuedAnswers.length === 0) {
          throw new Error('No inline prompt answers left');
        }

        return queuedAnswers.shift();
      };
    }

    if (request === 'lodash/isUndefined') {
      return value => typeof value === 'undefined';
    }

    if (request === 'lodash/find') {
      return (collection, match) => collection.find(item => item === match || item.title === match.title);
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const Notes = require(notesModulePath);
    return {Notes, logs, promptCalls, inlinePromptCalls, modelState};
  } finally {
    process.env.PATH = originalPathEnv;
    Module._load = originalLoad;
    delete require.cache[require.resolve(notesModulePath)];
    delete require.cache[require.resolve(promptSelectionModulePath)];
  }
}

test('note --show no limpia la terminal antes de renderizar las notas', {concurrency: false}, async () => {
  const events = [];
  const {Notes, logs} = loadNotesWithStubs({
    events,
    savedNotes: [
      {title: 'Uno'},
      {title: 'Dos'}
    ]
  });
  const originalConsoleClear = console.clear;

  console.clear = () => {
    events.push('clear');
  };

  try {
    Notes.show();
  } finally {
    console.clear = originalConsoleClear;
  }

  assert.deepEqual(events, ['log.pointerSmall', 'log.pointerSmall']);
  assert.ok(logs.some(entry => /Uno/.test(entry)));
  assert.ok(logs.some(entry => /Dos/.test(entry)));
});

test('note --edit usa selección interactiva como única vía', {concurrency: false}, async () => {
  const {Notes, promptCalls, inlinePromptCalls, modelState} = loadNotesWithStubs({
    savedNotes: [
      {title: 'Uno', content: 'Texto 1'},
      {title: 'Dos', content: 'Texto 2'}
    ],
    promptAnswers: [
      {index: 2},
      {title: 'Dos editada'},
      'Texto editado'
    ]
  });

  await Notes.edit();

  assert.equal(promptCalls.length, 2);
  assert.equal(promptCalls[0][0].type, 'select');
  assert.equal(promptCalls[1][0].name, 'title');
  assert.equal(promptCalls[1].some(question => question.name === 'content'), false);
  assert.deepEqual(inlinePromptCalls, [{message: 'Content of the note', initialValue: 'Texto 2'}]);
  assert.deepEqual(modelState.editCalls, [
    {
      index: 2,
      answers: {title: 'Dos editada', content: 'Texto editado'}
    }
  ]);
});

test('note --add usa prompt inline para contenido como vía principal', {concurrency: false}, async () => {
  const {Notes, promptCalls, inlinePromptCalls, modelState} = loadNotesWithStubs({
    savedNotes: [],
    promptAnswers: [
      {title: 'Idea rápida', labels: []},
      'Linea 1\nLinea 2'
    ]
  });

  await Notes.add();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].name, 'title');
  assert.equal(promptCalls[0].some(question => question.name === 'content'), false);
  assert.deepEqual(inlinePromptCalls, [{message: 'Content of the note', initialValue: ''}]);
  assert.deepEqual(modelState.addCalls, [{title: 'Idea rápida', labels: [], content: 'Linea 1\nLinea 2'}]);
  assert.deepEqual(modelState.list.notes, [{title: 'Idea rápida', labels: [], content: 'Linea 1\nLinea 2'}]);
});

test('note --remove usa selección interactiva como única vía', {concurrency: false}, async () => {
  const {Notes, promptCalls, modelState} = loadNotesWithStubs({
    savedNotes: [
      {title: 'Uno'},
      {title: 'Dos'},
      {title: 'Tres'}
    ],
    promptAnswers: [{indexes: [1, 3]}]
  });

  await Notes.remove();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].type, 'checkbox');
  assert.equal(promptCalls[0][0].name, 'indexes');
  assert.deepEqual(promptCalls[0][0].choices.map(choice => choice.value), [1, 2, 3]);
  assert.deepEqual(modelState.list.notes.map(note => note.title), ['Dos']);
});
