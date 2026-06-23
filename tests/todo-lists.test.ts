require('colors');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const listsModulePath = path.join(repoRoot, 'todos', 'lists.ts');
const promptSelectionModulePath = path.join(repoRoot, 'utils', 'prompt-index-selection.ts');

function loadTodoListsWithStubs({promptAnswers = [], savedLists = [], events}: any = {}) {
  const originalLoad = Module._load;
  const logs = [];
  const promptCalls = [];
  const queuedAnswers = Array.isArray(promptAnswers) ? [...promptAnswers] : [promptAnswers];
  const modelState = {
    lists: savedLists.map((list, index) => ({
      tasks: [],
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
    const isPromptSelectionHelper = parent && parent.filename && parent.filename.endsWith(path.join('utils', 'prompt-index-selection.ts'));

    if (request === '../utils/prompts' || (isPromptSelectionHelper && request === './prompts')) {
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
        findOne(query: any = {}) {
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
