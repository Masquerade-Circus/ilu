require('colors');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const listsModulePath = path.join(repoRoot, 'notes', 'lists.js');
const promptSelectionModulePath = path.join(repoRoot, 'utils', 'prompt-index-selection.js');

function loadNoteListsWithStubs({promptAnswers = [], savedLists = [], events} = {}) {
  const originalLoad = Module._load;
  const logs = [];
  const promptCalls = [];
  const queuedAnswers = Array.isArray(promptAnswers) ? [...promptAnswers] : [promptAnswers];
  const modelState = {
    lists: savedLists.map((list, index) => ({
      notes: [],
      labels: [],
      description: '',
      current: false,
      $id: `list-${index + 1}`,
      index: index + 1,
      ...list
    })),
    saveCalls: [],
    removeCalls: [],
    useCalls: []
  };

  delete require.cache[require.resolve(listsModulePath)];
  delete require.cache[require.resolve(promptSelectionModulePath)];

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
        colors: {blue: 'blue', red: 'red'},
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
            },
            warning(message) {
              if (events) {
                events.push('log.warning');
              }
              logs.push(message);
            }
          }
        )
      };
    }

    if (request === './model') {
      return {
        find() {
          return modelState.lists;
        },
        findOne(query = {}) {
          if (Object.prototype.hasOwnProperty.call(query, 'index')) {
            return modelState.lists.find(item => item.index === query.index);
          }

          if (Object.prototype.hasOwnProperty.call(query, 'current')) {
            return modelState.lists.find(item => item.current === query.current);
          }

          return modelState.lists[0];
        },
        getCurrent() {
          return modelState.lists.find(item => item.current);
        },
        getFirst() {
          return modelState.lists[0];
        },
        save(item) {
          modelState.saveCalls.push({index: item.index, title: item.title, description: item.description});
          return item;
        },
        use(id) {
          modelState.useCalls.push(id);
          modelState.lists.forEach(item => {
            item.current = item.$id === id;
          });
        },
        remove(item) {
          modelState.removeCalls.push(item ? item.index : item);

          if (!item) {
            modelState.lists = [];
            return;
          }

          modelState.lists = modelState.lists
            .filter(current => current.$id !== item.$id)
            .map((current, index) => ({...current, index: index + 1}));
        },
        labels: {
          add() {},
          edit() {},
          remove() {}
        }
      };
    }

    if (request === 'lodash/isUndefined') {
      return value => typeof value === 'undefined';
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const Lists = require(listsModulePath);
    return {Lists, logs, promptCalls, modelState};
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(listsModulePath)];
    delete require.cache[require.resolve(promptSelectionModulePath)];
  }
}

test('note-list --details usa selección interactiva como única vía', {concurrency: false}, async () => {
  const {Lists, logs, promptCalls} = loadNoteListsWithStubs({
    savedLists: [
      {title: 'Inbox', description: 'Base'},
      {title: 'Ideas', description: 'Notas activas'}
    ],
    promptAnswers: [{index: 2}]
  });

  await Lists.details();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].type, 'select');
  assert.equal(promptCalls[0][0].name, 'index');
  assert.deepEqual(promptCalls[0][0].choices.map(choice => choice.value), [1, 2]);
  assert.ok(logs.some(entry => /Ideas/.test(entry)));
  assert.ok(logs.some(entry => /Notas activas/.test(entry)));
});

test('note-list --edit usa selección interactiva como única vía', {concurrency: false}, async () => {
  const {Lists, promptCalls, modelState} = loadNoteListsWithStubs({
    savedLists: [
      {title: 'Inbox', description: 'Base'},
      {title: 'Ideas', description: 'Notas activas'}
    ],
    promptAnswers: [
      {index: 2},
      {title: 'Ideas 2', description: 'Curadas'}
    ]
  });

  await Lists.edit();

  assert.equal(promptCalls.length, 2);
  assert.equal(promptCalls[0][0].type, 'select');
  assert.equal(promptCalls[1][0].name, 'title');
  assert.deepEqual(modelState.saveCalls, [
    {index: 2, title: 'Ideas 2', description: 'Curadas'}
  ]);
});

test('note-list --use usa selección interactiva como única vía', {concurrency: false}, async () => {
  const {Lists, promptCalls, modelState} = loadNoteListsWithStubs({
    savedLists: [
      {title: 'Inbox', current: true},
      {title: 'Ideas'}
    ],
    promptAnswers: [{index: 2}]
  });

  await Lists.use();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].type, 'select');
  assert.deepEqual(modelState.useCalls, ['list-2']);
  assert.equal(modelState.lists[1].current, true);
});

test('note-list --remove usa selección interactiva como única vía', {concurrency: false}, async () => {
  const {Lists, promptCalls, modelState} = loadNoteListsWithStubs({
    savedLists: [
      {title: 'Inbox', current: true},
      {title: 'Ideas'},
      {title: 'Archivo'}
    ],
    promptAnswers: [{indexes: [1, 3]}]
  });

  await Lists.remove();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].type, 'checkbox');
  assert.equal(promptCalls[0][0].name, 'indexes');
  assert.deepEqual(promptCalls[0][0].choices.map(choice => choice.value), [1, 2, 3]);
  assert.deepEqual(modelState.removeCalls, [1, 3]);
  assert.deepEqual(modelState.lists.map(item => item.title), ['Ideas']);
  assert.deepEqual(modelState.useCalls, ['list-2']);
});
