require('colors');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const tasksModulePath = path.join(repoRoot, 'todos', 'tasks.js');
const promptSelectionModulePath = path.join(repoRoot, 'utils', 'prompt-index-selection.js');

function loadTasksWithStubs({promptAnswers = [], savedTasks = [], labels = [], events} = {}) {
  const originalLoad = Module._load;
  const logs = [];
  const promptCalls = [];
  const queuedAnswers = Array.isArray(promptAnswers) ? [...promptAnswers] : [promptAnswers];
  const modelState = {
    list: {
      tasks: savedTasks.map(task => ({labels: [], done: false, description: '', ...task})),
      labels: labels.map(label => ({...label}))
    },
    removeCalls: [],
    editCalls: []
  };

  delete require.cache[require.resolve(tasksModulePath)];
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
            radioOn(message) {
              if (events) {
                events.push('log.radioOn');
              }
              logs.push(message);
            },
            radioOff(message) {
              if (events) {
                events.push('log.radioOff');
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
        tasks: {
          add() {},
          check() {},
          edit(index, answers) {
            modelState.editCalls.push({index, answers});
            Object.assign(modelState.list.tasks[index - 1], answers);
          },
          remove(index) {
            modelState.removeCalls.push(index);
            modelState.list.tasks.splice(index - 1, 1);
          }
        }
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
    const Tasks = require(tasksModulePath);
    return {Tasks, logs, promptCalls, modelState};
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(tasksModulePath)];
    delete require.cache[require.resolve(promptSelectionModulePath)];
  }
}

test('todo --details usa selección interactiva como única vía', {concurrency: false}, async () => {
  const {Tasks, logs, promptCalls} = loadTasksWithStubs({
    savedTasks: [
      {title: 'Uno', description: 'Desc 1'},
      {title: 'Dos', description: 'Desc 2'}
    ],
    promptAnswers: [{index: 2}]
  });

  await Tasks.details();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].type, 'select');
  assert.equal(promptCalls[0][0].name, 'index');
  assert.deepEqual(promptCalls[0][0].choices.map(choice => choice.value), [1, 2]);
  assert.ok(logs.some(entry => /Dos/.test(entry)));
  assert.ok(logs.some(entry => /Desc 2/.test(entry)));
});

test('todo --show no limpia la terminal antes de renderizar las tareas', {concurrency: false}, async () => {
  const events = [];
  const {Tasks, logs} = loadTasksWithStubs({
    events,
    savedTasks: [
      {title: 'Uno'},
      {title: 'Dos', done: true}
    ]
  });
  const originalConsoleClear = console.clear;

  console.clear = () => {
    events.push('clear');
  };

  try {
    Tasks.show();
  } finally {
    console.clear = originalConsoleClear;
  }

  assert.deepEqual(events, ['log.radioOff', 'log.radioOn']);
  assert.ok(logs.some(entry => /Uno/.test(entry)));
  assert.ok(logs.some(entry => /Dos/.test(entry)));
});

test('todo --edit usa selección interactiva como única vía', {concurrency: false}, async () => {
  const {Tasks, promptCalls, modelState} = loadTasksWithStubs({
    savedTasks: [
      {title: 'Uno', description: 'Desc 1'},
      {title: 'Dos', description: 'Desc 2'}
    ],
    promptAnswers: [
      {index: 2},
      {title: 'Dos editada', description: 'Actualizada'}
    ]
  });

  await Tasks.edit();

  assert.equal(promptCalls.length, 2);
  assert.equal(promptCalls[0][0].type, 'select');
  assert.equal(promptCalls[1][0].name, 'title');
  assert.deepEqual(modelState.editCalls, [
    {
      index: 2,
      answers: {title: 'Dos editada', description: 'Actualizada'}
    }
  ]);
});

test('todo --remove usa selección interactiva como única vía', {concurrency: false}, async () => {
  const {Tasks, promptCalls, modelState} = loadTasksWithStubs({
    savedTasks: [
      {title: 'Uno'},
      {title: 'Dos'},
      {title: 'Tres'}
    ],
    promptAnswers: [{indexes: [1, 3]}]
  });

  await Tasks.remove();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].type, 'checkbox');
  assert.equal(promptCalls[0][0].name, 'indexes');
  assert.deepEqual(promptCalls[0][0].choices.map(choice => choice.value), [1, 2, 3]);
  assert.deepEqual(modelState.list.tasks.map(task => task.title), ['Dos']);
});

test('todo --remove ya no acepta índice directo y siempre pregunta', {concurrency: false}, async () => {
  const {Tasks, promptCalls, modelState} = loadTasksWithStubs({
    savedTasks: [
      {title: 'Uno'},
      {title: 'Dos'}
    ],
    promptAnswers: [{indexes: [2]}]
  });

  await Tasks.remove();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].type, 'checkbox');
  assert.deepEqual(modelState.removeCalls, [2]);
  assert.deepEqual(modelState.list.tasks.map(task => task.title), ['Uno']);
});
