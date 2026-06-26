const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const readModelPath = path.join(repoRoot, 'ui', 'read-model.ts');

function failMutator(name) {
  return () => {
    throw new Error(`mutator ${name} should not be called`);
  };
}

function listModel({current, first}: any) {
  return {
    getCurrent() {
      return current;
    },
    getFirst() {
      return first;
    },
    add: failMutator('add'),
    save: failMutator('save'),
    remove: failMutator('remove'),
    use: failMutator('use'),
    tasks: {add: failMutator('tasks.add')},
    notes: {add: failMutator('notes.add')}
  };
}

function buildModels(overrides: any = {}) {
  return {
    todos: listModel({
      current: {
        title: 'Today',
        tasks: [
          {title: 'Ship read view', done: false},
          {title: 'Review output', done: true},
          {title: 'Keep scope small', done: false},
          {title: 'Leave forms alone', done: false}
        ]
      }
    }),
    notes: listModel({
      current: {
        title: 'Research',
        notes: [
          {title: 'Threat model', description: 'Check read-only paths'},
          {title: 'CLI notes'}
        ]
      }
    }),
    boards: {
      getCurrent() {
        return {
          title: 'Launch board',
          columns: [
            {title: 'Backlog', cards: [{title: 'Write tests'}, {title: 'Wire UI'}]},
            {title: 'Done', cards: [{title: 'Smoke'}]}
          ]
        };
      },
      getFirst() {
        throw new Error('first board should not be needed');
      },
      add: failMutator('board.add'),
      save: failMutator('board.save'),
      remove: failMutator('board.remove'),
      use: failMutator('board.use'),
      columns: {add: failMutator('columns.add')},
      cards: {add: failMutator('cards.add')}
    },
    clocks: {
      find() {
        return [
          {name: 'Mexico City', timezone: 'America/Mexico_City'},
          {name: 'UTC', timezone: 'UTC'}
        ];
      },
      add: failMutator('clock.add'),
      remove: failMutator('clock.remove'),
      move: failMutator('clock.move')
    },
    ...overrides
  };
}

test('buildReadSnapshot lee datos actuales de todo, notes, board y clocks sin mutar', () => {
  const {buildReadSnapshot} = require(readModelPath);

  const snapshot = buildReadSnapshot({
    models: buildModels(),
    now: new Date('2026-06-02T12:00:00Z'),
    limit: 3
  });

  assert.equal(snapshot.todo.title, 'Today');
  assert.deepEqual(snapshot.todo.items.map(item => item.text), ['Ship read view', 'Review output', 'Keep scope small', 'Leave forms alone']);
  assert.equal(snapshot.todo.remaining, 0);
  assert.equal(snapshot.todo.items[1].done, true);
  assert.equal(snapshot.notes.title, 'Research');
  assert.deepEqual(snapshot.notes.items.map(item => item.text), ['Threat model', 'CLI notes']);
  assert.equal(snapshot.board.title, 'Launch board');
  assert.deepEqual(snapshot.board.columns.map(column => column.title), ['Backlog', 'Done']);
  assert.equal(snapshot.board.columns[0].cards[0].title, 'Write tests');
  assert.equal(snapshot.board.totalCards, 3);
  assert.equal(snapshot.clocks.items.length, 2);
  assert.match(snapshot.clocks.items[0].time, /\d/);
});


test('buildReadSnapshot formatea clocks como HH:MM:SS deterministico sin AM/PM', () => {
  const script = `
    const {buildReadSnapshot} = require(${JSON.stringify(readModelPath)});
    const noop = () => { throw new Error('mutator should not be called'); };
    const emptyList = {getCurrent: () => null, getFirst: () => null, add: noop, save: noop, remove: noop, use: noop, tasks: {add: noop}, notes: {add: noop}};
    const snapshot = buildReadSnapshot({
      now: new Date('2026-06-02T12:34:56Z'),
      models: {
        todos: emptyList,
        notes: emptyList,
        boards: {getCurrent: () => null, getFirst: () => null},
        clocks: {find: () => [{name: 'UTC', timezone: 'UTC'}]}
      }
    });
    process.stdout.write(JSON.stringify(snapshot.clocks.items[0]));
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: repoRoot,
    env: {...process.env, LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8'},
    encoding: 'utf8'
  });
  const clock = JSON.parse(output);

  assert.deepEqual(clock, {name: 'UTC', timezone: 'UTC', position: 1, time: '12:34:56'});
  assert.match(clock.time, /^\d{2}:\d{2}:\d{2}$/);
  assert.doesNotMatch(clock.time, /AM|PM/i);
});

test('buildReadSnapshot usa primera lista o board cuando no hay actual', () => {
  const {buildReadSnapshot} = require(readModelPath);

  const snapshot = buildReadSnapshot({
    models: buildModels({
      todos: listModel({current: null, first: {title: 'Inbox', tasks: [{title: 'Fallback task'}]}}),
      notes: listModel({current: undefined, first: {title: 'Scratch', notes: [{title: 'Fallback note'}]}}),
      boards: {
        getCurrent() {
          return null;
        },
        getFirst() {
          return {title: 'First board', columns: [{title: 'Queue', cards: [{title: 'Queued card'}]}]};
        }
      }
    })
  });

  assert.equal(snapshot.todo.title, 'Inbox');
  assert.equal(snapshot.todo.items[0].text, 'Fallback task');
  assert.equal(snapshot.notes.title, 'Scratch');
  assert.equal(snapshot.notes.items[0].text, 'Fallback note');
  assert.equal(snapshot.board.title, 'First board');
  assert.equal(snapshot.board.columns[0].cards[0].title, 'Queued card');
});

test('buildReadSnapshot normaliza datos ausentes a estados vacios seguros', () => {
  const {buildReadSnapshot} = require(readModelPath);

  const snapshot = buildReadSnapshot({
    models: {
      todos: listModel({current: null, first: null}),
      notes: listModel({current: null, first: null}),
      boards: {getCurrent: () => null, getFirst: () => null},
      clocks: {find: () => []}
    }
  });

  assert.equal(snapshot.todo.title, 'No todo list yet');
  assert.deepEqual(snapshot.todo.items, []);
  assert.equal(snapshot.notes.title, 'No notes list yet');
  assert.deepEqual(snapshot.notes.items, []);
  assert.equal(snapshot.board.title, 'No board yet');
  assert.deepEqual(snapshot.board.columns, []);
  assert.deepEqual(snapshot.clocks.items, []);
});

test('buildReadSnapshot reporta errores por panel sin romper toda la pantalla', () => {
  const {buildReadSnapshot} = require(readModelPath);

  const snapshot = buildReadSnapshot({
    models: buildModels({
      todos: {getCurrent: () => { throw new Error('db exploded'); }},
      clocks: {find: () => [{name: 'Broken clock', timezone: 'Invalid/Zone'}]}
    }),
    now: new Date('2026-06-02T12:00:00Z')
  });

  assert.equal(snapshot.todo.error, 'Todo is unavailable right now.');
  assert.equal(snapshot.notes.title, 'Research');
  assert.equal(snapshot.clocks.items[0].name, 'Broken clock');
  assert.equal(snapshot.clocks.items[0].time, 'Time unavailable');
});


test('buildReadSnapshot exposes board column indexes and card positions for click selection', () => {
  const {buildReadSnapshot} = require(readModelPath);

  const snapshot = buildReadSnapshot({models: buildModels(), limit: 3});

  assert.deepEqual(snapshot.board.columns.map(column => column.index), [1, 2]);
  assert.deepEqual(snapshot.board.columns[0].cards[0], {
    title: 'Write tests',
    description: '',
    position: 1
  });
  assert.deepEqual(snapshot.board.columns[0].cards[1], {
    title: 'Wire UI',
    description: '',
    position: 2
  });
});

test('buildReadSnapshot exposes board WIP limits for Board headers', () => {
  const {buildReadSnapshot} = require(readModelPath);

  const snapshot = buildReadSnapshot({
    models: buildModels({
      boards: {
        getCurrent() {
          return {
            title: 'Launch board',
            columns: [
              {title: 'Backlog', wipLimit: 3, cards: [{title: 'Write tests'}]},
              {title: 'Done', wipLimit: null, cards: [{title: 'Smoke'}]}
            ]
          };
        }
      }
    })
  });

  assert.equal(snapshot.board.columns[0].wipLimit, 3);
  assert.equal(snapshot.board.columns[1].wipLimit, null);
});


test('buildReadSnapshot expone todas las columnas y cards del board visual sin marcadores restantes', () => {
  const {buildReadSnapshot} = require(readModelPath);
  const cards = Array.from({length: 6}, (_, index) => ({title: `Card ${index + 1}`}));
  const columns = Array.from({length: 6}, (_, index) => ({
    title: `Column ${index + 1}`,
    cards: index === 0 ? cards : [{title: `Only ${index + 1}`}]
  }));

  const snapshot = buildReadSnapshot({
    models: buildModels({
      boards: {
        getCurrent() {
          return {title: 'Release board', columns};
        },
        getFirst() {
          throw new Error('first board should not be needed');
        }
      }
    })
  });

  assert.equal(snapshot.board.columns.length, 6);
  assert.equal(snapshot.board.remainingColumns, 0);
  assert.equal(snapshot.board.columns[0].cards.length, 6);
  assert.equal(snapshot.board.columns[0].remaining, 0);
  assert.deepEqual(snapshot.board.columns[0].cards.map(card => card.title), cards.map(card => card.title));
});


test('buildReadSnapshot conserva ids numericos reales de boards de iludb', () => {
  const {buildReadSnapshot} = require(readModelPath);
  const boards = [
    {$id: 1, title: 'Launch board', current: true, columns: [{title: 'Backlog', cards: []}]},
    {$id: 2, title: 'Ops board', current: false, columns: [{title: 'Queue', cards: []}]}
  ];

  const snapshot = buildReadSnapshot({
    models: buildModels({
      boards: {
        getCurrent() {
          return boards[0];
        },
        getFirst() {
          return boards[0];
        },
        find() {
          return boards;
        }
      }
    })
  });

  assert.equal(snapshot.board.id, 1);
  assert.deepEqual(snapshot.board.boards, [
    {id: 1, title: 'Launch board', current: true},
    {id: 2, title: 'Ops board', current: false}
  ]);
});

test('buildReadSnapshot preserves real note content and object label titles', () => {
  const {buildReadSnapshot} = require(readModelPath);

  const snapshot = buildReadSnapshot({
    models: buildModels({
      todos: listModel({
        current: {
          title: 'Today',
          tasks: [
            {title: 'Tagged task', labels: [{title: 'urgent', color: 'red'}, {title: ' ui '}, {title: ''}, null, 'loose']}
          ]
        }
      }),
      notes: listModel({
        current: {
          title: 'Research',
          notes: [
            {title: 'Threat model', content: 'Actual note body', description: '', labels: [{title: 'sec', color: 'blue'}, {title: ' audit '}, 'raw']}
          ]
        }
      })
    })
  });

  assert.equal(snapshot.notes.items[0].description, 'Actual note body');
  assert.deepEqual(snapshot.notes.items[0].labels, ['sec', 'audit', 'raw']);
  assert.deepEqual(snapshot.todo.items[0].labels, ['urgent', 'ui', 'loose']);
});

test('buildReadSnapshot exposes all todo and note items instead of truncating at default limit', () => {
  const {buildReadSnapshot} = require(readModelPath);
  const tasks = Array.from({length: 6}, (_, index) => ({title: `Task ${index + 1}`}));
  const notes = Array.from({length: 6}, (_, index) => ({title: `Note ${index + 1}`, content: `Body ${index + 1}`}));

  const snapshot = buildReadSnapshot({
    models: buildModels({
      todos: listModel({current: {title: 'Today', tasks}}),
      notes: listModel({current: {title: 'Research', notes}})
    })
  });

  assert.deepEqual(snapshot.todo.items.map(item => item.text), tasks.map(task => task.title));
  assert.equal(snapshot.todo.remaining, 0);
  assert.deepEqual(snapshot.notes.items.map(item => item.text), notes.map(note => note.title));
  assert.equal(snapshot.notes.remaining, 0);
});

test('buildReadSnapshot exposes board descriptions and default column metadata for Board management UI', () => {
  const {buildReadSnapshot} = require(readModelPath);
  const boards = [
    {
      $id: 1,
      title: 'Launch board',
      description: 'Ship flow',
      current: true,
      defaultColumnId: 'doing',
      columns: [
        {id: 'backlog', title: 'Backlog', cards: []},
        {id: 'doing', title: 'Doing', cards: [], wipLimit: 2}
      ]
    },
    {$id: 2, title: 'Ops board', description: 'Ops flow', current: false, columns: []}
  ];

  const snapshot = buildReadSnapshot({
    models: buildModels({
      boards: {
        getCurrent() {
          return boards[0];
        },
        getFirst() {
          return boards[0];
        },
        find() {
          return boards;
        },
        add: failMutator('board.add'),
        save: failMutator('board.save'),
        remove: failMutator('board.remove'),
        use: failMutator('board.use')
      }
    })
  });

  assert.equal(snapshot.board.defaultColumnId, 'doing');
  assert.deepEqual(snapshot.board.boards, [
    {id: 1, title: 'Launch board', description: 'Ship flow', current: true},
    {id: 2, title: 'Ops board', description: 'Ops flow', current: false}
  ]);
  assert.equal(snapshot.board.columns[0].id, 'backlog');
  assert.equal(snapshot.board.columns[0].isDefault, false);
  assert.equal(snapshot.board.columns[1].id, 'doing');
  assert.equal(snapshot.board.columns[1].isDefault, true);
  assert.equal(snapshot.board.columns[1].wipLimit, 2);
});

test('buildReadSnapshot preserves null current ids when source records have no stable ids', () => {
  const {buildReadSnapshot} = require(readModelPath);
  const board = {
    title: 'Imported board',
    description: 'Needs id repair',
    current: true,
    columns: [{title: 'Backlog', cards: [{title: 'Recovered card'}]}]
  };

  const snapshot = buildReadSnapshot({
    models: buildModels({
      todos: listModel({current: {title: 'Imported todos', tasks: [{title: 'Recovered task'}]}}),
      notes: listModel({current: {title: 'Imported notes', notes: [{title: 'Recovered note'}]}}),
      boards: {
        getCurrent() {
          return board;
        },
        getFirst() {
          return board;
        },
        find() {
          return [board];
        }
      }
    })
  });

  assert.equal(snapshot.todo.currentListId, null);
  assert.equal(snapshot.notes.currentListId, null);
  assert.deepEqual(snapshot.todo.lists, [{id: null, title: 'Imported todos', current: true}]);
  assert.deepEqual(snapshot.notes.lists, [{id: null, title: 'Imported notes', current: true}]);
  assert.equal(snapshot.board.id, null);
  assert.deepEqual(snapshot.board.boards, [
    {id: null, title: 'Imported board', description: 'Needs id repair', current: true}
  ]);
  assert.equal(snapshot.todo.items[0].text, 'Recovered task');
  assert.equal(snapshot.notes.items[0].text, 'Recovered note');
  assert.equal(snapshot.board.columns[0].cards[0].title, 'Recovered card');
});

test('buildReadSnapshot exposes all clocks for Clocks page management without footer truncation markers', () => {
  const {buildReadSnapshot} = require(readModelPath);
  const clocks = Array.from({length: 6}, (_, index) => ({name: `Clock ${index + 1}`, timezone: 'Etc/UTC'}));

  const snapshot = buildReadSnapshot({
    models: buildModels({
      clocks: {
        find() {
          return clocks;
        },
        add: failMutator('clock.add'),
        remove: failMutator('clock.remove'),
        move: failMutator('clock.move')
      }
    }),
    now: new Date('2026-06-02T12:00:00Z')
  });

  assert.deepEqual(snapshot.clocks.items.map(item => item.name), clocks.map(clock => clock.name));
  assert.deepEqual(snapshot.clocks.items.map(item => item.position), [1, 2, 3, 4, 5, 6]);
  assert.equal(snapshot.clocks.remaining, 0);
});
