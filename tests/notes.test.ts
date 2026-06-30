import 'colors';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..');
const notesModulePath = path.join(repoRoot, 'notes', 'notes.ts');
const promptSelectionModulePath = path.join(repoRoot, 'utils', 'prompt-index-selection.ts');

function loadNotesWithStubs({promptAnswers = [], savedNotes = [], labels = [], events}: any = {}) {
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
    const isPromptSelectionHelper = parent && parent.filename && parent.filename.endsWith(path.join('utils', 'prompt-index-selection.ts'));

    if (request === '../utils/prompts' || request === '../utils/prompts.ts' || (isPromptSelectionHelper && (request === './prompts' || request === './prompts.ts'))) {
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

    if (request === '../utils' || request === '../utils/index.ts' || (isPromptSelectionHelper && (request === './' || request === './index.ts'))) {
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

    if (request === './model' || request === './model.ts') {
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

    if (request === './inline-note-prompt' || request === './inline-note-prompt.ts') {
      return async (options) => {
        inlinePromptCalls.push(options);

        if (queuedAnswers.length === 0) {
          throw new Error('No inline prompt answers left');
        }

        return queuedAnswers.shift();
      };
    }

    if (request === 'lodash/isUndefined' || request === 'lodash/isUndefined.js') {
      return value => typeof value === 'undefined';
    }

    if (request === 'lodash/find' || request === 'lodash/find.js') {
      return (collection, match) => collection.find(item => item === match || item.title === match.title);
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const Notes = require(notesModulePath).default;
    return {Notes, logs, promptCalls, inlinePromptCalls, modelState};
  } finally {
    process.env.PATH = originalPathEnv;
    Module._load = originalLoad;
    delete require.cache[require.resolve(notesModulePath)];
    delete require.cache[require.resolve(promptSelectionModulePath)];
  }
}

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
