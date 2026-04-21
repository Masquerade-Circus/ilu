require('colors');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const boardModulePath = path.join(repoRoot, 'scrumban', 'board.js');

function createBoardState(overrides = {}) {
  return {
    title: 'Product',
    description: 'Delivery flow',
    defaultColumnId: 'backlog',
    columns: [
      {id: 'backlog', title: 'Backlog', wipLimit: null, cards: []},
      {id: 'ready', title: 'Ready', wipLimit: 2, cards: []},
      {id: 'in-progress', title: 'In Progress', wipLimit: null, cards: []},
      {id: 'done', title: 'Done', wipLimit: null, cards: []}
    ],
    ...overrides
  };
}

function loadBoardWithStubs({promptAnswers = [], board = createBoardState()} = {}) {
  const originalLoad = Module._load;
  const logs = [];
  const logCalls = [];
  const promptCalls = [];
  const queuedAnswers = Array.isArray(promptAnswers) ? [...promptAnswers] : [promptAnswers];
  const modelState = {
    board,
    addCalls: [],
    editCalls: [],
    removeCalls: [],
    moveCalls: [],
    columnEditCalls: [],
    columnAddCalls: [],
    columnSetDefaultCalls: [],
    columnReorderCalls: [],
    columnRemoveCalls: [],
    columnResetCalls: []
  };
  const priorityPromptCalls = [];

  delete require.cache[require.resolve(boardModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../utils/inquirer') {
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

    if (request === '../utils') {
      return {
        required: () => true,
        log: Object.assign(
          (message, spaces, type, color) => {
            logCalls.push({message, spaces, type, color});
            logs.push(message);
          },
          {
            info(message) {
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
        getCurrent() {
          return modelState.board;
        },
        cards: {
          add(values, options) {
            modelState.addCalls.push({values, options});
          },
          edit(payload) {
            modelState.editCalls.push(payload);
          },
          remove(payload) {
            modelState.removeCalls.push(payload);
          },
          move(payload) {
            modelState.moveCalls.push(payload);
          }
        },
        columns: {
          add(values) {
            modelState.columnAddCalls.push(values);
          },
          edit(index, values) {
            modelState.columnEditCalls.push({index, values});
          },
          setDefault(index) {
            modelState.columnSetDefaultCalls.push(index);
          },
          reorder(payload) {
            modelState.columnReorderCalls.push(payload);
          },
          remove(index) {
            modelState.columnRemoveCalls.push(index);
          },
          resetSimpleDefault() {
            modelState.columnResetCalls.push(true);
          }
        }
      };
    }

    if (request === './ascii-board') {
      return () => 'ASCII BOARD';
    }

    if (request === './board-priority-prompt') {
      return async (options) => {
        priorityPromptCalls.push(options);

        if (queuedAnswers.length === 0) {
          throw new Error('No prompt answers left');
        }

        return queuedAnswers.shift();
      };
    }

    if (request === 'lodash/isUndefined') {
      return value => typeof value === 'undefined';
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const Board = require(boardModulePath);
    return {Board, logs, logCalls, promptCalls, priorityPromptCalls, modelState};
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(boardModulePath)];
  }
}

test('board --add creates a card in the default column', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    board: createBoardState({
      defaultColumnId: 'ready'
    }),
    promptAnswers: [{title: 'Write docs', description: 'v1'}]
  });

  await Board.add();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].name, 'title');
  assert.deepEqual(modelState.addCalls, [
    {values: {title: 'Write docs', description: 'v1'}, options: undefined}
  ]);
});

test('board --move uses prompt-first selection for card and destination column', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {title: 'Backlog', wipLimit: null, cards: [{title: 'Write docs', description: '', position: 1}]},
        {title: 'Ready', wipLimit: 2, cards: []},
        {title: 'In Progress', wipLimit: null, cards: []},
        {title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [
      {cardKey: '1:1'},
      {columnIndex: 3}
    ]
  });

  await Board.move();

  assert.equal(promptCalls.length, 2);
  assert.equal(promptCalls[0][0].name, 'cardKey');
  assert.equal(promptCalls[1][0].name, 'columnIndex');
  assert.deepEqual(modelState.moveCalls, [
    {fromColumn: 1, fromPosition: 1, toColumn: 3, toPosition: 1}
  ]);
});

test('board --priority selecciona columna primero y reordena dentro de esa misma columna usando prompt custom', {concurrency: false}, async () => {
  const {Board, promptCalls, priorityPromptCalls, modelState} = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {
          id: 'backlog',
          title: 'Backlog',
          wipLimit: null,
          cards: [
            {title: 'One', description: '', position: 1},
            {title: 'Two', description: '', position: 2},
            {title: 'Three', description: '', position: 3}
          ]
        },
        {id: 'ready', title: 'Ready', wipLimit: 2, cards: []},
        {id: 'in-progress', title: 'In Progress', wipLimit: null, cards: []},
        {id: 'done', title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [
      {columnIndex: 1},
      {fromPosition: 1, toPosition: 2}
    ]
  });

  await Board.priority();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].name, 'columnIndex');
  assert.equal(priorityPromptCalls.length, 1);
  assert.deepEqual(priorityPromptCalls[0], {
    columnTitle: 'Backlog',
    cards: [
      {title: 'One', description: '', position: 1},
      {title: 'Two', description: '', position: 2},
      {title: 'Three', description: '', position: 3}
    ]
  });
  assert.deepEqual(modelState.moveCalls, [
    {fromColumn: 1, fromPosition: 1, toColumn: 1, toPosition: 2}
  ]);
});

test('board --priority no abre reorder cuando la columna elegida tiene menos de dos cards', {concurrency: false}, async () => {
  const {Board, logs, promptCalls, priorityPromptCalls, modelState} = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {
          id: 'backlog',
          title: 'Backlog',
          wipLimit: null,
          cards: [{title: 'Only', description: '', position: 1}]
        },
        {id: 'ready', title: 'Ready', wipLimit: 2, cards: []},
        {id: 'in-progress', title: 'In Progress', wipLimit: null, cards: []},
        {id: 'done', title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [
      {columnIndex: 1}
    ]
  });

  await Board.priority();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].name, 'columnIndex');
  assert.equal(priorityPromptCalls.length, 0);
  assert.deepEqual(modelState.moveCalls, []);
  assert.ok(logs.some(entry => /nothing to reorder|nothing to change|only one card/i.test(entry)));
});

test('board --columns allows updating a column WIP limit interactively', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {action: 'set-wip'},
      {columnIndex: 2},
      {wipLimit: '3'}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 3);
  assert.equal(promptCalls[0][0].name, 'action');
  assert.deepEqual(modelState.columnEditCalls, [
    {index: 2, values: {wipLimit: 3}}
  ]);
});

test('board --columns valida que set-wip solo acepte vacío o enteros mayores o iguales a 1', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {action: 'set-wip'},
      {columnIndex: 2},
      {wipLimit: '5'}
    ]
  });

  await Board.columns();

  const validate = promptCalls[2][0].validate;

  assert.equal(typeof validate, 'function');
  assert.equal(validate(''), true);
  assert.equal(validate('  '), true);
  assert.equal(validate('1'), true);
  assert.equal(validate('12'), true);
  assert.match(validate('abc'), /valid integer greater than or equal to 1/i);
  assert.match(validate('0'), /valid integer greater than or equal to 1/i);
  assert.match(validate('-1'), /valid integer greater than or equal to 1/i);
  assert.match(validate('1.5'), /valid integer greater than or equal to 1/i);
  assert.deepEqual(modelState.columnEditCalls, [
    {index: 2, values: {wipLimit: 5}}
  ]);
});

test('board --columns limpia el WIP cuando set-wip recibe vacío', {concurrency: false}, async () => {
  const {Board, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {action: 'set-wip'},
      {columnIndex: 2},
      {wipLimit: '   '}
    ]
  });

  await Board.columns();

  assert.deepEqual(modelState.columnEditCalls, [
    {index: 2, values: {wipLimit: null}}
  ]);
});

test('board --columns allows setting the default column interactively', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {action: 'set-default'},
      {columnIndex: 3}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 2);
  assert.deepEqual(modelState.columnSetDefaultCalls, [3]);
});

test('board --columns allows renaming a column interactively', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {action: 'rename-column'},
      {columnIndex: 2},
      {title: 'Next Up'}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 3);
  assert.deepEqual(modelState.columnEditCalls, [
    {index: 2, values: {title: 'Next Up'}}
  ]);
});

test('board --columns allows adding a column interactively', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {action: 'add-column'},
      {title: 'Review'}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 2);
  assert.deepEqual(modelState.columnAddCalls, [{title: 'Review'}]);
});

test('board --columns allows reordering columns interactively', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {action: 'reorder-columns'},
      {fromIndex: 4},
      {toIndex: 2}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 3);
  assert.deepEqual(modelState.columnReorderCalls, [{fromIndex: 4, toIndex: 2}]);
});

test('board --columns removes an empty column interactively', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    board: createBoardState({
      defaultColumnId: 'backlog',
      columns: [
        {id: 'backlog', title: 'Backlog', wipLimit: null, cards: []},
        {id: 'ready', title: 'Ready', wipLimit: 2, cards: []},
        {id: 'review', title: 'Review', wipLimit: null, cards: []},
        {id: 'done', title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [
      {action: 'remove-column'},
      {columnIndex: 3}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 2);
  assert.deepEqual(modelState.columnRemoveCalls, [3]);
});

test('board --columns blocks removing columns that still have cards', {concurrency: false}, async () => {
  const {Board, logs, promptCalls, modelState} = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {id: 'backlog', title: 'Backlog', wipLimit: null, cards: [{title: 'One', description: '', position: 1}]},
        {id: 'ready', title: 'Ready', wipLimit: 2, cards: [{title: 'Two', description: '', position: 1}]},
        {id: 'in-progress', title: 'In Progress', wipLimit: null, cards: [{title: 'Three', description: '', position: 1}]},
        {id: 'done', title: 'Done', wipLimit: null, cards: [{title: 'Four', description: '', position: 1}]}
      ]
    }),
    promptAnswers: [
      {action: 'remove-column'}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 1);
  assert.deepEqual(modelState.columnRemoveCalls, []);
  assert.ok(logs.some(entry => /empty column/i.test(entry)));
});

test('board --columns resets to simple default when the board has no cards', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    board: createBoardState({
      defaultColumnId: 'ready',
      columns: [
        {id: 'triage', title: 'Triage', wipLimit: null, cards: []},
        {id: 'ready', title: 'Ready', wipLimit: 2, cards: []},
        {id: 'ship', title: 'Ship', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [
      {action: 'reset-simple-default'}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 1);
  assert.deepEqual(modelState.columnResetCalls, [true]);
});

test('board --columns no resetea a simple default cuando el board sí tiene cards', {concurrency: false}, async () => {
  const {Board, logs, promptCalls, modelState} = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {id: 'backlog', title: 'Backlog', wipLimit: null, cards: [{title: 'One', description: '', position: 1}]},
        {id: 'ready', title: 'Ready', wipLimit: 2, cards: []},
        {id: 'in-progress', title: 'In Progress', wipLimit: null, cards: []},
        {id: 'done', title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [
      {action: 'reset-simple-default'}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 1);
  assert.deepEqual(modelState.columnResetCalls, []);
  assert.ok(logs.some(entry => /cannot reset to the simple default while the board has cards/i.test(entry)));
});

test('board --columns cancel returns without changing columns', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {action: 'cancel'}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 1);
  assert.deepEqual(modelState.columnEditCalls, []);
  assert.deepEqual(modelState.columnAddCalls, []);
  assert.deepEqual(modelState.columnSetDefaultCalls, []);
  assert.deepEqual(modelState.columnReorderCalls, []);
  assert.deepEqual(modelState.columnRemoveCalls, []);
  assert.deepEqual(modelState.columnResetCalls, []);
});

test('board --details usa selección interactiva de card y muestra su contenido', {concurrency: false}, async () => {
  const {Board, logs, promptCalls} = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {title: 'Backlog', wipLimit: null, cards: [{title: 'Write docs', description: 'v1', position: 1}]},
        {title: 'Ready', wipLimit: 2, cards: []},
        {title: 'In Progress', wipLimit: null, cards: []},
        {title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [{cardKey: '1:1'}]
  });

  await Board.details();

  assert.equal(promptCalls.length, 1);
  assert.ok(logs.some(entry => /Write docs/.test(entry)));
  assert.ok(logs.some(entry => /v1/.test(entry)));
});

test('board --edit usa selección interactiva de card y guarda cambios', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {title: 'Backlog', wipLimit: null, cards: [{title: 'Write docs', description: 'v1', position: 1}]},
        {title: 'Ready', wipLimit: 2, cards: []},
        {title: 'In Progress', wipLimit: null, cards: []},
        {title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [
      {cardKey: '1:1'},
      {title: 'Review docs', description: 'v2'}
    ]
  });

  await Board.edit();

  assert.equal(promptCalls.length, 2);
  assert.deepEqual(modelState.editCalls, [
    {columnIndex: 1, position: 1, values: {title: 'Review docs', description: 'v2'}}
  ]);
});

test('board --remove usa selección interactiva múltiple de cards', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {title: 'Backlog', wipLimit: null, cards: [{title: 'One', description: '', position: 1}, {title: 'Two', description: '', position: 2}]},
        {title: 'Ready', wipLimit: 2, cards: [{title: 'Three', description: '', position: 1}]},
        {title: 'In Progress', wipLimit: null, cards: []},
        {title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [{cardKeys: ['1:2', '2:1']}]
  });

  await Board.remove();

  assert.equal(promptCalls.length, 1);
  assert.deepEqual(modelState.removeCalls, [
    {columnIndex: 1, positions: [2]},
    {columnIndex: 2, positions: [1]}
  ]);
});

test('board --show renders ascii board without prompting for next action', {concurrency: false}, async () => {
  const {Board, logs, logCalls, promptCalls} = loadBoardWithStubs();

  await Board.show();

  assert.ok(logs.includes('\nASCII BOARD\n'));
  assert.deepEqual(logCalls[0], {
    message: '\nASCII BOARD\n',
    spaces: 0,
    type: undefined,
    color: undefined
  });
  assert.equal(promptCalls.length, 0);
});

test('board actions default to show without prompting for next action', {concurrency: false}, async () => {
  const {Board, logs, promptCalls} = loadBoardWithStubs();

  await Board.actions([], {});

  assert.ok(logs.includes('\nASCII BOARD\n'));
  assert.equal(promptCalls.length, 0);
});
