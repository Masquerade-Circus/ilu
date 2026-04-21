require('colors');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const boardListsModulePath = path.join(repoRoot, 'scrumban', 'board-lists.js');
const promptSelectionModulePath = path.join(repoRoot, 'utils', 'prompt-index-selection.js');

const SIMPLE_DEFAULT_COLUMNS = ['Backlog', 'Ready', 'In Progress', 'Done'];

function sanitizeColumnId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildColumns(columns = SIMPLE_DEFAULT_COLUMNS) {
  const usedIds = new Set();

  return columns.map((title) => {
    const trimmedTitle = title.trim();
    const baseId = sanitizeColumnId(trimmedTitle) || 'column';
    let id = baseId;
    let suffix = 2;

    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    usedIds.add(id);

    return {
      id,
      title: trimmedTitle,
      cards: []
    };
  });
}

function createBoard(list = {}) {
  const columns = Array.isArray(list.columns) && list.columns.length > 0
    ? buildColumns(list.columns.map(column => column.title || column))
    : buildColumns();

  return {
    description: '',
    current: false,
    columns,
    defaultColumnId: list.defaultColumnId || columns[0].id,
    ...list,
    columns,
    defaultColumnId: list.defaultColumnId || columns[0].id
  };
}

function loadBoardListsWithStubs({promptAnswers = [], savedBoards = []} = {}) {
  const originalLoad = Module._load;
  const logs = [];
  const promptCalls = [];
  const queuedAnswers = Array.isArray(promptAnswers) ? [...promptAnswers] : [promptAnswers];
  const modelState = {
    boards: savedBoards.map((board, index) => ({
      $id: `board-${index + 1}`,
      index: index + 1,
      ...createBoard(board)
    })),
    addCalls: [],
    saveCalls: [],
    removeCalls: [],
    useCalls: []
  };

  delete require.cache[require.resolve(boardListsModulePath)];
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
        log: Object.assign(
          (message) => logs.push(message),
          {
            info(message) {
              logs.push(message);
            },
            pointerSmall(message) {
              logs.push(message);
            },
            warning(message) {
              logs.push(message);
            },
            cross(message) {
              logs.push(message);
            }
          }
        )
      };
    }

    if (request === './model') {
      return {
        find() {
          return modelState.boards;
        },
        findOne(query = {}) {
          if (Object.prototype.hasOwnProperty.call(query, 'index')) {
            return modelState.boards.find(item => item.index === query.index);
          }

          if (Object.prototype.hasOwnProperty.call(query, 'current')) {
            return modelState.boards.find(item => item.current === query.current);
          }

          return modelState.boards[0];
        },
        getCurrent() {
          return modelState.boards.find(item => item.current);
        },
        getFirst() {
          return modelState.boards[0];
        },
        add(board) {
          modelState.addCalls.push(board);
          const inserted = {
            $id: `board-${modelState.boards.length + 1}`,
            index: modelState.boards.length + 1,
            current: true,
            ...createBoard(board)
          };
          modelState.boards.forEach(item => {
            item.current = false;
          });
          modelState.boards.push(inserted);
          return inserted;
        },
        save(item) {
          modelState.saveCalls.push({index: item.index, title: item.title, description: item.description});
          return item;
        },
        use(id) {
          modelState.useCalls.push(id);
          modelState.boards.forEach(item => {
            item.current = item.$id === id;
          });
        },
        remove(item) {
          modelState.removeCalls.push(item ? item.index : item);

          if (!item) {
            modelState.boards = [];
            return;
          }

          modelState.boards = modelState.boards
            .filter(current => current.$id !== item.$id)
            .map((current, index) => ({...current, index: index + 1}));
        }
      };
    }

    if (request === 'lodash/isUndefined') {
      return value => typeof value === 'undefined';
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const BoardLists = require(boardListsModulePath);
    return {BoardLists, logs, promptCalls, modelState};
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(boardListsModulePath)];
    delete require.cache[require.resolve(promptSelectionModulePath)];
  }
}

test('board-list --add crea un board con set simple default aceptado rápidamente', {concurrency: false}, async () => {
  const {BoardLists, promptCalls, modelState, logs} = loadBoardListsWithStubs({
    promptAnswers: [
      {title: 'Product', description: 'Delivery flow', columns: ''},
      {defaultColumnId: 'backlog'}
    ]
  });

  await BoardLists.add();

  assert.equal(promptCalls.length, 2);
  assert.equal(promptCalls[0][0].name, 'title');
  assert.equal(promptCalls[0][2].name, 'columns');
  assert.equal(promptCalls[1][0].type, 'select');
  assert.deepEqual(modelState.addCalls, [{
    title: 'Product',
    description: 'Delivery flow',
    columns: SIMPLE_DEFAULT_COLUMNS.map(title => ({title})),
    defaultColumnId: 'backlog'
  }]);
  assert.deepEqual(modelState.boards[0].columns.map(column => ({id: column.id, title: column.title})), [
    {id: 'backlog', title: 'Backlog'},
    {id: 'ready', title: 'Ready'},
    {id: 'in-progress', title: 'In Progress'},
    {id: 'done', title: 'Done'}
  ]);
  assert.equal(modelState.boards[0].defaultColumnId, 'backlog');
  assert.ok(logs.some(entry => /Product/.test(entry)));
});

test('board-list --add crea un board con columnas personalizadas y elige columna default', {concurrency: false}, async () => {
  const {BoardLists, promptCalls, modelState} = loadBoardListsWithStubs({
    promptAnswers: [
      {
        title: 'Support',
        description: 'Tickets',
        columns: 'Rejected, Backlog, Needs Info, Ready, In Progress, Review, Done'
      },
      {defaultColumnId: 'ready'}
    ]
  });

  await BoardLists.add();

  assert.equal(promptCalls.length, 2);
  assert.equal(promptCalls[1][0].type, 'select');
  assert.deepEqual(promptCalls[1][0].choices, [
    {name: 'Rejected', value: 'rejected'},
    {name: 'Backlog', value: 'backlog'},
    {name: 'Needs Info', value: 'needs-info'},
    {name: 'Ready', value: 'ready'},
    {name: 'In Progress', value: 'in-progress'},
    {name: 'Review', value: 'review'},
    {name: 'Done', value: 'done'}
  ]);
  assert.deepEqual(modelState.addCalls, [{
    title: 'Support',
    description: 'Tickets',
    columns: [
      {title: 'Rejected'},
      {title: 'Backlog'},
      {title: 'Needs Info'},
      {title: 'Ready'},
      {title: 'In Progress'},
      {title: 'Review'},
      {title: 'Done'}
    ],
    defaultColumnId: 'ready'
  }]);
  assert.deepEqual(modelState.boards[0].columns.map(column => ({id: column.id, title: column.title})), [
    {id: 'rejected', title: 'Rejected'},
    {id: 'backlog', title: 'Backlog'},
    {id: 'needs-info', title: 'Needs Info'},
    {id: 'ready', title: 'Ready'},
    {id: 'in-progress', title: 'In Progress'},
    {id: 'review', title: 'Review'},
    {id: 'done', title: 'Done'}
  ]);
  assert.equal(modelState.boards[0].defaultColumnId, 'ready');
});

test('board-list --details usa selección interactiva como única vía', {concurrency: false}, async () => {
  const {BoardLists, logs, promptCalls} = loadBoardListsWithStubs({
    savedBoards: [
      {title: 'Inbox', description: 'Base'},
      {title: 'Product', description: 'Delivery', columns: [{title: 'Backlog', cards: [{title: 'A'}]}]}
    ],
    promptAnswers: [{index: 2}]
  });

  await BoardLists.details();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].type, 'select');
  assert.ok(logs.some(entry => /Product/.test(entry)));
  assert.ok(logs.some(entry => /Delivery/.test(entry)));
  assert.ok(logs.some(entry => /Backlog/.test(entry)));
});

test('board-list --edit usa selección interactiva como única vía', {concurrency: false}, async () => {
  const {BoardLists, promptCalls, modelState} = loadBoardListsWithStubs({
    savedBoards: [
      {title: 'Inbox', description: 'Base'},
      {title: 'Product', description: 'Delivery'}
    ],
    promptAnswers: [
      {index: 2},
      {title: 'Product 2', description: 'Updated'}
    ]
  });

  await BoardLists.edit();

  assert.equal(promptCalls.length, 2);
  assert.equal(promptCalls[0][0].type, 'select');
  assert.equal(promptCalls[1][0].name, 'title');
  assert.deepEqual(modelState.saveCalls, [
    {index: 2, title: 'Product 2', description: 'Updated'}
  ]);
});

test('board-list --use usa selección interactiva como única vía', {concurrency: false}, async () => {
  const {BoardLists, promptCalls, modelState} = loadBoardListsWithStubs({
    savedBoards: [
      {title: 'Inbox', current: true},
      {title: 'Product'}
    ],
    promptAnswers: [{index: 2}]
  });

  await BoardLists.use();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].type, 'select');
  assert.deepEqual(modelState.useCalls, ['board-2']);
  assert.equal(modelState.boards[1].current, true);
});

test('board-list --remove usa selección interactiva como única vía', {concurrency: false}, async () => {
  const {BoardLists, promptCalls, modelState} = loadBoardListsWithStubs({
    savedBoards: [
      {title: 'Inbox', current: true},
      {title: 'Product'},
      {title: 'Ops'}
    ],
    promptAnswers: [{indexes: [1, 3]}]
  });

  await BoardLists.remove();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].type, 'checkbox');
  assert.deepEqual(modelState.removeCalls, [1, 3]);
  assert.deepEqual(modelState.boards.map(item => item.title), ['Product']);
  assert.deepEqual(modelState.useCalls, ['board-2']);
});
