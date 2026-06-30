import 'colors';
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..');
const boardModulePath = path.join(repoRoot, 'scrumban', 'board.ts');

function createBoardState(overrides: any = {}) {
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

function loadBoardWithStubs({promptAnswers = [], board = createBoardState(), events, moveImpl}: any = {}) {
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
    if (request === '../utils/prompts' || request === '../utils/prompts.ts') {
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

    if (request === '../utils' || request === '../utils/index.ts') {
        return {
          required: () => true,
          log: Object.assign(
            (message, spaces, type, color) => {
              if (events) {
                events.push('log');
              }
              logCalls.push({message, spaces, type, color});
              logs.push(message);
            },
            {
              info(message) {
                if (events) {
                  events.push('log.info');
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
            if (moveImpl) {
              return moveImpl(payload, modelState);
            }
            modelState.moveCalls.push(payload);
          },
          moveMany(payload) {
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

    if (request === './board-renderer' || request === './board-renderer.ts') {
      return () => 'BOARD RENDERER';
    }

    if (request === './board-priority-prompt' || request === './board-priority-prompt.ts') {
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
    const Board = require(boardModulePath).default;
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

test('board --move uses multi-select for one card and destination column search', {concurrency: false}, async () => {
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
      {cardKeys: ['1:1']},
      {columnIndex: 3}
    ]
  });

  await Board.move();

  assert.equal(promptCalls.length, 2);
  assert.equal(promptCalls[0][0].type, 'checkbox');
  assert.equal(promptCalls[0][0].name, 'cardKeys');
  assert.equal(promptCalls[1][0].type, 'search');
  assert.equal(promptCalls[1][0].name, 'columnIndex');
  assert.deepEqual(modelState.moveCalls, [
    {cards: [{fromColumn: 1, fromPosition: 1}], toColumn: 3}
  ]);
});

test('board --move can move several selected cards to the destination column', {concurrency: false}, async () => {
  const {Board, modelState} = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {title: 'Backlog', wipLimit: null, cards: [{title: 'One', description: '', position: 1}]},
        {title: 'Ready', wipLimit: null, cards: [{title: 'Two', description: '', position: 1}]},
        {title: 'In Progress', wipLimit: null, cards: []},
        {title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [
      {cardKeys: ['1:1', '2:1']},
      {columnIndex: 3}
    ]
  });

  await Board.move();

  assert.deepEqual(modelState.moveCalls, [
    {cards: [{fromColumn: 1, fromPosition: 1}, {fromColumn: 2, fromPosition: 1}], toColumn: 3}
  ]);
});

test('board --move sends several cards from the same column in visual order', {concurrency: false}, async () => {
  const {Board, modelState} = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {
          title: 'Backlog',
          wipLimit: null,
          cards: [
            {title: 'One', description: '', position: 1},
            {title: 'Two', description: '', position: 2},
            {title: 'Three', description: '', position: 3}
          ]
        },
        {title: 'Ready', wipLimit: null, cards: []},
        {title: 'In Progress', wipLimit: null, cards: []},
        {title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [
      {cardKeys: ['1:1', '1:3']},
      {columnIndex: 2}
    ]
  });

  await Board.move();

  assert.deepEqual(modelState.moveCalls, [
    {cards: [{fromColumn: 1, fromPosition: 1}, {fromColumn: 1, fromPosition: 3}], toColumn: 2}
  ]);
});

test('board --move delegates one batch move when individual moves would auto-pull unselected cards', {concurrency: false}, async () => {
  const {Board, modelState} = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {
          title: 'Backlog',
          wipLimit: null,
          cards: [
            {title: 'A', description: '', position: 1},
            {title: 'B', description: '', position: 2},
            {title: 'C', description: '', position: 3}
          ]
        },
        {title: 'Ready', wipLimit: null, cards: []},
        {title: 'In Progress', wipLimit: null, cards: []},
        {title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [
      {cardKeys: ['1:1', '1:3']},
      {columnIndex: 3}
    ]
  });

  await Board.move();

  assert.deepEqual(modelState.moveCalls, [
    {cards: [{fromColumn: 1, fromPosition: 1}, {fromColumn: 1, fromPosition: 3}], toColumn: 3}
  ]);
});

test('board --move does not move any selected cards when destination WIP cannot fit all incoming cards', {concurrency: false}, async () => {
  const {Board, logs, modelState} = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {title: 'Backlog', wipLimit: null, cards: [{title: 'One', description: '', position: 1}, {title: 'Two', description: '', position: 2}]},
        {title: 'Ready', wipLimit: 2, cards: [{title: 'Existing', description: '', position: 1}]},
        {title: 'In Progress', wipLimit: null, cards: []},
        {title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [
      {cardKeys: ['1:1', '1:2']},
      {columnIndex: 2}
    ]
  });

  await Board.move();

  assert.deepEqual(modelState.moveCalls, []);
  assert.ok(logs.some(entry => /WIP limit|cannot move/i.test(entry)));
});

test('board --move prevalidates WIP and shows a clear message when destination column already reached its WIP limit', {concurrency: false}, async () => {
  const {Board, logs, promptCalls, modelState} = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {title: 'Backlog', wipLimit: null, cards: [{title: 'Write docs', description: '', position: 1}]},
        {title: 'Ready', wipLimit: 1, cards: [{title: 'Review', description: '', position: 1}]},
        {title: 'In Progress', wipLimit: null, cards: []},
        {title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [
      {cardKeys: ['1:1']},
      {columnIndex: 2}
    ]
  });

  await assert.doesNotReject(() => Board.move());

  assert.equal(promptCalls.length, 2);
  assert.deepEqual(modelState.moveCalls, []);
  assert.ok(logs.some(entry => /WIP limit|l[ií]mite WIP/i.test(entry)));
});

test('board --details uses a searchable card selector', {concurrency: false}, async () => {
  const {Board, promptCalls} = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {title: 'Backlog', wipLimit: null, cards: [{title: 'Write docs', description: '', position: 1}]},
        {title: 'Ready', wipLimit: null, cards: [{title: 'Fix Login', description: '', position: 1}]},
        {title: 'In Progress', wipLimit: null, cards: []},
        {title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [{cardKey: '2:1'}]
  });

  await Board.details();

  assert.equal(promptCalls[0][0].type, 'search');
  assert.ok(promptCalls[0][0].choices.some((choice) => choice.name === '[Ready] 1 Fix Login' && choice.value === '2:1'));
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
  assert.equal(promptCalls[0][0].type, 'search');
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
  assert.equal(promptCalls[0][0].type, 'search');
  assert.equal(promptCalls[0][0].name, 'columnIndex');
  assert.equal(priorityPromptCalls.length, 0);
  assert.deepEqual(modelState.moveCalls, []);
  assert.ok(logs.some(entry => /nothing to reorder|nothing to change|only one card/i.test(entry)));
});

test('board --columns empieza seleccionando columna y acciones globales especiales', {concurrency: false}, async () => {
  const {Board, promptCalls} = loadBoardWithStubs({
    promptAnswers: [
      {selection: 'cancel'}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].type, 'search');
  assert.equal(promptCalls[0][0].name, 'selection');
  assert.deepEqual(
    promptCalls[0][0].choices.map(choice => ({name: choice.name, value: choice.value})),
    [
      {name: 'Backlog', value: 'column:1'},
      {name: 'Ready', value: 'column:2'},
      {name: 'In Progress', value: 'column:3'},
      {name: 'Done', value: 'column:4'},
      {name: '+ Add column', value: 'add-column'},
      {name: '↺ Reset to simple default', value: 'reset-simple-default'},
      {name: 'Cancel', value: 'cancel'}
    ]
  );
});

test('board --columns allows updating a column WIP limit after selecting a column first', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {selection: 'column:2'},
      {action: 'set-wip'},
      {wipLimit: 3}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 3);
  assert.equal(promptCalls[0][0].name, 'selection');
  assert.equal(promptCalls[1][0].name, 'action');
  assert.deepEqual(modelState.columnEditCalls, [
    {index: 2, values: {wipLimit: 3}}
  ]);
});

test('board --columns usa prompt numérico nativo para set-wip', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {selection: 'column:2'},
      {action: 'set-wip'},
      {wipLimit: 5}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls[2][0].type, 'number');
  assert.equal(promptCalls[2][0].min, 0);
  assert.equal(promptCalls[2][0].defaultValue, 2);
  assert.deepEqual(modelState.columnEditCalls, [
    {index: 2, values: {wipLimit: 5}}
  ]);
});

test('board --columns rechaza WIP decimal desde la validación del prompt', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {selection: 'column:2'},
      {action: 'set-wip'},
      {wipLimit: 5}
    ]
  });

  await Board.columns();

  const validate = promptCalls[2][0].validate;

  assert.equal(typeof validate, 'function');
  assert.match(validate(1.5), /whole number|integer/i);
  assert.equal(validate(2), true);
  assert.deepEqual(modelState.columnEditCalls, [
    {index: 2, values: {wipLimit: 5}}
  ]);
});

test('board --columns limpia el WIP cuando set-wip recibe cero', {concurrency: false}, async () => {
  const {Board, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {selection: 'column:2'},
      {action: 'set-wip'},
      {wipLimit: 0}
    ]
  });

  await Board.columns();

  assert.deepEqual(modelState.columnEditCalls, [
    {index: 2, values: {wipLimit: null}}
  ]);
});

test('board --columns oculta make default para la columna que ya es default', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {selection: 'column:1'},
      {action: 'cancel'}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 2);
  assert.deepEqual(promptCalls[1][0].choices.map(choice => choice.value), [
    'rename-column',
    'set-wip',
    'move-right',
    'cancel'
  ]);
  assert.deepEqual(modelState.columnSetDefaultCalls, []);
  assert.deepEqual(modelState.columnReorderCalls, []);
});

test('board --columns allows setting a non-default column as default from its action menu', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {selection: 'column:3'},
      {action: 'make-default'}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 2);
  assert.deepEqual(modelState.columnSetDefaultCalls, [3]);
});

test('board --columns allows renaming a column from its action menu', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {selection: 'column:2'},
      {action: 'rename-column'},
      {title: 'Next Up'}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 3);
  assert.deepEqual(modelState.columnEditCalls, [
    {index: 2, values: {title: 'Next Up'}}
  ]);
});

test('board --columns adds a column from the initial selector special action', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {selection: 'add-column'},
      {title: 'Review'}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 2);
  assert.deepEqual(modelState.columnAddCalls, [{title: 'Review'}]);
});

test('board --columns moves a middle column left from its action menu', {concurrency: false}, async () => {
  const {Board, promptCalls, modelState} = loadBoardWithStubs({
    promptAnswers: [
      {selection: 'column:3'},
      {action: 'move-left'}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 2);
  assert.deepEqual(modelState.columnReorderCalls, [{fromIndex: 3, toIndex: 2}]);
});

test('board --columns oculta move left para la primera columna y move right para la última', {concurrency: false}, async () => {
  const firstColumn = loadBoardWithStubs({
    promptAnswers: [
      {selection: 'column:1'},
      {action: 'cancel'}
    ]
  });

  await firstColumn.Board.columns();

  assert.doesNotMatch(firstColumn.promptCalls[1][0].choices.map(choice => choice.value).join(','), /move-left/);

  const lastColumn = loadBoardWithStubs({
    promptAnswers: [
      {selection: 'column:4'},
      {action: 'cancel'}
    ]
  });

  await lastColumn.Board.columns();

  assert.doesNotMatch(lastColumn.promptCalls[1][0].choices.map(choice => choice.value).join(','), /move-right/);
});

test('board --columns removes an empty non-default column from its action menu', {concurrency: false}, async () => {
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
      {selection: 'column:3'},
      {action: 'remove-column'}
    ]
  });

  await Board.columns();

  assert.equal(promptCalls.length, 2);
  assert.deepEqual(modelState.columnRemoveCalls, [3]);
});

test('board --columns oculta remove cuando la columna es default o tiene cards', {concurrency: false}, async () => {
  const defaultColumn = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {id: 'backlog', title: 'Backlog', wipLimit: null, cards: []},
        {id: 'ready', title: 'Ready', wipLimit: 2, cards: []},
        {id: 'in-progress', title: 'In Progress', wipLimit: null, cards: []},
        {id: 'done', title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [
      {selection: 'column:1'},
      {action: 'cancel'}
    ]
  });

  await defaultColumn.Board.columns();

  assert.doesNotMatch(defaultColumn.promptCalls[1][0].choices.map(choice => choice.value).join(','), /remove-column/);

  const busyColumn = loadBoardWithStubs({
    board: createBoardState({
      columns: [
        {id: 'backlog', title: 'Backlog', wipLimit: null, cards: []},
        {id: 'ready', title: 'Ready', wipLimit: 2, cards: [{title: 'Two', description: '', position: 1}]},
        {id: 'in-progress', title: 'In Progress', wipLimit: null, cards: []},
        {id: 'done', title: 'Done', wipLimit: null, cards: []}
      ]
    }),
    promptAnswers: [
      {selection: 'column:2'},
      {action: 'cancel'}
    ]
  });

  await busyColumn.Board.columns();

  assert.doesNotMatch(busyColumn.promptCalls[1][0].choices.map(choice => choice.value).join(','), /remove-column/);
});

test('board --columns resets to simple default from the initial selector special action when the board has no cards', {concurrency: false}, async () => {
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
      {selection: 'reset-simple-default'}
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
      {selection: 'reset-simple-default'}
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
      {selection: 'cancel'}
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

test('board --show no limpia la terminal antes de renderizar el board renderer y no pide acciones posteriores', {concurrency: false}, async () => {
  const events = [];
  const {Board, logs, logCalls, promptCalls} = loadBoardWithStubs({events});
  const originalConsoleClear = console.clear;

  console.clear = () => {
    events.push('clear');
  };

  try {
    await Board.show();
  } finally {
    console.clear = originalConsoleClear;
  }

  assert.deepEqual(events, ['log']);
  assert.ok(logs.includes(`\nBoard: ${'Product'.cyan}\nBOARD RENDERER\n`));
  assert.deepEqual(logCalls[0], {
    message: `\nBoard: ${'Product'.cyan}\nBOARD RENDERER\n`,
    spaces: 0,
    type: undefined,
    color: undefined
  });
  assert.equal(promptCalls.length, 0);
});

test('board actions enruta gestión de boards a BoardLists con las nuevas flags públicas', {concurrency: false}, async () => {
  const originalLoad = Module._load;
  const calls = [];

  delete require.cache[require.resolve(boardModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './board-lists') {
      return {
        show() {
          calls.push('show');
        },
        use() {
          calls.push('use');
        },
        add() {
          calls.push('add');
        },
        edit() {
          calls.push('edit');
        },
        remove() {
          calls.push('remove');
        }
      };
    }

    if (request === '../utils/prompts') {
      return {prompt: async () => ({})};
    }

    if (request === '../utils') {
      return {required: () => true, log: Object.assign(() => {}, {info() {}, cross() {}})};
    }

    if (request === './model') {
      return {
        getCurrent() {
          return createBoardState();
        },
        cards: {add() {}, edit() {}, remove() {}, move() {}},
        columns: {add() {}, edit() {}, setDefault() {}, reorder() {}, remove() {}, resetSimpleDefault() {}}
      };
    }

    if (request === './board-renderer') {
      return () => 'BOARD RENDERER';
    }

    if (request === './board-priority-prompt') {
      return async () => ({fromPosition: 1, toPosition: 1});
    }

    if (request === 'lodash/isUndefined') {
      return value => typeof value === 'undefined';
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const Board = require(boardModulePath);

    await Board.actions([], {listBoards: true});
    await Board.actions([], {useBoard: true});
    await Board.actions([], {addBoard: true});
    await Board.actions([], {editBoard: true});
    await Board.actions([], {removeBoard: true});
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(boardModulePath)];
  }

  assert.deepEqual(calls, ['show', 'use', 'add', 'edit', 'remove']);
});
