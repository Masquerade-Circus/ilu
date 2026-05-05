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
