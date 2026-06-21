const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
process.env.TSX_TSCONFIG_PATH = path.join(repoRoot, 'tsconfig.ui.json');
require('tsx/cjs');

const uiModulePath = path.join(repoRoot, 'ui', 'app.tsx');

function countWord(output, word) {
  const pattern = String.raw`\b${word}\b`;
  const matches = output.match(new RegExp(pattern, 'gi'));
  return matches ? matches.length : 0;
}

function stripAnsi(output) {
  return output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function visibleLines(output) {
  return stripAnsi(output).split(/\r?\n/);
}

function terminalTitles(output) {
  return Array.from(output.matchAll(/\x1b\]0;([^\x07]*)\x07/g), match => match[1]);
}

function scopedOverlayLines(output, markerPattern) {
  const lines = visibleLines(output);
  const markerIndex = lines.findIndex(line => markerPattern.test(line));
  const frameText = lines.join('\n');

  assert.notEqual(markerIndex, -1, 'expected overlay marker ' + markerPattern + ' in:\n' + frameText);

  let startIndex = markerIndex;
  while (startIndex > 0 && !/┌/.test(lines[startIndex])) {
    startIndex -= 1;
  }

  const overlayLeft = lines[startIndex].lastIndexOf('┌');
  assert.notEqual(overlayLeft, -1, 'expected overlay top border for ' + markerPattern + ':\n' + frameText);

  let endIndex = markerIndex;
  while (endIndex < lines.length - 1 && lines[endIndex][overlayLeft] !== '└') {
    endIndex += 1;
  }

  assert.equal(lines[endIndex][overlayLeft], '└', 'expected overlay bottom border for ' + markerPattern + ':\n' + frameText);

  return lines.slice(startIndex, endIndex + 1);
}



function clickVisibleText(session, text, occurrence = 0) {
  const lines = visibleLines(session.output());
  let seen = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(text);

    if (column < 0) {
      continue;
    }

    if (seen === occurrence) {
      session.clickAt(column + 1, index + 1);
      return;
    }

    seen += 1;
  }

  assert.fail(`expected visible text target "${text}" in:
${lines.join('\n')}`);
}


function mousePrimaryPressSequence(x, y) {
  return `\x1b[<0;${x};${y}M`;
}

function mouseDragSequence(x, y) {
  return `\x1b[<32;${x};${y}M`;
}

function mouseWheelDownSequence(x, y) {
  return `\x1b[<65;${x};${y}M`;
}

function pressVisibleText(stdin, session, text, occurrence = 0) {
  const lines = visibleLines(session.output());
  let seen = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(text);

    if (column < 0) {
      continue;
    }

    if (seen === occurrence) {
      stdin.send(mousePrimaryPressSequence(column + 1, index + 1));
      return;
    }

    seen += 1;
  }

  assert.fail(`expected visible text target "${text}" in:
${lines.join('\n')}`);
}

function doublePressVisibleText(stdin, session, text, occurrence = 0) {
  pressVisibleText(stdin, session, text, occurrence);
  pressVisibleText(stdin, session, text, occurrence);
}

function wheelDownVisibleText(stdin, session, text, occurrence = 0) {
  const lines = visibleLines(session.output());
  let seen = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(text);

    if (column < 0) {
      continue;
    }

    if (seen === occurrence) {
      stdin.send(mouseWheelDownSequence(column + 1, index + 1));
      return;
    }

    seen += 1;
  }

  assert.fail(`expected visible wheel target "${text}" in:
${lines.join('\n')}`);
}


function firstVisibleCardTitle(output) {
  const line = visibleLines(output).find(value => /│\s*(?:[›•]\s*)?Card \d+/.test(value));
  const match = line && line.match(/Card \d+/);

  return match ? match[0] : null;
}

function findNodeById(nodes, id) {
  for (const node of nodes || []) {
    if (node.type === 'element' && node.props && node.props.id === id) {
      return node;
    }

    const child = findNodeById(node.children, id);

    if (child) {
      return child;
    }
  }

  return null;
}

function baseSnapshot(overrides = {}) {
  return {
    todo: {title: 'Today', items: [], remaining: 0},
    notes: {title: 'Notes list', items: [], remaining: 0},
    board: {title: 'Board view', columns: [], totalCards: 0},
    clocks: {items: [], remaining: 0},
    ...overrides
  };
}

function richSnapshot() {
  return baseSnapshot({
    todo: {title: 'Today', items: [{text: 'Ship read view', done: false}], remaining: 0},
    notes: {title: 'Research', items: [{text: 'Threat model'}], remaining: 0},
    board: {
      title: 'Launch board',
      totalCards: 2,
      columns: [
        {title: 'Backlog', count: 2, cards: ['Write tests', 'Wire UI']},
        {title: 'Done', count: 0, cards: []}
      ]
    },
    clocks: {items: [{name: 'UTC', time: '12:00'}, {name: 'Mexico City', time: '06:00'}], remaining: 0}
  });
}

function realBoardSnapshot() {
  return baseSnapshot({
    board: {
      title: 'Launch board',
      totalCards: 2,
      columns: [
        {
          index: 1,
          title: 'Backlog',
          count: 2,
          cards: [
            {title: 'Write tests', description: 'Cover the card overlay flows', position: 1},
            {title: 'Wire UI', description: '', position: 2}
          ],
          remaining: 0
        }
      ],
      remainingColumns: 0
    }
  });
}

class FakeStdin extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.rawMode = false;
    this.resumed = false;
    this.paused = false;
  }

  setRawMode(value) {
    this.rawMode = value;
  }

  resume() {
    this.resumed = true;
  }

  pause() {
    this.paused = true;
  }

  send(chunk) {
    this.emit('data', chunk);
  }
}

class FakeStdout extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.columns = 80;
    this.rows = 24;
    this.chunks = [];
  }

  write(chunk) {
    this.chunks.push(String(chunk));
    return true;
  }

  output() {
    return this.chunks.join('');
  }
}



async function loadUiWithPatchedModules(patch, run) {
  const originalLoad = Module._load;
  delete require.cache[require.resolve(uiModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    return patch(request, parent, loaded);
  };

  try {
    const Ui = require(uiModulePath);
    return await run(Ui);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(uiModulePath)];
  }
}

async function loadUiWithSyncHook(syncHook, run) {
  const originalLoad = Module._load;
  delete require.cache[require.resolve(uiModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../sync/ilu-hooks' && parent && parent.filename === uiModulePath) {
      return syncHook;
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const Ui = require(uiModulePath);
    return await run(Ui);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(uiModulePath)];
  }
}

function boardSnapshotModels(board) {
  return {
    todos: {getCurrent: () => ({title: 'Today', tasks: []}), getFirst: () => null},
    notes: {getCurrent: () => ({title: 'Notes', notes: []}), getFirst: () => null},
    boards: {getCurrent: () => board, getFirst: () => null},
    clocks: {find: () => []}
  };
}


test('active editor renders only the active page factory', async () => {
  const counts = {todo: 0, notes: 0, clocks: 0, board: 0};

  await loadUiWithPatchedModules((request, parent, loaded) => {
    if (!parent || parent.filename !== uiModulePath) {
      return loaded;
    }

    if (request === './pages/todos/MainView.tsx') {
      return {...loaded, createTodoMainView(options) { counts.todo += 1; return loaded.createTodoMainView(options); }};
    }

    if (request === './pages/notes/MainView.tsx') {
      return {...loaded, createNotesMainView(options) { counts.notes += 1; return loaded.createNotesMainView(options); }};
    }

    if (request === './pages/clocks/MainView.tsx') {
      return {...loaded, createClocksMainView(options) { counts.clocks += 1; return loaded.createClocksMainView(options); }};
    }

    if (request === './pages/board/MainView.tsx') {
      return {...loaded, createBoardMainView(options) { counts.board += 1; return loaded.createBoardMainView(options); }};
    }

    return loaded;
  }, async (Ui) => {
    const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: realBoardSnapshot()});

    session.click('todo-add-task');
    counts.todo = 0;
    counts.notes = 0;
    counts.clocks = 0;
    counts.board = 0;
    session.focus('todo-add-description');
    session.dispatchText('abc');

    assert.ok(counts.todo > 0, `active Todo view should render while typing, counts=${JSON.stringify(counts)}`);
    assert.equal(counts.notes, 0, `inactive Notes view must not render while typing, counts=${JSON.stringify(counts)}`);
    assert.equal(counts.clocks, 0, `inactive Clocks view must not render while typing, counts=${JSON.stringify(counts)}`);
    assert.equal(counts.board, 0, `inactive Board view must not render while typing, counts=${JSON.stringify(counts)}`);
    session.destroy();
  });
});

test('headless custom key commands render once after the command handler consumes them', async () => {
  let todoRenders = 0;

  await loadUiWithPatchedModules((request, parent, loaded) => {
    if (request === './pages/todos/MainView.tsx' && parent && parent.filename === uiModulePath) {
      return {...loaded, createTodoMainView(options) { todoRenders += 1; return loaded.createTodoMainView(options); }};
    }

    return loaded;
  }, async (Ui) => {
    const session = await Ui.createHeadlessSession({state: {activeTab: 'Notes'}, snapshot: richSnapshot()});

    todoRenders = 0;
    session.dispatchKey('CTRL_1');

    assert.equal(session.state().activeTab, 'Todo');
    assert.equal(todoRenders, 1, `expected one Todo render for one custom command, got ${todoRenders}`);
    session.destroy();
  });
});

test('successful Todo task actions request a scoped todo snapshot refresh', async () => {
  const refreshDomains = [];
  const snapshot = richSnapshot();

  await loadUiWithPatchedModules((request, parent, loaded) => loaded, async (Ui) => {
    const session = await Ui.createHeadlessSession({
      buildSnapshot(domain) {
        refreshDomains.push(domain || 'full');
        return snapshot;
      },
      todoActions: {
        addTask: () => ({ok: true}),
        editTask: () => ({ok: true}),
        markTaskDone: () => ({ok: true}),
        markTaskOpen: () => ({ok: true}),
        removeTask: () => ({ok: true}),
        useList: () => ({ok: true}),
        addList: () => ({ok: true}),
        renameList: () => ({ok: true}),
        removeList: () => ({ok: true})
      }
    });

    session.click('todo-add-task');
    session.focus('todo-add-title');
    session.dispatchText('Scoped');
    refreshDomains.length = 0;
    session.click('todo-add-save');

    assert.deepEqual(refreshDomains, ['todo']);
    session.destroy();
  });
});


test('default Todo task actions refresh only the todo read snapshot domain', async () => {
  let initialSnapshotBuilt = false;
  const calls = [];
  const guardedDomain = name => {
    calls.push(name);

    if (initialSnapshotBuilt) {
      throw new Error(`${name} should not be read during scoped todo refresh`);
    }
  };
  const models = {
    todos: {
      getCurrent() {
        calls.push('todo');
        return {title: 'Today', tasks: [{title: 'Existing task'}]};
      },
      getFirst() {
        throw new Error('todo fallback should not be read');
      }
    },
    notes: {
      getCurrent() {
        guardedDomain('notes');
        return {title: 'Notes', notes: []};
      },
      getFirst() {
        throw new Error('notes fallback should not be read');
      }
    },
    boards: {
      getCurrent() {
        guardedDomain('board');
        return {title: 'Board', columns: []};
      },
      getFirst() {
        throw new Error('board fallback should not be read');
      }
    },
    clocks: {
      find() {
        guardedDomain('clocks');
        return [];
      }
    }
  };

  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    snapshotOptions: {models},
    todoActions: {
      addTask: () => ({ok: true})
    }
  });

  initialSnapshotBuilt = true;
  calls.length = 0;
  session.click('todo-add-task');
  session.focus('todo-add-title');
  session.dispatchText('Scoped');

  assert.doesNotThrow(() => session.click('todo-add-save'));
  assert.deepEqual(calls, ['todo']);
  session.destroy();
});

test('renderSmoke imprime app base con top nav y keymaps sin duplicar titulo', async () => {
  const Ui = require(uiModulePath);

  const output = await Ui.renderSmoke({snapshot: baseSnapshot()});

  assert.equal(countWord(output, 'ilu'), 0);
  assert.match(output, /Todo/);
  assert.match(output, /Notes/);
  assert.match(output, /Board/);
  assert.match(output, /Clocks/);
  assert.match(output, /Ctrl\+C/);
});

test('top nav usa botones themed y estado activo por ANSI, no marcadores ASCII', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({snapshot: richSnapshot()});
  const plain = session.output();
  const ansi = session.ansiOutput();

  assert.doesNotMatch(plain, /Active:/);
  assert.doesNotMatch(plain, /\*/);
  assert.doesNotMatch(plain, /\[\s*(Todo|Notes|Board|Clocks)\s*\]/);
  assert.doesNotMatch(plain, /Board active/i);
  assert.match(ansi, /\x1b\[48;2;49;95;158m\s*Todo\s*\x1b\[49m/);
  assert.match(ansi, /\x1b\[48;2;31;35;40m\s*Notes\s*\x1b\[49m/);
  session.destroy();
});

test('top nav separa apps de Sync global alineado a la derecha', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: richSnapshot()});
  const lines = visibleLines(session.output());
  const navLine = lines.find(line => /Todo/.test(line) && /Notes/.test(line) && /Board/.test(line) && /Clocks/.test(line) && /Translate/.test(line) && /Speech/.test(line) && /Sync/.test(line));

  assert.ok(navLine, `expected full top nav:
${lines.join('\n')}`);
  assert.match(navLine, /Todo.*Notes.*Board.*Clocks.*Translate.*Speech/);
  assert.doesNotMatch(navLine, /Clocks\s+\|\s+Sync\s+Translate/);
  assert.ok(navLine.indexOf('Speech') < navLine.indexOf('Sync'), `expected Sync after app group:
${navLine}`);
  assert.ok(navLine.indexOf('Sync') >= 72, `expected Sync aligned to the right in 80 columns:
${navLine}`);
  assert.equal(navLine.length, 80);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});


test('top nav Sync button reflects sync status without using footer status copy', async () => {
  const Ui = require(uiModulePath);
  const cases = [
    ['idle', 'Sync'],
    ['synced', 'Synced'],
    ['pending', 'Sync pending'],
    ['syncing', 'Syncing...'],
    ['failed', 'Sync failed'],
    ['setup', 'Set up sync']
  ];

  for (const [syncStatus, expectedLabel] of cases) {
    const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {syncStatus}, snapshot: richSnapshot()});
    const lines = visibleLines(session.output());
    const navLine = lines.find(line => /Todo/.test(line) && /Notes/.test(line) && /Board/.test(line) && /Clocks/.test(line) && /Translate/.test(line) && /Speech/.test(line));
    const footer = lines.at(-1);

    assert.ok(navLine, `expected top nav for ${syncStatus}:
${lines.join('\n')}`);
    assert.ok(navLine.includes(expectedLabel), `expected ${expectedLabel} in top nav for ${syncStatus}:
${navLine}`);
    assert.doesNotMatch(footer, /Syncing\.\.\.|Sync pending|Synced|Sync failed|Set up sync/, syncStatus);
    assert.equal(lines.filter(line => line.length > 80).length, 0, `expected 80-column layout for ${syncStatus}:
${lines.join('\n')}`);
    session.destroy();
  }
});


test('createHeadlessSession muestra solo contenido de la vista activa', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({snapshot: richSnapshot()});
  const output = session.output();

  assert.doesNotMatch(output, /^Today$/m);
  assert.match(output, /Ship read view/);
  assert.doesNotMatch(output, /Research/);
  assert.doesNotMatch(output, /Threat model/);
  assert.doesNotMatch(output, /Launch board/);
  assert.doesNotMatch(output, /Write tests/);
  session.destroy();
});

test('footer muestra salida y clocks compactos con nombres y segundos fuera de Clocks', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({snapshot: richSnapshot()});

  try {
    const output = session.output();

    assert.doesNotMatch(output, /\bReady\b|Syncing\.\.\.|Sync pending|Synced|Sync failed|Sync setup needed/);
    assert.match(output, /UTC 12:00:00/);
    assert.match(output, /Mexico City 06:00:00/);
    assert.doesNotMatch(output, /Etc\/UTC|America\/Mexico_City/);
  } finally {
    session.destroy();
  }
});


test('vistas vacias usan copy especifico con acciones visibles de TUI', async () => {
  const Ui = require(uiModulePath);
  const cases = [
    {activeTab: 'Todo', expected: /No tasks yet\. Add a task to get started\./},
    {activeTab: 'Notes', expected: /No notes yet\. Add a note to get started\./},
    {activeTab: 'Clocks', expected: /No clocks yet\. Add a clock to see it here\./},
    {activeTab: 'Board', expected: /No columns yet\. Add a column to get started\./}
  ];

  for (const {activeTab, expected} of cases) {
    const session = await Ui.createHeadlessSession({state: {activeTab}, snapshot: baseSnapshot()});
    const output = session.output();

    assert.match(output, expected, `expected empty copy for ${activeTab}:
${output}`);
    assert.doesNotMatch(output, /todo command|notes command|No columns yet$/m);
    assert.doesNotMatch(output, /Ctrl\+A: Add(?! card)/);
    session.destroy();
  }
});

test('footer respeta 80 columnas con cuatro clocks compactos', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    snapshot: baseSnapshot({
      clocks: {
        items: [
          {name: 'UTC', time: '12:00'},
          {name: 'Mexico City', time: '06:00'},
          {name: 'Madrid', time: '18:00'},
          {name: 'Tokyo', time: '02:00'}
        ],
        remaining: 0
      }
    })
  });

  const lines = visibleLines(session.output());
  const footer = lines.at(-1);

  assert.doesNotMatch(footer, /\bReady\b|Syncing\.\.\.|Sync pending|Synced|Sync failed|Sync setup needed/);
  assert.ok(footer.length <= 80, `expected footer within 80 columns, got ${footer.length}: ${footer}`);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});


test('footerSegments permite padding cero cuando clocks caben exacto en 80 columnas', () => {
  const {footerSegments} = require(path.join(repoRoot, 'ui', 'components', 'Footer.tsx'));
  const exactFitName = 'X'.repeat(43);
  const segments = footerSegments(80, baseSnapshot({
    clocks: {
      items: [{name: exactFitName, time: '12:34:56'}],
      remaining: 0
    }
  }));
  const visibleLength = segments.reduce((total, segment) => total + segment.text.length, 0) + Math.max(0, segments.length - 1) * 2;

  assert.equal(segments[0].text.trimEnd(), 'Ctrl+K: Help  Ctrl+C: Exit');
  assert.equal(visibleLength, 80, `expected exact 80-column footer, got ${visibleLength}: ${segments.map(segment => segment.text).join('  ')}`);
});

test('footerLine no devuelve texto mayor al ancho disponible con cuatro clocks compactos', () => {
  const {footerLine} = require(path.join(repoRoot, 'ui', 'components', 'Footer.tsx'));
  const line = footerLine(80, baseSnapshot({
    clocks: {
      items: [
        {name: 'UTC', time: '12:00'},
        {name: 'Mexico City', time: '06:00'},
        {name: 'Madrid', time: '18:00'},
        {name: 'Tokyo', time: '02:00'}
      ],
      remaining: 0
    }
  }));

  assert.ok(line.length <= 80, `expected footerLine within 80 columns, got ${line.length}: ${line}`);
});

test('footerLine omite errores de clocks que no caben completos en el footer fijo', () => {
  const {footerLine} = require(path.join(repoRoot, 'ui', 'components', 'Footer.tsx'));
  const longClockError = 'Clock provider failed with a verbose diagnostic that cannot fit in the fixed footer safely';
  const line = footerLine(80, baseSnapshot({
    clocks: {
      error: longClockError,
      items: []
    }
  }));

  assert.match(line, /Ctrl\+K: Help  Ctrl\+C: Exit/);
  assert.doesNotMatch(line, /Clock provider failed|verbose diagnostic|fixed footer safely/);
  assert.ok(line.length <= 80, `expected footerLine within 80 columns, got ${line.length}: ${line}`);
});

test('footerLine omite estados de sync porque Sync vive en el top nav global', () => {
  const {footerLine} = require(path.join(repoRoot, 'ui', 'components', 'Footer.tsx'));
  const statuses = ['idle', 'syncing', 'pending', 'synced', 'failed', 'setup'];

  for (const status of statuses) {
    const line = footerLine(80, baseSnapshot({
      clocks: {
        items: [
          {name: 'Local', time: '10:00'},
          {name: 'UTC', time: '16:00'}
        ]
      }
    }), 'Board', status);

    assert.match(line, /Ctrl\+K: Help  Ctrl\+C: Exit/, status);
    assert.doesNotMatch(line, /\bReady\b|Syncing\.\.\.|Sync pending|Synced|Sync failed|Sync setup needed/, status);
    assert.ok(line.length <= 80, `expected footerLine within 80 columns, got ${line.length}: ${line}`);
  }
});

test('Clocks tab muestra nombres completos de relojes', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Clocks'}, snapshot: richSnapshot()});

  assert.match(session.output(), /UTC: 12:00/);
  assert.match(session.output(), /Mexico City: 06:00/);
  session.destroy();
});


test('mountInteractiveSession habilita mouse SGR y cambia tab con input real de stdin', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();

  const session = await Ui.mountInteractiveSession({stdin, stdout, snapshot: richSnapshot()});

  assert.match(stdout.output(), /\x1b\[\?1000h/);
  assert.match(stdout.output(), /\x1b\[\?1006h/);

  stdin.send('\x1b[<0;22;1M');

  assert.match(session.output(), /Launch board/);
  assert.match(session.output(), /Write tests/);
  assert.doesNotMatch(session.output(), /Ship read view/);

  await session.destroy();

  assert.equal(stdin.rawMode, false);
  assert.equal(stdin.paused, true);
});

test('mountInteractiveSession actualiza el título de terminal con la app activa', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();

  const session = await Ui.mountInteractiveSession({stdin, stdout, snapshot: richSnapshot()});

  assert.deepEqual(terminalTitles(stdout.output()), ['Ilu - Todo']);

  session.click('tab-board');
  assert.deepEqual(terminalTitles(stdout.output()).slice(0, 2), ['Ilu - Todo', 'Ilu - Board']);
  assert.notEqual(terminalTitles(stdout.output()).at(-1), 'Ilu - Todo');

  session.click('tab-speech');
  assert.deepEqual(terminalTitles(stdout.output()).slice(0, 3), ['Ilu - Todo', 'Ilu - Board', 'Ilu - Speech']);
  assert.equal(terminalTitles(stdout.output()).at(-1), 'Ilu - Speech');

  await session.destroy();
});



test('createHeadlessSession does not subscribe to sync status updates', async () => {
  const events = [];
  const syncHook = function noopNotifySync() {};
  syncHook.onSyncStatus = () => {
    events.push('subscribe');
    return () => events.push('unsubscribe');
  };

  await loadUiWithSyncHook(syncHook, async (Ui) => {
    const session = await Ui.createHeadlessSession({snapshot: richSnapshot()});
    await session.destroy();
  });

  assert.deepEqual(events, []);
});

test('mountInteractiveSession flushes debounced sync before session cleanup on destroy', async () => {
  const events = [];
  const syncHook = function noopNotifySync() {};
  syncHook.onSyncStatus = () => {
    events.push('subscribe');
    return () => events.push('unsubscribe');
  };
  syncHook.flushPending = async () => {
    events.push('flush-start');
    await Promise.resolve();
    events.push('flush-done');
  };

  await loadUiWithSyncHook(syncHook, async (Ui) => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const session = await Ui.mountInteractiveSession({stdin, stdout, snapshot: richSnapshot()});
    const result = session.destroy();

    if (result && typeof result.then === 'function') {
      await result;
    }

    assert.equal(stdin.rawMode, false);
    assert.equal(stdin.paused, true);
  });

  assert.deepEqual(events, ['subscribe', 'flush-start', 'flush-done', 'unsubscribe']);
});

test('mountInteractiveSession waits for TUI sync client shutdown before terminal cleanup', async () => {
  const events = [];
  const syncHook = function noopNotifySync() {};
  syncHook.onSyncStatus = () => {
    events.push('subscribe');
    return () => events.push('unsubscribe');
  };
  syncHook.flushPending = () => false;
  syncHook.configureSyncRunner = () => {
    events.push('configure-runner');
    return () => events.push('restore-runner');
  };

  await loadUiWithPatchedModules((request, parent, loaded) => {
    if (!parent || parent.filename !== uiModulePath) {
      return loaded;
    }

    if (request === '../sync/ilu-hooks') {
      return syncHook;
    }

    if (request === '../sync') {
      return {
        getSyncConfig() {
          return {enabled: true, autoSync: true, remoteUrl: './remote.git'};
        }
      };
    }

    if (request === '../sync/tui-sync-client') {
      return {
        createTuiSyncClient() {
          events.push('create-client');
          return {
            notifyLocalMutation: async () => ({status: 'healthy', hasPendingRemote: false}),
            shutdown: async () => {
              events.push('shutdown-start');
              await Promise.resolve();
              events.push('shutdown-done');
            },
            dispose: () => events.push('dispose')
          };
        }
      };
    }

    return loaded;
  }, async (Ui) => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const session = await Ui.mountInteractiveSession({stdin, stdout, snapshot: richSnapshot()});
    const result = session.destroy();

    assert.equal(stdin.rawMode, true);

    if (result && typeof result.then === 'function') {
      await result;
    }

    assert.equal(stdin.rawMode, false);
    assert.equal(stdin.paused, true);
  });

  assert.deepEqual(events, [
    'create-client',
    'configure-runner',
    'subscribe',
    'restore-runner',
    'shutdown-start',
    'shutdown-done',
    'unsubscribe'
  ]);
});

test('createHeadlessSession cambia a Board al hacer click en top nav', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({snapshot: richSnapshot()});

  session.click('tab-board');

  assert.equal(session.state().activeTab, 'Board');
  assert.match(session.output(), /Launch board/);
  assert.match(session.output(), /Write tests/);
  assert.doesNotMatch(session.output(), /Ship read view/);
  session.destroy();
});

test('createHeadlessSession cambia a Clocks al hacer click en top nav y muestra nombres completos', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({snapshot: richSnapshot()});

  session.click('tab-clocks');

  assert.equal(session.state().activeTab, 'Clocks');
  assert.match(session.output(), /UTC: 12:00/);
  assert.match(session.output(), /Mexico City: 06:00/);
  session.destroy();
});

test('help overlay muestra Esc como cierre y no presenta Ctrl+C como key de app', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({state: {overlay: 'help'}, snapshot: baseSnapshot()});
  const output = session.output();
  const helpOverlayText = scopedOverlayLines(output, /Todo help/).join('\n');

  assert.match(helpOverlayText, /Esc closes Help\./);
  assert.doesNotMatch(helpOverlayText, /Ctrl\+C/);
  assert.doesNotMatch(helpOverlayText, /Esc\/Ctrl\+C closes this panel\./);
  assert.doesNotMatch(output, /Ctrl\+C closes this panel or exits\./);
  session.destroy();
});

test('help overlay keeps independent app actions on separate lines', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({snapshot: richSnapshot()});

  const cases = [
    ['CTRL_1', 'Todo', /Use Shift\+↑\/↓ to reorder\. Use Actions to manage tasks\./, [/Use Shift\+↑\/↓ to reorder\./, /Use Actions to manage tasks\./]],
    ['CTRL_2', 'Notes', /Use Shift\+↑\/↓ to reorder\. Use Actions to manage notes\./, [/Use Shift\+↑\/↓ to reorder\./, /Use Actions to manage notes\./]],
    ['CTRL_4', 'Clocks', /Use Actions to add, move, or remove clocks\./, [/Use Actions to manage clocks\./]],
    ['CTRL_5', 'Sync', /Use Actions to retry, enable, disable, or set up sync\./, [/Use Actions to manage sync\./]],
    ['CTRL_6', 'Translate', /Use Actions to translate or copy the result\./, [/Use Actions to translate\./, /Use Actions to copy the result\./]],
    ['CTRL_7', 'Speech', /Use Actions to convert text or choose a voice\./, [/Use Actions to convert text\./, /Use Actions to choose a voice\./]]
  ];

  for (const [key, tab, mixedActionsPattern, expectedPatterns] of cases) {
    session.dispatchKey(key);
    session.dispatchKey('CTRL_K');

    const helpOverlayText = scopedOverlayLines(session.output(), new RegExp(`${tab} help`)).join('\n');

    assert.doesNotMatch(helpOverlayText, mixedActionsPattern);
    for (const expectedPattern of expectedPatterns) {
      assert.match(helpOverlayText, expectedPattern);
    }

    session.dispatchKey('CTRL_K');
  }

  session.destroy();
});

test('Ctrl+H no abre help ni se mantiene como alias inseguro', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({snapshot: richSnapshot()});

  session.dispatchKey('CTRL_H');

  assert.equal(session.state().overlay, null);
  assert.doesNotMatch(session.output(), /Todo help/);
  session.destroy();
});

test('Ctrl+K opens contextual help for every app', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({snapshot: richSnapshot()});

  const cases = [
    ['CTRL_1', 'Todo', /Use ↑\/↓ to choose a task\./, /Use Shift\+↑\/↓ to reorder\./],
    ['CTRL_2', 'Notes', /Use ↑\/↓ to choose a note\./, /Use Shift\+↑\/↓ to reorder\./],
    ['CTRL_3', 'Board', /Use ←\/→ to move cards or columns\./, /Use Shift\+↑\/↓ to change priority\./],
    ['CTRL_4', 'Clocks', /Use Actions to manage clocks\./, /Use ↑\/↓ to choose a clock\./],
    ['CTRL_5', 'Sync', /Use Actions to manage sync\./, /Setup asks for the remote, branch, and confirmation\./],
    ['CTRL_6', 'Translate', /Write the text, source, and target\./, /Use Actions to translate\./],
    ['CTRL_7', 'Speech', /Set the input, output, and voice\./, /Use Actions to convert text\./]
  ];

  for (const [key, tab, firstPattern, secondPattern] of cases) {
    session.dispatchKey(key);
    session.dispatchKey('CTRL_K');

    const output = session.output();

    assert.equal(session.state().activeTab, tab);
    assert.equal(session.state().overlay, 'help');
    assert.match(output, new RegExp(`${tab} help`));
    assert.match(output, firstPattern);
    assert.match(output, secondPattern);
    assert.match(output, /Tab moves focus\./);
    assert.match(output, /Enter activates\./);
    assert.match(output, /Esc closes Help\./);
    assert.doesNotMatch(scopedOverlayLines(output, new RegExp(`${tab} help`)).join('\n'), /Ctrl\+C/);

    session.dispatchKey('CTRL_K');
    assert.equal(session.state().overlay, null);
  }

  session.destroy();
});

test('help overlay closes with Esc and Close button without exiting', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({snapshot: richSnapshot()});

  session.dispatchKey('CTRL_K');
  assert.equal(session.state().overlay, 'help');

  session.dispatchKey('ESCAPE');
  assert.equal(session.state().overlay, null);
  assert.equal(session.state().running, true);

  session.dispatchKey('CTRL_K');
  assert.equal(session.state().overlay, 'help');

  session.click('help-close');
  assert.equal(session.state().overlay, null);
  assert.equal(session.state().running, true);

  session.destroy();
});

test('Ctrl+C exits from Help instead of acting as overlay help copy', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({snapshot: richSnapshot()});

  session.dispatchKey('CTRL_K');
  assert.equal(session.state().overlay, 'help');

  session.dispatchKey('CTRL_C');

  assert.equal(session.state().running, false);
  assert.equal(session.state().overlay, 'help');
  session.destroy();
});

test('Ctrl+K puts help above an already open page overlay and Close targets help', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({snapshot: richSnapshot()});

  session.click('todo-add-task');
  assert.equal(session.state().todo.overlay, 'add-task');
  assert.match(session.output(), /Add task/);

  session.dispatchKey('CTRL_K');

  assert.equal(session.state().overlay, 'help');
  assert.equal(session.state().todo.overlay, 'add-task');
  assert.equal(session.focusedId(), 'help-close');

  const outputWithHelp = session.output();

  assert.match(outputWithHelp, /Todo help/);
  assert.match(outputWithHelp, /Esc closes Help\./);

  const helpOverlayText = scopedOverlayLines(outputWithHelp, /Todo help/).join('\n');

  assert.doesNotMatch(helpOverlayText, /Add task/);

  session.click('help-close');

  assert.equal(session.state().overlay, null);
  assert.equal(session.state().todo.overlay, 'add-task');
  assert.match(session.output(), /Add task/);
  assert.equal(session.state().running, true);
  session.destroy();
});


test('Esc sin overlay activo no sale de la app', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({snapshot: baseSnapshot()});

  assert.equal(session.state().running, true);

  session.dispatchKey('ESCAPE');

  assert.equal(session.state().running, true);
  assert.equal(session.state().overlay, null);
  assert.equal(session.state().board.overlay, null);
  session.destroy();
});

test('Esc cierra help sin usar semantica de salida de Ctrl+C', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({state: {overlay: 'help'}, snapshot: baseSnapshot()});

  session.dispatchKey('ESCAPE');

  assert.equal(session.state().overlay, null);
  assert.equal(session.state().running, true);
  assert.doesNotMatch(session.output(), /Todo help/);
  session.destroy();
});
test('createHeadlessSession cambia activeTab con CTRL_1 a CTRL_4', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({snapshot: richSnapshot(), state: {activeTab: 'Clocks'}});

  const cases = [
    ['CTRL_1', 'Todo'],
    ['CTRL_2', 'Notes'],
    ['CTRL_3', 'Board'],
    ['CTRL_4', 'Clocks']
  ];

  for (const [key, expectedTab] of cases) {
    session.dispatchKey(key);
    assert.equal(session.state().activeTab, expectedTab);
  }

  session.destroy();
});


test('chrome persistente no muestra contenido redundante y respeta 80 columnas', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({snapshot: richSnapshot()});
  const output = session.output();
  const lines = visibleLines(output);

  assert.equal(countWord(output, 'ilu'), 0);
  assert.doesNotMatch(output, /Ctrl\+A|Ctrl\+B|Ctrl\+H/);
  assert.doesNotMatch(output, /^Today$/m);
  assert.match(output, /Ship read view/);

  session.click('tab-notes');
  assert.doesNotMatch(session.output(), /^Research$/m);
  assert.match(session.output(), /Threat model/);

  session.click('tab-board');
  assert.doesNotMatch(session.output(), /^Launch board$/m);
  assert.ok(lines.every(line => line.length <= 80), `expected no overdraw, got:\n${lines.join('\n')}`);
  session.destroy();
});

test('Board muestra selector compacto de boards y permite cambiar board sin usar flechas laterales', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    useBoard(values) {
      calls.push(values);
      return {ok: true};
    }
  };
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    boardActions,
    snapshot: baseSnapshot({
      board: {
        id: 'launch',
        title: 'Launch board',
        boards: [
          {id: 'launch', title: 'Launch board', current: true},
          {id: 'ops', title: 'Ops board', current: false}
        ],
        totalCards: 1,
        columns: [{index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', position: 1}], remaining: 0}],
        remainingColumns: 0
      }
    })
  });

  const firstLine = visibleLines(session.output()).find(line => /Launch board/.test(line) && /Ops board/.test(line));
  assert.ok(firstLine, `expected board selector row, got:
${visibleLines(session.output()).join('\n')}`);
  assert.match(firstLine, /Launch board/);
  assert.match(firstLine, /Ops board/);
  assert.doesNotMatch(firstLine, /Boards/);
  assert.doesNotMatch(session.output(), /^Launch board$/m);

  session.click('board-switch-ops');
  assert.deepEqual(calls, [{id: 'ops'}]);
  assert.equal(session.state().activeTab, 'Board');
  session.dispatchKey('RIGHT');
  assert.notDeepEqual(calls, [{id: 'ops'}, {id: 'ops'}], 'RIGHT must not switch boards');
  session.destroy();
});



test('Board selector cambia board con id numerico real sin convertirlo a string', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    useBoard(values) {
      calls.push(values);
      return {ok: true};
    }
  };
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    boardActions,
    snapshot: baseSnapshot({
      board: {
        id: 1,
        title: 'Launch board',
        boards: [
          {id: 1, title: 'Launch board', current: true},
          {id: 2, title: 'Ops board', current: false}
        ],
        totalCards: 1,
        columns: [{index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', position: 1}], remaining: 0}],
        remainingColumns: 0
      }
    })
  });

  assert.match(session.output(), /Ops board/);
  session.click('board-switch-2');

  assert.deepEqual(calls, [{id: 2}]);
  session.destroy();
});


test('Board action bar reemplaza Columns por Add column y abre add-column directo', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: realBoardSnapshot()});

  assert.match(session.output(), /Add column/);
  assert.doesNotMatch(session.output(), /Columns/);
  session.click('board-add-column-action');

  assert.equal(session.state().board.overlay, 'add-column');
  assert.equal(session.focusedId(), 'board-add-column-title');
  assert.match(session.output(), /Add column/);
  session.destroy();
});

test('Board doublepress en header de segunda columna abre detalle de esa columna sin botones Left Right', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 2,
        columns: [
          {index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', position: 1}], remaining: 0},
          {index: 2, title: 'Doing', count: 1, cards: [{title: 'Wire UI', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  doublePressVisibleText(stdin, session, 'Doing');

  assert.match(session.output(), /Column: Doing/);

  const overlayText = scopedOverlayLines(session.output(), /Column: Doing/).join('\n');

  assert.doesNotMatch(overlayText, /Add column/);
  assert.doesNotMatch(overlayText, /Reset to default layout/);
  assert.match(overlayText, /Rename/);
  assert.match(overlayText, /WIP/);
  assert.match(overlayText, /Default/);
  assert.doesNotMatch(overlayText, /Left/);
  assert.doesNotMatch(overlayText, /Right/);
  assert.match(overlayText, /Remove column/);
  assert.match(overlayText, /Close/);
  session.destroy();
});


test('Column details footer usa una sola linea con labels compactos', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board', board: {overlay: 'column-details', selectedColumnIndex: 2}},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 1,
        defaultColumnId: 1,
        columns: [
          {id: 1, index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', position: 1}], isDefault: true, remaining: 0},
          {id: 2, index: 2, title: 'Ready', count: 0, cards: [], isDefault: false, remaining: 0},
          {id: 3, index: 3, title: 'Done', count: 0, cards: [], isDefault: false, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const overlayLines = scopedOverlayLines(session.output(), /Column: Ready/);
  const footerLines = overlayLines.filter(line => /Rename|WIP|Default|Remove column|Close/.test(line));

  assert.equal(footerLines.length, 1, `expected column detail actions on one line, got:\n${footerLines.join('\n')}`);
  assert.match(footerLines[0], /Rename/);
  assert.match(footerLines[0], /WIP/);
  assert.match(footerLines[0], /Default/);
  assert.doesNotMatch(footerLines[0], /Left/);
  assert.doesNotMatch(footerLines[0], /Right/);
  assert.match(footerLines[0], /Remove column/);
  assert.match(footerLines[0], /Close/);
  assert.ok(footerLines[0].length <= 80, `expected footer line within 80 columns, got ${footerLines[0].length}: ${footerLines[0]}`);
  assert.equal(visibleLines(session.output()).filter(line => line.length > 80).length, 0);
  session.destroy();
});

test('Column details footer renderiza Current con el mismo componente de boton compartido', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board', board: {overlay: 'column-details', selectedColumnIndex: 1}},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 0,
        defaultColumnId: 1,
        columns: [
          {id: 1, index: 1, title: 'Backlog', count: 0, cards: [], isDefault: true, remaining: 0},
          {id: 2, index: 2, title: 'Ready', count: 0, cards: [], isDefault: false, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const overlayLines = scopedOverlayLines(session.output(), /Column: Backlog/);
  const footerLines = overlayLines.filter(line => /Rename|WIP|Current|Remove column|Close/.test(line));
  const ansiFooterLine = session.ansiOutput().split(/\r?\n/).find(line => line.includes('Rename') && line.includes('Current')) || '';

  assert.equal(footerLines.length, 1, `expected default column detail actions on one line, got:\n${footerLines.join('\n')}`);
  assert.match(footerLines[0], /Rename/);
  assert.match(footerLines[0], /WIP/);
  assert.match(footerLines[0], /Current/);
  assert.match(footerLines[0], /Remove column/);
  assert.match(footerLines[0], /Close/);
  assert.match(ansiFooterLine, /\x1b\[48;2;31;35;40m  Current  /);
  assert.ok(visibleLines(session.output()).filter(line => line.length > 80).length === 0);
  session.destroy();
});

test('Column details arma Remove column inline y segundo click elimina la columna', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    removeColumn(values) {
      calls.push(values);
      return {ok: true};
    }
  };
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board', board: {overlay: 'column-details', selectedColumnIndex: 2}},
    boardActions,
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 0,
        defaultColumnId: 1,
        columns: [
          {id: 1, index: 1, title: 'Backlog', count: 0, cards: [], isDefault: true, remaining: 0},
          {id: 2, index: 2, title: 'Ready', count: 0, cards: [], isDefault: false, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  session.click('board-remove-column');

  assert.equal(session.state().board.overlay, 'column-details');
  assert.deepEqual(calls, []);
  assert.match(session.output(), /Select Delete column to confirm\./);
  assert.match(session.output(), /Delete column/);
  assert.doesNotMatch(session.output(), /Remove column "Ready"\?/);
  assert.equal(session.focusedId(), 'board-remove-column');

  session.click('board-remove-column');

  assert.deepEqual(calls, [{columnIndex: 2}]);
  session.destroy();
});

test('LEFT y RIGHT no son consumidos por Board cuando un overlay tiene foco de input', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: realBoardSnapshot()});

  session.click('board-add-card');
  session.dispatchText('abc');
  session.dispatchKey('LEFT');
  session.dispatchText('X');

  assert.equal(session.state().board.addCard.title, 'abXc');
  assert.equal(session.state().board.selectedColumnIndex, 1);
  assert.equal(session.focusedId(), 'board-add-title');
  session.destroy();
});

test('Board selector con muchos boards largos se mantiene dentro de 80 columnas', async () => {
  const Ui = require(uiModulePath);
  const longBoards = Array.from({length: 8}, (_, index) => ({
    id: index + 1,
    title: `Board con nombre extremadamente largo ${index + 1}`,
    current: index === 0
  }));
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        id: 1,
        title: longBoards[0].title,
        boards: longBoards,
        totalCards: 1,
        columns: [{index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', position: 1}], remaining: 0}],
        remainingColumns: 0
      }
    })
  });

  const lines = visibleLines(session.output());
  const selectorLine = lines.find(line => /Board con nombre extremadamente largo 1/.test(line));

  assert.doesNotMatch(selectorLine, /Boards/);
  assert.ok(selectorLine, `expected selector line, got:\n${lines.join('\n')}`);
  assert.ok(selectorLine.length <= 80, `expected selector within 80 columns, got ${selectorLine.length}: ${selectorLine}`);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});
test('Board identifica card seleccionado con marcador sobrio y flechas verticales actualizan seleccion', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: realBoardSnapshot()});

  assert.doesNotMatch(session.output(), /› Write tests/);
  session.dispatchKey('DOWN');

  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 2});
  assert.match(session.output(), /› Wire UI/);
  assert.match(session.output(), /Write tests/);
  session.destroy();
});

test('Board flechas izquierda y derecha mueven la card seleccionada a la columna vecina', async () => {
  const Ui = require(uiModulePath);
  const cards = {
    backlog: [{title: 'Write tests', position: 1}],
    doing: [{title: 'Wire UI', position: 1}]
  };
  const calls = [];
  const boardActions = {
    moveCard(values) {
      calls.push(values);
      const source = values.fromColumn === 1 ? cards.backlog : cards.doing;
      const target = values.toColumn === 1 ? cards.backlog : cards.doing;
      const [card] = source.splice(values.fromPosition - 1, 1);

      target.push({...card, position: target.length + 1});
      source.forEach((card, index) => { card.position = index + 1; });
      target.forEach((card, index) => { card.position = index + 1; });
      return {ok: true};
    }
  };
  const buildSnapshot = () => baseSnapshot({
    board: {
      title: 'Launch board',
      totalCards: cards.backlog.length + cards.doing.length,
      columns: [
        {index: 1, title: 'Backlog', count: cards.backlog.length, cards: cards.backlog.map(card => ({...card})), remaining: 0},
        {index: 2, title: 'Doing', count: cards.doing.length, cards: cards.doing.map(card => ({...card})), remaining: 0}
      ],
      remainingColumns: 0
    }
  });
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}},
    buildSnapshot,
    boardActions
  });

  session.dispatchKey('RIGHT');
  assert.deepEqual(calls, [{fromColumn: 1, fromPosition: 1, toColumn: 2}]);
  assert.equal(session.state().board.selectedColumnIndex, 2);
  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 2, position: 2});
  assert.equal(session.focusedId(), 'board-card-list-2');
  assert.equal(session.state().board.overlay, null);
  assert.equal(session.state().activeTab, 'Board');
  assert.match(session.output(), /› Write tests/);

  session.dispatchKey('LEFT');
  assert.deepEqual(calls, [
    {fromColumn: 1, fromPosition: 1, toColumn: 2},
    {fromColumn: 2, fromPosition: 2, toColumn: 1}
  ]);
  assert.equal(session.state().board.selectedColumnIndex, 1);
  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 1});
  assert.equal(session.focusedId(), 'board-card-list-1');
  assert.equal(session.state().board.overlay, null);
  assert.match(session.output(), /› Write tests/);
  session.destroy();
});

test('Board Shift+Up and Shift+Down persist card priority and keep moved card selected', async () => {
  const Ui = require(uiModulePath);
  const cards = [
    {title: 'First card', position: 1},
    {title: 'Second card', position: 2},
    {title: 'Third card', position: 3}
  ];
  const calls = [];
  const boardActions = {
    prioritizeCard(values) {
      calls.push(values);
      const [card] = cards.splice(values.position - 1, 1);
      cards.splice(values.toPosition - 1, 0, card);
      cards.forEach((item, index) => { item.position = index + 1; });
      return {ok: true};
    }
  };
  const buildSnapshot = () => baseSnapshot({
    board: {
      title: 'Launch board',
      totalCards: cards.length,
      columns: [
        {index: 1, title: 'Backlog', count: cards.length, cards: cards.map(card => ({...card})), remaining: 0}
      ],
      remainingColumns: 0
    }
  });
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 2}},
    buildSnapshot,
    boardActions
  });

  session.focus('board-card-list-1');
  session.dispatchKey('SHIFT_UP');

  assert.deepEqual(calls, [{columnIndex: 1, position: 2, toPosition: 1}]);
  assert.ok(orderedTextIndex(session.output(), ['Second card', 'First card', 'Third card']).every((value, index, list) => index === 0 || list[index - 1] < value));
  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 1});
  assert.equal(session.focusedId(), 'board-card-list-1');

  session.dispatchKey('SHIFT_DOWN');
  assert.deepEqual(calls, [
    {columnIndex: 1, position: 2, toPosition: 1},
    {columnIndex: 1, position: 1, toPosition: 2}
  ]);
  assert.ok(orderedTextIndex(session.output(), ['First card', 'Second card', 'Third card']).every((value, index, list) => index === 0 || list[index - 1] < value));
  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 2});
  session.destroy();
});

test('Board Shift priority shortcut is scoped to card lists and no-ops at boundaries', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    prioritizeCard(values) {
      calls.push(values);
      return {ok: true};
    }
  };
  const snapshot = baseSnapshot({
    board: {
      title: 'Launch board',
      totalCards: 2,
      columns: [
        {index: 1, title: 'Backlog', count: 2, cards: [{title: 'First card', position: 1}, {title: 'Second card', position: 2}], remaining: 0}
      ],
      remainingColumns: 0
    }
  });
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}},
    snapshot,
    boardActions
  });

  session.focus('board-card-list-1');
  session.dispatchKey('SHIFT_UP');
  session.click('board-column-header-1');
  session.dispatchKey('SHIFT_DOWN');

  assert.deepEqual(calls, []);
  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 1});
  session.destroy();
});

function orderedTextIndex(output, labels) {
  const text = stripAnsi(output);
  return labels.map(label => text.indexOf(label));
}

test('Board flechas izquierda y derecha son no-op sin card seleccionada o sin columna vecina', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    moveCard(values) {
      calls.push(values);
      return {ok: true};
    }
  };
  const snapshot = baseSnapshot({
    board: {
      title: 'Launch board',
      totalCards: 2,
      columns: [
        {index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', position: 1}], remaining: 0},
        {index: 2, title: 'Doing', count: 1, cards: [{title: 'Wire UI', position: 1}], remaining: 0}
      ],
      remainingColumns: 0
    }
  });
  const sessionWithoutSelection = await Ui.createHeadlessSession({
    state: {activeTab: 'Board', selectedColumnIndex: 1, selectedCard: null},
    snapshot,
    boardActions
  });

  sessionWithoutSelection.dispatchKey('RIGHT');
  assert.deepEqual(calls, []);
  assert.equal(sessionWithoutSelection.state().board.selectedColumnIndex, 1);
  assert.equal(sessionWithoutSelection.state().board.selectedCard, null);
  assert.equal(sessionWithoutSelection.state().board.overlay, null);
  sessionWithoutSelection.destroy();

  const sessionAtEdge = await Ui.createHeadlessSession({
    state: {activeTab: 'Board', selectedColumnIndex: 1, selectedCard: {columnIndex: 1, position: 1}},
    snapshot,
    boardActions
  });

  sessionAtEdge.dispatchKey('LEFT');
  assert.deepEqual(calls, []);
  assert.equal(sessionAtEdge.state().board.selectedColumnIndex, 1);
  assert.deepEqual(sessionAtEdge.state().board.selectedCard, {columnIndex: 1, position: 1});
  assert.equal(sessionAtEdge.state().board.overlay, null);
  sessionAtEdge.destroy();
});

test('Board mover card enfoca columna destino y mantiene la card movida seleccionada', async () => {
  const Ui = require(uiModulePath);
  const cards = {
    backlog: [{title: 'Write tests', position: 1}],
    doing: [{title: 'Wire UI', position: 1}]
  };
  const calls = [];
  const boardActions = {
    moveCard(values) {
      calls.push(values);
      const [card] = cards.backlog.splice(values.fromPosition - 1, 1);
      cards.doing.push({...card, position: cards.doing.length + 1});
      cards.backlog.forEach((card, index) => { card.position = index + 1; });
      return {ok: true};
    }
  };
  const buildSnapshot = () => baseSnapshot({
    board: {
      title: 'Launch board',
      totalCards: cards.backlog.length + cards.doing.length,
      columns: [
        {index: 1, title: 'Backlog', count: cards.backlog.length, cards: cards.backlog.map(card => ({...card})), remaining: 0},
        {index: 2, title: 'Doing', count: cards.doing.length, cards: cards.doing.map(card => ({...card})), remaining: 0}
      ],
      remainingColumns: 0
    }
  });

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}, overlay: 'card-details'}, buildSnapshot, boardActions});

  session.click('board-card-move');
  session.click('board-move-to-2');

  assert.deepEqual(calls, [{fromColumn: 1, fromPosition: 1, toColumn: 2}]);
  assert.equal(session.state().board.selectedColumnIndex, 2);
  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 2, position: 2});
  assert.equal(session.focusedId(), 'board-card-list-2');
  assert.match(session.output(), /› Write tests/);
  assert.equal(session.state().board.overlay, null);
  session.destroy();
});

test('createHeadlessSession mantiene app dentro de viewport 80x24 con board largo', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}},
    snapshot: baseSnapshot({
      todo: {
        title: 'Inbox',
        items: [
          {text: 'Review the incident notes before shipping the terminal view layout fix', done: false},
          {text: 'Keep the add placeholder read-only until forms exist', done: false},
          {text: 'Confirm keymaps stay active after layout changes', done: true}
        ],
        remaining: 2
      },
      notes: {
        title: 'Notes',
        items: [
          {text: 'The UI must stay usable in a narrow terminal'},
          {text: 'Long content should not push panels below the visible frame'},
          {text: 'This note intentionally has more words than a tiny panel can show cleanly'}
        ],
        remaining: 1
      },
      board: {
        title: 'Board',
        totalCards: 9,
        columns: [
          {
            title: 'Backlog with a deliberately long title',
            count: 4,
            cards: [
              'Check overly wide board columns',
              'Audit terminal layout primitives before touching sync',
              'Document why Row is not a column layout primitive'
            ],
            remaining: 1
          },
          {
            title: 'Doing',
            count: 3,
            cards: [
              'Replace the unsafe horizontal composition',
              'Keep Board visible after Ctrl+B in headless mode',
              'Avoid leaking implementation terms into user copy'
            ]
          },
          {
            title: 'Done',
            count: 2,
            cards: [
              'Read-only model loads',
              'Footer key hints remain visible'
            ]
          }
        ]
      },
      clocks: {items: [{name: 'UTC', time: '12:00'}], remaining: 0}
    })
  });

  try {
    const output = session.output();
    const lines = visibleLines(output);

    assert.match(output, /Board/);
    assert.doesNotMatch(output, /Backlog with a deliberately long title/);
    assert.match(output, /\(4\)/);
    assert.match(output, /Doing/);
    assert.match(output, /Done/);
    assert.ok(lines.length <= 24, `expected at most 24 lines, got ${lines.length}`);
    assert.equal(lines.length, 24, 'expected output to fill the visible 80x24 frame');
    assert.match(lines.at(-1), /Ctrl\+C: Exit/);
    assert.equal(lines.slice(lines.findLastIndex(line => /Ctrl\+C: Exit/.test(line)) + 1).filter(line => line.trim() === '').length, 0);
    assert.equal(
      lines.filter(line => line.length > 80).length,
      0,
      `expected no lines wider than 80 columns, got ${Math.max(...lines.map(line => line.length))}`
    );
  } finally {
    session.destroy();
  }
});



test('Board muestra todas las columnas disponibles del read-model en el ancho actual', async () => {
  const Ui = require(uiModulePath);
  const columns = ['Todo', 'Doing', 'Review', 'Blocked', 'Done', 'Archive'].map((title, index) => ({
    title,
    cards: [{title: `Card ${index + 1}`}]
  }));
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshotOptions: {
      models: boardSnapshotModels({title: 'Release board', columns})
    }
  });

  const lines = visibleLines(session.output());
  const visibleColumnFragments = ['Todo', 'Doing', 'Review', 'Blocke', 'Done', 'Archiv'];
  const headerLine = lines.find(line => visibleColumnFragments.every(fragment => line.includes(fragment)));

  assert.ok(headerLine, `expected all columns in one flexible row, got:
${lines.join('\n')}`);
  assert.doesNotMatch(session.output(), /more columns/i);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});

test('Board muestra todos los cards y no renderiza marcador de more cards', async () => {
  const Ui = require(uiModulePath);
  const cards = Array.from({length: 6}, (_, index) => ({title: `Card ${index + 1}`}));
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshotOptions: {
      models: boardSnapshotModels({title: 'Release board', columns: [{title: 'Backlog', cards}]})
    }
  });

  const output = session.output();

  for (const card of cards) {
    assert.match(output, new RegExp(card.title));
  }

  assert.doesNotMatch(output, /\+\d+ more cards/i);
  session.destroy();
});

test('Board columnas toman todo el alto disponible antes de action bar y footer', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Board',
        totalCards: 2,
        columns: [
          {index: 1, title: 'Backlog', count: 1, cards: [{title: 'One', position: 1}], remaining: 0},
          {index: 2, title: 'Doing', count: 1, cards: [{title: 'Two', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const lines = visibleLines(session.output());
  const ansiLines = session.ansiOutput().split(/\r?\n/);
  const columnBorderRows = lines.filter(line => /[┌│└]/.test(line));

  assert.equal(columnBorderRows.length, 18, `expected column border to fill 18 rows, got ${columnBorderRows.length}`);
  assert.equal(ansiLines.filter(line => line.includes('\x1b[48;2;15;23;42m')).length, 0, 'expected columns to avoid alternate background surface');
  session.destroy();
});


test('Board con pocos cards conserva borde inferior dentro del alto real de columna', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Board',
        totalCards: 1,
        columns: [
          {index: 1, title: 'Backlog', count: 1, cards: [{title: 'One', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const lines = visibleLines(session.output());
  const columnRows = lines.filter(line => /[┌│└]/.test(line));

  assert.equal(columnRows.length, 18, `expected column to occupy 18 rows, got ${columnRows.length}:\n${lines.join('\n')}`);
  assert.match(columnRows.at(-1), /└─+┘/, `expected final column row to be the bottom border, got:\n${lines.join('\n')}`);
  session.destroy();
});

test('Board renderiza columnas horizontales fluidas sin gutter y headers con contador', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 6,
        columns: [
          {index: 1, title: 'Backlog', count: 1, wipLimit: 3, cards: [{title: 'Write tests', position: 1}], remaining: 0},
          {index: 2, title: 'Doing', count: 4, wipLimit: null, cards: [{title: 'Wire UI', position: 1}], remaining: 3},
          {index: 3, title: 'Done', count: 1, cards: [{title: 'Smoke', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const lines = visibleLines(session.output());
  const headerLine = lines.find(line => /Backlog/.test(line) && /Doing/.test(line) && /Done/.test(line));

  assert.ok(headerLine, `expected column headers on one horizontal row, got:\n${lines.join('\n')}`);
  assert.match(headerLine, /Backlog/);
  assert.match(headerLine, /\(1\/3\)/);
  assert.match(headerLine, /Doing/);
  assert.match(headerLine, /\(4\)/);
  assert.match(headerLine, /Done/);
  assert.match(headerLine, /\(1\)/);
  assert.match(headerLine, /\(1\/3\).*││.*Doing/, 'expected zero-cell gutter between bordered columns');
  assert.ok(
    headerLine.indexOf('(1/3)') > headerLine.indexOf('Backlog') + 'Backlog'.length,
    'expected WIP counter to sit after the title in the first column header'
  );
  assert.ok(lines.every(line => line.length <= 80), `expected no overdraw, got max ${Math.max(...lines.map(line => line.length))}`);
  session.destroy();
});


test('mountInteractiveSession delegates stdout resize handling to Valyrian runtime', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  stdout.columns = 100;
  stdout.rows = 24;
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 3,
        columns: [
          {index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', position: 1}], remaining: 0},
          {index: 2, title: 'Doing', count: 1, cards: [{title: 'Wire UI', position: 1}], remaining: 0},
          {index: 3, title: 'Done', count: 1, cards: [{title: 'Smoke', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  try {
    assert.equal(stdout.listenerCount('resize'), 1, 'expected only the Valyrian runtime resize listener');

    stdout.columns = 60;
    stdout.rows = 24;
    stdout.emit('resize');
    await new Promise(resolve => queueMicrotask(resolve));

    const lines = visibleLines(session.output());
    const headerLine = lines.find(line => /Backlog/.test(line) && /Doing/.test(line) && /Done/.test(line));

    assert.equal(lines.length, 24, 'expected resized output to stay inside 60x24 frame');
    assert.equal(lines.filter(line => line.length > 60).length, 0);
    assert.ok(headerLine, `expected board to reflow useful column headers after resize, got:\n${lines.join('\n')}`);
  } finally {
    session.destroy();
  }
});
test('Board headers no heredan background ANSI de Button', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 2,
        columns: [
          {index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', position: 1}], remaining: 0},
          {index: 2, title: 'Doing', count: 1, cards: [{title: 'Wire UI', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const ansiHeaderLine = session.ansiOutput().split(/\r?\n/).find(line => line.includes('Backlog') && line.includes('Doing'));

  assert.ok(ansiHeaderLine, `expected ANSI header line, got:\n${session.ansiOutput()}`);
  assert.match(
    ansiHeaderLine,
    /\x1b\[48;2;13;17;23m(?:\x1b\[[0-?]*[ -/]*[@-~])*Backlog/,
    `expected board header text to inherit panel surface, got ${JSON.stringify(ansiHeaderLine)}`
  );
  session.destroy();
});

test('Board renderiza columnas con borde y sin surface ANSI propio', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 2,
        columns: [
          {index: 1, title: 'Backlog', count: 1, wipLimit: 3, cards: [{title: 'Write tests', position: 1}], remaining: 0},
          {index: 2, title: 'Doing', count: 1, cards: [{title: 'Wire UI', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const ansi = session.ansiOutput();

  assert.doesNotMatch(ansi, /\x1b\[48;2;15;23;42m/, 'expected alternate column to avoid surface background');
  assert.match(session.output(), /┌─+┐/, 'expected columns to render a top border');
  assert.match(session.output(), /│.*Backlog.*││.*Doing.*│/, 'expected bordered columns separated by zero-cell gutter');
  session.destroy();
});



test('Board renderiza marcador sobrio cuando existe selectedCard previo', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 1,
        columns: [
          {index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  assert.doesNotMatch(
    session.ansiOutput(),
    /\x1b\[48;2;31;35;40m\s*• Write tests/,
    'expected normal board card to avoid its own dark button surface'
  );
  assert.match(session.output(), /› Write tests/);
  assert.doesNotMatch(session.output(), /• Write tests/);

  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 1});
  assert.doesNotMatch(
    session.ansiOutput(),
    /\x1b\[48;2;(46;52;64|59;66;82|43;49;55)m.*• Write tests/,
    'expected board card to avoid selected/current/hover ANSI backgrounds'
  );
  session.destroy();
});


test('mountInteractiveSession abre card con doublepress real de mouse', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const appState = {activeTab: 'Board'};
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: appState,
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 2,
        columns: [
          {
            index: 1,
            title: 'Backlog',
            count: 2,
            cards: [{title: 'Write tests', position: 1}, {title: 'Wire UI', position: 2}],
            remaining: 0
          }
        ],
        remainingColumns: 0
      }
    })
  });

  doublePressVisibleText(stdin, session, 'Wire UI');

  assert.match(session.output(), /Backlog \| Wire UI/);
  assert.match(session.output(), /Wire UI/);
  session.destroy();
});

test('Board doublepress del mismo card vuelve a abrir despues de cerrar overlay sin supresor local', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: realBoardSnapshot()
  });

  doublePressVisibleText(stdin, session, 'Write tests');
  assert.match(session.output(), /Backlog \| Write tests/);

  stdin.send('\x03');
  assert.doesNotMatch(session.output(), /Backlog \| Write tests/);

  doublePressVisibleText(stdin, session, 'Write tests');
  assert.match(session.output(), /Backlog \| Write tests/);
  assert.match(session.output(), /Write tests/);
  session.destroy();
});

test('Board doublepress del mismo card vuelve a abrir despues de cerrar con boton Close', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: realBoardSnapshot()
  });

  doublePressVisibleText(stdin, session, 'Write tests');
  assert.match(session.output(), /Backlog \| Write tests/);

  pressVisibleText(stdin, session, 'Close');
  assert.doesNotMatch(session.output(), /Backlog \| Write tests/);

  doublePressVisibleText(stdin, session, 'Write tests');
  assert.match(session.output(), /Backlog \| Write tests/);
  assert.match(session.output(), /Write tests/);
  session.destroy();
});

test('Board doublepress sigue activo en mismo y otros cards despues de cerrar overlay y mantiene scroll', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const cards = Array.from({length: 18}, (_, index) => ({title: `Card ${index + 1}`, position: index + 1}));
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: cards.length, cards, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  doublePressVisibleText(stdin, session, 'Card 1');
  assert.match(session.output(), /Backlog \| Card 1/);
  assert.match(session.output(), /Card 1/);

  pressVisibleText(stdin, session, 'Close');
  assert.doesNotMatch(session.output(), /Backlog \| Card 1/);

  doublePressVisibleText(stdin, session, 'Card 1');
  assert.match(session.output(), /Backlog \| Card 1/);
  assert.match(session.output(), /Card 1/);

  pressVisibleText(stdin, session, 'Close');
  assert.doesNotMatch(session.output(), /Backlog \| Card 1/);

  doublePressVisibleText(stdin, session, 'Card 2');
  assert.match(session.output(), /Backlog \| Card 2/);
  assert.match(session.output(), /Card 2/);

  pressVisibleText(stdin, session, 'Close');
  for (let index = 0; index < 18; index += 1) {
    wheelDownVisibleText(stdin, session, 'Card 1');
  }

  assert.match(session.output(), /Card 16|Card 17|Card 18/, `expected wheel scroll to keep moving after overlay closes, got:
${visibleLines(session.output()).join('\n')}`);
  session.destroy();
});

test('Board doublepress valido en otro card no queda bloqueado despues de cerrar detalle de columna', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board', board: {overlay: 'column-details'}},
    snapshot: realBoardSnapshot()
  });

  assert.match(session.output(), /Column: Backlog/);

  session.click('board-column-details-close');
  assert.doesNotMatch(session.output(), /Column: Backlog/);

  doublePressVisibleText(stdin, session, 'Wire UI');
  assert.match(session.output(), /Backlog \| Wire UI/);
  assert.match(session.output(), /Wire UI/);
  session.destroy();
});




test('mountInteractiveSession no revierte columna seleccionada al sincronizar card previa', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board', board: {overlay: 'column-details', selectedCard: {columnIndex: 1, position: 1}, selectedColumnIndex: 1}},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 2,
        columns: [
          {index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', position: 1}], remaining: 0},
          {index: 2, title: 'Doing', count: 1, cards: [{title: 'Wire UI', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  assert.match(session.output(), /Column: Backlog/);
  assert.doesNotMatch(session.output(), /Column: Doing/);
  session.destroy();
});

test('Board pinta marcador de seleccion para un card seleccionado que no es la primera fila', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 2}},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 2,
        columns: [
          {
            index: 1,
            title: 'Backlog',
            count: 2,
            cards: [{title: 'Write tests', position: 1}, {title: 'Wire UI', position: 2}],
            remaining: 0
          }
        ],
        remainingColumns: 0
      }
    })
  });

  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 2});
  assert.match(session.output(), /› Wire UI/, 'expected board list to show selected marker');
  assert.doesNotMatch(session.output(), /• Wire UI/);
  session.destroy();
});

test('Board muestra titulos largos de cards en filas visuales sin elipsis', async () => {
  const Ui = require(uiModulePath);
  const longTitle = 'Card title alpha beta gamma delta epsilon zeta eta theta iota kappa lambda';
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 1,
        columns: [
          {index: 1, title: 'Backlog', count: 1, cards: [{title: longTitle, position: 1}], remaining: 0},
          {index: 2, title: 'Done', count: 0, cards: [], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const output = session.output();
  const lines = visibleLines(output);
  const cardLines = lines.filter(line => /Card title|epsilon|lambda/.test(line));
  session.destroy();

  assert.ok(cardLines.length >= 2, `expected Board visual rows to preserve long card titles, got:\n${lines.join('\n')}`);
  assert.match(cardLines[0], /• Card title alpha beta gamma delta/);
  assert.match(cardLines[1], /epsilon zeta eta theta iota kappa/);
  assert.match(lines.join('\n'), /mbda/);
  assert.doesNotMatch(cardLines.join('\n'), /…/, 'expected ilu to avoid manual ellipsis truncation');
});

test('createHeadlessSession no selecciona Board cards por ids sinteticos fuera del runtime', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: realBoardSnapshot()});

  session.click('board-card-1-1');

  assert.equal(session.state().board.selectedCard, null);
  session.destroy();
});


test('Board clickAt visible de card usa press semantico de List para seleccionar sin abrir detalles', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Board'}, snapshot: realBoardSnapshot()});

  clickVisibleText(session, 'Write tests');

  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 1});
  assert.equal(session.state().board.overlay, null);
  assert.match(session.output(), /› Write tests/);
  session.destroy();
});
test('mountInteractiveSession delega mouse reporting al lifecycle de Valyrian sin duplicar secuencias', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const countSequence = (value, sequence) => value.split(sequence).length - 1;

  const session = await Ui.mountInteractiveSession({stdin, stdout, cols: 80, rows: 24, snapshot: richSnapshot()});

  assert.equal(countSequence(stdout.output(), '\x1b[?1000h'), 1, 'expected Valyrian lifecycle to enable normal mouse reporting once');
  assert.equal(countSequence(stdout.output(), '\x1b[?1002h'), 1, 'expected Valyrian lifecycle to enable drag mouse reporting once');
  assert.equal(countSequence(stdout.output(), '\x1b[?1006h'), 1, 'expected Valyrian lifecycle to enable SGR mouse reporting once');
  await session.destroy();
});

test('Board cards se seleccionan con press simple delegado a List', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: realBoardSnapshot()
  });

  const cardRow = visibleLines(session.output()).findIndex(line => line.includes('Write tests')) + 1;

  stdin.send(mousePrimaryPressSequence(3, cardRow));

  assert.match(session.output(), /(?:› )?Write tests/);
  assert.doesNotMatch(session.output(), /Backlog \| Write tests/);

  stdin.send(mouseDragSequence(3, cardRow));

  assert.doesNotMatch(
    session.ansiOutput(),
    /\x1b\[48;2;(43;49;55|59;66;82|46;52;64)m.*• Write tests/,
    'expected hovered board card to avoid hover/current/selected ANSI backgrounds'
  );
  assert.match(session.output(), /Write tests/);
  session.destroy();
});

test('Board click por coordenadas dentro del List selecciona por press semantico', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 1,
        columns: [
          {index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', description: 'Coordinate click target', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  session.clickAt(30, 10);
  session.clickAt(30, 10);

  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 1});
  assert.equal(session.state().board.overlay, null);
  assert.match(session.output(), /› Write tests/);
  session.destroy();
});

test('Board reduce padding local de cards sin tocar el layout horizontal', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 2,
        columns: [
          {index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', position: 1}], remaining: 0},
          {index: 2, title: 'Doing', count: 1, cards: [{title: 'Wire UI', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const lines = visibleLines(session.output());
  const headerLine = lines.find(line => /Backlog/.test(line) && /Doing/.test(line));
  const cardLine = lines.find(line => /[›•] Write tests/.test(line) && /[›•] Wire UI/.test(line));

  assert.ok(headerLine, `expected horizontal board headers, got:\n${lines.join('\n')}`);
  assert.ok(cardLine, `expected horizontal card line, got:\n${lines.join('\n')}`);
  assert.equal(cardLine.indexOf('• Write tests'), cardLine.indexOf('│') + 1, 'expected first card marker to start immediately after the column border without extra padding');
  assert.equal(cardLine.indexOf('• Wire UI'), headerLine.indexOf('Doing'), 'expected second card marker to remove column/list padding while preserving the bordered gutter');
  session.destroy();
});



test('Board flecha real usa List interno sin viewport manual en el primer evento', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const cards = Array.from({length: 30}, (_, index) => ({title: `Card ${index + 1}`, position: index + 1}));
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Todo'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: cards.length, cards, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  session.click('tab-board');
  const before = session.output();
  stdin.send('\x1b[B');
  const after = session.output();

  assert.equal(firstVisibleCardTitle(before), 'Card 1', `expected initial viewport at Card 1, got:\n${visibleLines(before).join('\n')}`);
  assert.equal(firstVisibleCardTitle(after), 'Card 1', `expected first DOWN to keep viewport at Card 1 under Valyrian List internal active row, got:\n${visibleLines(after).join('\n')}`);
  assert.doesNotMatch(after, /Card details/);
  session.destroy();
});

test('Board rueda real cambia contenido visible desde el primer evento', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const cards = Array.from({length: 30}, (_, index) => ({title: `Card ${index + 1}`, position: index + 1}));
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: cards.length, cards, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const before = session.output();
  wheelDownVisibleText(stdin, session, 'Card 1');
  const after = session.output();

  assert.equal(firstVisibleCardTitle(before), 'Card 1', `expected initial viewport at Card 1, got:\n${visibleLines(before).join('\n')}`);
  assert.equal(firstVisibleCardTitle(after), 'Card 2', `expected first wheel event to scroll visible content, got:\n${visibleLines(after).join('\n')}`);
  assert.notEqual(after, before, 'expected visible output to change after first wheel event');
  session.destroy();
});

test('Board List virtualizado muestra scrollbar y acepta rueda sobre el track visible', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const cards = Array.from({length: 30}, (_, index) => ({title: `Card ${index + 1}`, position: index + 1}));
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: cards.length, cards, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const before = session.output();
  const lines = visibleLines(before);
  const rowIndex = lines.findIndex(line => /Card 1/.test(line) && /█/.test(line));

  assert.notEqual(rowIndex, -1, `expected visible scrollbar on the overflowing Board card list, got:\n${lines.join('\n')}`);

  const scrollbarColumn = lines[rowIndex].indexOf('█') + 1;
  stdin.send(mouseWheelDownSequence(scrollbarColumn, rowIndex + 1));
  const after = session.output();

  assert.equal(firstVisibleCardTitle(before), 'Card 1', `expected initial viewport at Card 1, got:\n${lines.join('\n')}`);
  assert.equal(firstVisibleCardTitle(after), 'Card 2', `expected wheel over visible scrollbar to scroll List viewport, got:\n${visibleLines(after).join('\n')}`);
  assert.equal(visibleLines(after).filter(line => line.length > 80).length, 0, `expected scrollbar to stay inside 80 columns, got:\n${visibleLines(after).join('\n')}`);
  session.destroy();
});

test('Board List con cards envueltos muestra scrollbar y wheel cambia filas visuales', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const title = 'Card with a very long title that wraps across multiple visual rows inside the board column';
  const cards = Array.from({length: 10}, (_, index) => ({title: `${title} ${index + 1}`, position: index + 1}));
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: cards.length, cards, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const before = session.output();
  const lines = visibleLines(before);
  const rowIndex = lines.findIndex(line => /Card with a very long title/.test(line));

  assert.notEqual(rowIndex, -1, `expected wrapped card text in:\n${lines.join('\n')}`);
  assert.ok(lines.some(line => /█/.test(line)), `expected visible scrollbar when wrapped visual rows overflow the Board card list, got:\n${lines.join('\n')}`);

  const wheelColumn = lines[rowIndex].indexOf('Card with') + 1;
  stdin.send(mouseWheelDownSequence(wheelColumn, rowIndex + 1));
  const after = session.output();

  assert.notEqual(after, before, 'expected first wheel event over a wrapped Board card row to change visible output');
  assert.match(after, /board column 1/, `expected wheel to advance into the wrapped visual rows, got:\n${visibleLines(after).join('\n')}`);
  assert.equal(visibleLines(after).filter(line => line.length > 80).length, 0, `expected wrapped scrollbar layout to stay inside 80 columns, got:\n${visibleLines(after).join('\n')}`);
  session.destroy();
});

test('Board List con cards envueltos mantiene scrollbar estable al cambiar selección', async () => {
  const Ui = require(uiModulePath);
  const longTitle = 'A long board card title that wraps across many visual rows inside the board column';
  const cards = Array.from({length: 10}, (_, index) => ({
    title: index % 2 === 0 ? `${longTitle} ${index + 1}` : `Short ${index + 1}`,
    position: index + 1
  }));
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: cards.length, cards, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const initialScrollbarRows = visibleLines(session.output()).filter(line => /█/.test(line)).length;
  session.dispatchKey('DOWN');
  const afterShortSelectionScrollbarRows = visibleLines(session.output()).filter(line => /█/.test(line)).length;
  session.dispatchKey('DOWN');
  const afterLongSelectionScrollbarRows = visibleLines(session.output()).filter(line => /█/.test(line)).length;

  assert.ok(initialScrollbarRows > 0, `expected initial wrapped Board card list scrollbar, got:\n${visibleLines(session.output()).join('\n')}`);
  assert.equal(afterShortSelectionScrollbarRows, initialScrollbarRows, 'expected scrollbar rows to stay stable after selecting a short card');
  assert.equal(afterLongSelectionScrollbarRows, initialScrollbarRows, 'expected scrollbar rows to stay stable after selecting another wrapped card');
  session.destroy();
});

test('Board List normaliza cards primitivas y vacias con marcador visible estable', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 3,
        columns: [
          {index: 1, title: 'Backlog', count: 3, cards: ['Plain string card', null, undefined], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const output = session.output();

  assert.match(output, /• Plain string card/);
  assert.equal(countWord(output, 'Untitled'), 2, `expected null and undefined cards to use fallback title, got:\n${visibleLines(output).join('\n')}`);
  assert.doesNotMatch(output, /\bnull\b|\bundefined\b/);
  assert.equal(visibleLines(output).filter(line => line.length > 80).length, 0);
  session.destroy();
});

test('Board List con cards envueltos selecciona la card real desde una linea visual envuelta', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const title = 'Card with a very long title that wraps across multiple visual rows inside the board column';
  const cards = [
    {title: `${title} 1`, position: 1},
    {title: 'Short follow-up card', position: 2}
  ];
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: cards.length, cards, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  const lines = visibleLines(session.output());
  const wrappedFragment = 'the board column 1';

  assert.ok(lines.some(line => line.includes(wrappedFragment)), `expected wrapped continuation line in:
${lines.join('\n')}`);

  pressVisibleText(stdin, session, wrappedFragment);

  assert.match(session.output(), /› Card with a very long title/);
  assert.doesNotMatch(session.output(), /Backlog \| Card with a very long title/);
  session.destroy();
});

test('Board rueda real cambia segunda columna sin depender del foco inicial', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const cards = Array.from({length: 30}, (_, index) => ({title: `Card ${index + 1}`, position: index + 1}));
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: 0, cards: [], remaining: 0},
          {index: 2, title: 'Doing', count: cards.length, cards, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  assert.equal(session.focusedId ? session.focusedId() : 'board-card-list-1', 'board-card-list-1');
  const before = session.output();
  wheelDownVisibleText(stdin, session, 'Card 1');
  const after = session.output();

  assert.equal(firstVisibleCardTitle(before), 'Card 1', `expected second column initial viewport at Card 1, got:\n${visibleLines(before).join('\n')}`);
  assert.equal(firstVisibleCardTitle(after), 'Card 2', `expected wheel over non-focused second column to scroll visible content, got:\n${visibleLines(after).join('\n')}`);
  assert.notEqual(after, before, 'expected visible output to change after first wheel over second column');
  session.destroy();
});

test('Board flecha real en segunda columna usa List interno sin priming secreto', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const cards = Array.from({length: 30}, (_, index) => ({title: `Card ${index + 1}`, position: index + 1}));
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: 0, cards: [], remaining: 0},
          {index: 2, title: 'Doing', count: cards.length, cards, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  assert.equal(session.focus('board-card-list-2'), true);
  const before = session.output();
  stdin.send('\x1b[B');
  const after = session.output();

  assert.equal(firstVisibleCardTitle(before), 'Card 1', `expected second column initial viewport at Card 1, got:\n${visibleLines(before).join('\n')}`);
  assert.equal(firstVisibleCardTitle(after), 'Card 1', `expected first DOWN after pointer focus to keep viewport at Card 1 under Valyrian List internal active row, got:\n${visibleLines(after).join('\n')}`);
  assert.doesNotMatch(session.output(), /Doing \| Card 1/);
  session.destroy();
});

test('Board headers son controles semanticos para seleccionar columna sin abrir cards', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 2,
        columns: [
          {index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', position: 1}], remaining: 0},
          {index: 2, title: 'Doing', count: 1, cards: [{title: 'Wire UI', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  assert.equal(session.focus('board-column-header-1'), true, 'expected Board column header to expose a semantic focusable control');
  clickVisibleText(session, 'Doing');
  assert.equal(session.state().board.selectedColumnIndex, 2, 'expected header click to select the clicked column');
  assert.equal(session.state().board.overlay, null, 'expected single header click to keep column details closed');
  assert.doesNotMatch(session.output(), /Column: Doing/, 'expected single header click not to open column details');
  assert.doesNotMatch(session.ansiOutput(), /\x1b\[48;2;31;95;158m\s*Doing/, 'expected header to avoid default active Button background');
  session.destroy();
});

test('Board hace scroll con flechas en uso real sin enfocar el List desde el test', async () => {
  const Ui = require(uiModulePath);
  const cards = Array.from({length: 30}, (_, index) => ({title: `Card ${index + 1}`, position: index + 1}));
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: cards.length, cards, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  assert.equal(session.focusedId(), 'board-card-list-1');

  for (let index = 0; index < 18; index += 1) {
    session.dispatchKey('DOWN');
  }

  assert.match(session.output(), /Card 19|Card 20|Card 21/, `expected keyboard arrows to scroll the real focused board list, got:\n${visibleLines(session.output()).join('\n')}`);
  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 19});
  assert.equal(session.state().board.overlay, null);
  assert.match(session.output(), /›/);
  session.destroy();
});

test('Board hace scroll por teclado en List sin seleccion visible ni seleccion de app', async () => {
  const Ui = require(uiModulePath);
  const cards = Array.from({length: 30}, (_, index) => ({title: `Card ${index + 1}`, position: index + 1}));
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: cards.length, cards, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  assert.equal(session.focus('board-card-list-1'), true, 'expected first column card list to be focusable for Valyrian List scrolling');

  for (let index = 0; index < 18; index += 1) {
    session.dispatchKey('DOWN');
  }

  assert.match(session.output(), /Card 19|Card 20|Card 21/, `expected keyboard navigation to move the virtualized List viewport, got:
${visibleLines(session.output()).join('\n')}`);
  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 19});
  assert.equal(session.state().board.overlay, null);
  assert.match(session.output(), /›/);
  assert.doesNotMatch(
    session.ansiOutput(),
    /\x1b\[48;2;(46;52;64|59;66;82|43;49;55)m.*Card/,
    'expected keyboard scroll to avoid visible selected/current/hover backgrounds'
  );
  session.destroy();
});

test('Board mueve viewport por rueda sin cambiar seleccion de app', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const cards = Array.from({length: 30}, (_, index) => ({title: `Card ${index + 1}`, position: index + 1}));
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: cards.length, cards, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  try {
    assert.equal(session.focus('board-card-list-1'), true);
    wheelDownVisibleText(stdin, session, 'Card 1');
    await new Promise(resolve => queueMicrotask(resolve));

    assert.match(session.output(), /• Card 2/);
    assert.doesNotMatch(session.output(), /› Card 2/);
  } finally {
    session.destroy();
  }
});

test('Board no selecciona otra card cuando la rueda mueve viewport dentro de una card envuelta', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const cards = [
    {
      title: 'Card 1 con titulo deliberadamente largo para envolver varias lineas dentro de la columna',
      position: 1
    },
    {title: 'Card 2 no debe quedar seleccionada por offset visual', position: 2},
    ...Array.from({length: 28}, (_, index) => ({title: `Card ${index + 3}`, position: index + 3}))
  ];
  const appState = {activeTab: 'Board', board: {selectedCard: {columnIndex: 1, position: 1}}};
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: appState,
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: cards.length, cards, remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  try {
    assert.equal(session.focus('board-card-list-1'), true);
    assert.match(session.output(), /Card 1 con titulo/);

    wheelDownVisibleText(stdin, session, 'Card 1 con titulo');
    await new Promise(resolve => queueMicrotask(resolve));

    assert.doesNotMatch(
      session.output(),
      /› Card 2 no debe quedar seleccionada/,
      `expected wrapped viewport scroll not to move the visual selection marker to Card 2, got:\n${visibleLines(session.output()).join('\n')}`
    );
    assert.deepEqual(
      appState.board.selectedCard,
      {columnIndex: 1, position: 1},
      'expected viewport line offset from a wrapped card not to select a different card'
    );
  } finally {
    session.destroy();
  }
});


test('Board selecciona por teclado la card activa aunque el listado tenga titulos duplicados', async () => {
  const Ui = require(uiModulePath);
  const cards = Array.from({length: 30}, (_, index) => ({title: 'Duplicate', position: index + 1}));
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: cards.length, cards, remaining: 0},
          {index: 2, title: 'Done', count: 0, cards: [], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  assert.equal(session.focus('board-card-list-1'), true, 'expected first column card list to be focusable as a pointer scroll container');

  for (let index = 0; index < 5; index += 1) {
    session.dispatchKey('DOWN');
  }

  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 6});
  session.dispatchKey('ENTER');
  assert.equal(session.state().board.overlay, null);
  assert.match(session.output(), /Duplicate/);
  session.destroy();
});

test('Board hace scroll del listado por rueda y mantiene header visible', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const cards = Array.from({length: 18}, (_, index) => ({title: `Card ${index + 1}`, position: index + 1}));
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: cards.length,
        columns: [
          {index: 1, title: 'Backlog', count: cards.length, cards, remaining: 0},
          {index: 2, title: 'Done', count: 0, cards: [], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  for (let index = 0; index < 18; index += 1) {
    wheelDownVisibleText(stdin, session, 'Card 1');
  }

  const lines = visibleLines(session.output());

  assert.ok(lines.some(line => /Backlog/.test(line) && /Done/.test(line)), `expected column headers to stay visible after list scroll, got:
${lines.join('\n')}`);
  assert.match(session.output(), /Card 16|Card 17|Card 18/, `expected wheel scroll to reach later cards, got:
${lines.join('\n')}`);
  assert.doesNotMatch(session.output(), /\+\d+ more cards/i);
  session.destroy();
});

test('Board selecciona card con click simple y abre detalle con doble click', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const appState = {activeTab: 'Board'};
  const session = await Ui.mountInteractiveSession({
    stdin,
    stdout,
    cols: 80,
    rows: 24,
    state: appState,
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        totalCards: 2,
        columns: [
          {index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', position: 1}], remaining: 0},
          {index: 2, title: 'Doing', count: 1, cards: [{title: 'Wire UI', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  assert.ok(
    visibleLines(session.output()).some(line => /Backlog/.test(line) && /Doing/.test(line)),
    'expected columns to render horizontally before testing hitboxes'
  );

  try {
    doublePressVisibleText(stdin, session, 'Doing');
    assert.match(session.output(), /Column: Doing/);

    session.click('board-column-details-close');
    assert.doesNotMatch(session.output(), /Column: Doing/);

    pressVisibleText(stdin, session, 'Wire UI');
    await new Promise(resolve => queueMicrotask(resolve));
    assert.match(session.output(), /› Wire UI/);
    assert.doesNotMatch(session.output(), /Doing \| Wire UI/);

    doublePressVisibleText(stdin, session, 'Wire UI');
    await new Promise(resolve => queueMicrotask(resolve));
    assert.match(session.output(), /Doing \| Wire UI/);
  } finally {
    session.destroy();
  }
});

test('Board horizontal permanece dentro de 80x24 con action bar y footer fijos', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Board',
        totalCards: 7,
        columns: [
          {index: 1, title: 'Backlog with long title', count: 3, wipLimit: 5, cards: [{title: 'One long card that must not overdraw', position: 1}, {title: 'Two', position: 2}], remaining: 1},
          {index: 2, title: 'Doing', count: 3, cards: [{title: 'Three', position: 1}, {title: 'Four', position: 2}], remaining: 1},
          {index: 3, title: 'Done', count: 1, cards: [{title: 'Five', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  try {
    const output = session.output();
    const lines = visibleLines(output);
    const footerIndex = lines.findLastIndex(line => /Ctrl\+C: Exit/.test(line));
    const actionIndex = lines.findLastIndex(line => /Add card/.test(line) && /Add column/.test(line));

    assert.equal(lines.length, 24, 'expected output to fill the visible 80x24 frame');
    assert.equal(lines.filter(line => line.length > 80).length, 0);
    assert.doesNotMatch(output, /Backlog with long title/);
    assert.ok(lines.some(line => /\(3\/5\)/.test(line) && /Doing/.test(line) && /Done/.test(line)), 'expected horizontal columns with safe fixed-width headers');
    assert.ok(actionIndex >= 0, 'expected Board action bar');
    assert.equal(actionIndex, footerIndex - 1, 'expected Board actions immediately above footer');
    assert.match(lines.at(-1), /Ctrl\+C: Exit/);
  } finally {
    session.destroy();
  }
});

test('Board column header omite titulos que no caben completos en una linea fija', () => {
  const {formatBoardColumnHeader} = require(path.join(repoRoot, 'ui', 'pages', 'board', 'BoardColumn.tsx'));
  const width = 8;
  const title = 'Column title that cannot fit inside the fixed header';
  const label = formatBoardColumnHeader({title, count: 12, cards: []}, width);

  assert.equal(label.length <= width, true, `expected header label to fit ${width} cells, got ${label.length}: ${label}`);
  assert.doesNotMatch(label, /Column title|cannot fit|fixed header/);
  assert.match(label, /\(12\)/);
});

test('Board no renderiza titulos largos de columna en headers fijos cuando no caben completos', async () => {
  const Ui = require(uiModulePath);
  const longTitle = 'Column title that cannot fit inside the fixed header';
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Board',
        totalCards: 14,
        columns: [
          {index: 1, title: longTitle, count: 12, cards: [{title: 'Visible card', position: 1}], remaining: 0},
          {index: 2, title: 'Doing', count: 1, cards: [{title: 'Second card', position: 1}], remaining: 0},
          {index: 3, title: 'Done', count: 1, cards: [{title: 'Third card', position: 1}], remaining: 0}
        ],
        remainingColumns: 0
      }
    })
  });

  try {
    const output = session.output();
    const lines = visibleLines(output);

    assert.doesNotMatch(output, /Column title|cannot fit|fixed header/);
    assert.match(output, /\(12\)/);
    assert.match(output, /Visible card/);
    assert.equal(lines.filter(line => line.length > 80).length, 0);
    assert.ok(lines.length <= 24, `expected Board output within 24 rows, got ${lines.length}`);
  } finally {
    session.destroy();
  }
});


test('Esc cierra overlay de Board solo cuando Board esta activo', async () => {
  const Ui = require(uiModulePath);

  const activeSession = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: richSnapshot()});

  activeSession.click('board-add-card');
  activeSession.dispatchKey('ESCAPE');

  assert.equal(activeSession.state().board.overlay, null);
  assert.equal(activeSession.state().running, true);
  assert.doesNotMatch(activeSession.output(), /Description/);
  activeSession.destroy();

  const hiddenSession = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: richSnapshot()});

  hiddenSession.click('board-add-card');
  hiddenSession.dispatchKey('CTRL_2');
  hiddenSession.dispatchKey('ESCAPE');

  assert.equal(hiddenSession.state().activeTab, 'Notes');
  assert.equal(hiddenSession.state().board.overlay, null);
  assert.equal(hiddenSession.state().running, true);
  assert.doesNotMatch(hiddenSession.output(), /Description/);
  hiddenSession.destroy();
});

test('Board overlay abierto no se renderiza despues de cambiar a otra tab', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: richSnapshot()});

  session.click('board-add-card');
  assert.equal(session.state().board.overlay, 'add-card');
  assert.match(session.output(), /Description/);

  session.dispatchKey('CTRL_2');

  assert.equal(session.state().activeTab, 'Notes');
  assert.equal(session.state().board.overlay, null);
  assert.match(session.output(), /Threat model/);
  assert.doesNotMatch(session.output(), /Description/);
  assert.doesNotMatch(session.output(), /Save/);
  session.destroy();
});

test('Headless semantic click fallback respeta trapFocus cuando hay overlay activo', async () => {
  const Ui = require(uiModulePath);

  const tabSession = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: richSnapshot()});

  tabSession.click('board-add-card');
  assert.equal(tabSession.state().board.overlay, 'add-card');

  tabSession.click('tab-notes');

  assert.equal(tabSession.state().activeTab, 'Board');
  assert.equal(tabSession.state().board.overlay, 'add-card');
  assert.match(tabSession.output(), /Description/);
  assert.doesNotMatch(tabSession.output(), /Threat model/);
  tabSession.destroy();

  const actionSession = await Ui.createHeadlessSession({
    state: {
      activeTab: 'Board',
      board: {overlay: 'card-details', selectedCard: {columnIndex: 1, position: 1}}
    },
    snapshot: realBoardSnapshot()
  });

  assert.equal(actionSession.state().board.overlay, 'card-details');

  actionSession.click('board-add-card');

  assert.equal(actionSession.state().board.overlay, 'card-details');
  assert.doesNotMatch(actionSession.output(), /Description/);
  actionSession.destroy();
});

test('Board Add card button opens themed modal and focuses title input', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: richSnapshot()});

  session.click('board-add-card');

  assert.equal(session.state().board.overlay, 'add-card');
  assert.match(session.output(), /Add card/);
  assert.match(session.output(), /Title/);
  assert.match(session.output(), /Description/);
  assert.match(session.output(), /Save/);
  assert.match(session.output(), /Cancel/);
  assert.equal(session.focusedId(), 'board-add-title');
  assert.match(session.ansiOutput(), /\x1b\[48;2;/);
  session.destroy();
});

test('Board Add card saves title and editor description, refreshes snapshot, and closes modal', async () => {
  const Ui = require(uiModulePath);
  const cards = [];
  const calls = [];
  const boardActions = {
    addCard(values) {
      calls.push(values);
      cards.push(values.title);
      return {ok: true};
    }
  };
  const buildSnapshot = () => baseSnapshot({
    board: {
      title: 'Launch board',
      totalCards: cards.length,
      columns: [{title: 'Backlog', count: cards.length, cards: [...cards]}]
    }
  });

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, buildSnapshot, boardActions});

  session.click('board-add-card');
  session.dispatchText('Ship card');
  session.focus('board-add-description');
  session.dispatchText('Needs polish');
  session.click('board-add-save');

  assert.deepEqual(calls, [{title: 'Ship card', description: 'Needs polish'}]);
  assert.equal(session.state().board.overlay, null);
  assert.match(session.output(), /Ship card/);
  assert.doesNotMatch(session.output(), /Card title/);
  session.destroy();
});

test('Board Add card description Shift+Enter inserts a newline without saving', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    addCard(values) {
      calls.push(values);
      return {ok: true};
    }
  };

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: richSnapshot(), boardActions});

  session.click('board-add-card');
  session.dispatchText('Ship card');
  session.focus('board-add-description');
  session.dispatchText('Line one');
  session.dispatchKey('SHIFT_ENTER');
  session.dispatchText('Line two');

  assert.deepEqual(calls, []);
  assert.equal(session.state().board.overlay, 'add-card');
  assert.equal(session.state().board.addCard.description, 'Line one\nLine two');
  session.destroy();
});

test('Board Add card description handles bracketed paste as editor text', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: richSnapshot()});

  try {
    session.click('board-add-card');
    session.focus('board-add-description');
    session.dispatchText('\x1b[200~Line one\nLine two\x1b[201~');

    assert.equal(session.state().board.addCard.description, 'Line one\nLine two');
    assert.doesNotMatch(session.state().board.addCard.description, /\[200~|\[201~/);
  } finally {
    session.destroy();
  }
});

test('Board Add card title handles bracketed paste as input text without submitting', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    addCard(values) {
      calls.push(values);
      return {ok: true};
    }
  };

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: richSnapshot(), boardActions});

  try {
    session.click('board-add-card');
    session.focus('board-add-title');
    session.dispatchText('\x1b[200~Line one\nLine two\x1b[201~');

    assert.equal(session.state().board.addCard.title, 'Line one\nLine two');
    assert.doesNotMatch(session.state().board.addCard.title, /\[200~|\[201~/);
    assert.equal(session.state().board.overlay, 'add-card');
    assert.deepEqual(calls, []);
  } finally {
    session.destroy();
  }
});

test('Board Add card title ignores incomplete bracketed paste instead of leaking control text', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: richSnapshot()});

  try {
    session.click('board-add-card');
    session.focus('board-add-title');
    session.dispatchText('\x1b[200~Half pasted title');

    assert.equal(session.state().board.addCard.title, '');
    assert.doesNotMatch(session.output(), /\[200~|Half pasted title/);
  } finally {
    session.destroy();
  }
});

test('Board ignores bracketed paste when focus is not a text entry', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: richSnapshot()});

  try {
    assert.equal(session.focus('board-card-list-1'), true);
    session.dispatchText('\x1b[200~Injected text\x1b[201~');

    assert.equal(session.state().board.overlay, null);
    assert.deepEqual(session.state().board.selectedCard, null);
    assert.doesNotMatch(session.output(), /Injected text/);
  } finally {
    session.destroy();
  }
});

test('Board Add card cancel closes modal without mutation', async () => {
  const Ui = require(uiModulePath);
  let called = false;
  const boardActions = {
    addCard() {
      called = true;
      return {ok: true};
    }
  };

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: realBoardSnapshot(), boardActions});

  session.click('board-add-card');
  session.dispatchText('Do not save');
  session.click('board-add-cancel');

  assert.equal(called, false);
  assert.equal(session.state().board.overlay, null);
  assert.doesNotMatch(session.output(), /Do not save/);
  session.destroy();
});

test('Board Add card validates empty title and keeps modal open', async () => {
  const Ui = require(uiModulePath);
  let called = false;
  const boardActions = {
    addCard() {
      called = true;
      return {ok: true};
    }
  };

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: realBoardSnapshot(), boardActions});

  session.click('board-add-card');
  session.click('board-add-save');

  assert.equal(called, false);
  assert.equal(session.state().board.overlay, 'add-card');
  assert.match(session.output(), /Title is required\./);
  session.destroy();
});

test('Board Add card model error keeps modal open and does not refresh as success', async () => {
  const Ui = require(uiModulePath);
  let refreshes = 0;
  const boardActions = {
    addCard() {
      return {ok: false, error: 'Choose a board before adding a card.'};
    }
  };
  const buildSnapshot = () => {
    refreshes += 1;
    return richSnapshot();
  };

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, buildSnapshot, boardActions});

  session.click('board-add-card');
  session.dispatchText('Blocked card');
  session.click('board-add-save');

  assert.equal(session.state().board.overlay, 'add-card');
  assert.match(session.output(), /Choose a board before adding a card\./);
  assert.equal(refreshes, 1);
  session.destroy();
});

test('Board Add card modal uses 10 percent margin and fills the overlay surface in 80x24', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Board', board: {overlay: 'column-details'}}, snapshot: richSnapshot()});

  session.click('board-add-card');
  const lines = visibleLines(session.output());
  const titleIndex = lines.findIndex(line => line.includes('Add card') && !line.includes('Columns'));
  const borderIndex = lines.findIndex(line => line.includes('┌──────────────────────────────────────────────────────────────┐'));
  const bottomIndex = lines.findIndex(line => line.includes('└──────────────────────────────────────────────────────────────┘'));
  const borderColumn = lines[borderIndex]?.indexOf('┌──────────────────────────────────────────────────────────────┐') ?? -1;
  const rightBorderColumn = borderColumn + 63;

  assert.equal(borderIndex, 2, `expected Add card overlay surface to respect 10% vertical margin, got:
${lines.join('\n')}`);
  assert.equal(borderColumn, 8, `expected Add card overlay surface to respect 10% horizontal margin, got:
${lines.join('\n')}`);
  assert.equal(bottomIndex, 21, `expected Add card overlay surface to fill overlay height, got:
${lines.join('\n')}`);
  assert.ok(titleIndex > borderIndex, 'expected Add card title inside the overlay surface');

  for (let index = borderIndex + 1; index < bottomIndex; index += 1) {
    assert.equal(lines[index][borderColumn], '│', `expected left surface edge on row ${index + 1}`);
    assert.equal(lines[index][rightBorderColumn], '│', `expected right surface edge on row ${index + 1}`);
  }

  session.destroy();
});


test('Board Add card modal limpia la superficie interna y no mezcla texto del Board', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Board'}, snapshot: richSnapshot()});

  session.click('board-add-card');
  const lines = visibleLines(session.output());
  const titleIndex = lines.findIndex(line => line.includes('Add card') && !line.includes('Columns'));
  const descriptionIndex = lines.findIndex(line => line.includes('Description'));

  assert.ok(titleIndex >= 0, `expected Add card overlay title, got:
${lines.join('\n')}`);
  assert.ok(descriptionIndex > titleIndex, `expected Description below title, got:
${lines.join('\n')}`);
  assert.match(lines[titleIndex], /Add card/);
  assert.doesNotMatch(lines[descriptionIndex], /Backlo|Write tests|Wire UI/);
  assert.doesNotMatch(lines[descriptionIndex + 1] || '', /Backlo|Write tests|Wire UI/);
  session.destroy();
});


test('Board Add card modal stays inside 80x24 with margin', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Board'}, snapshot: richSnapshot()});

  session.click('board-add-card');
  const lines = visibleLines(session.output());
  const overlayTop = lines.findIndex(line => line.includes('┌──────────────────────────────────────────────────────────────┐'));
  const overlayBottom = lines.findIndex(line => line.includes('└──────────────────────────────────────────────────────────────┘'));

  assert.ok(lines.length <= 24, `expected at most 24 lines, got ${lines.length}`);
  assert.equal(overlayTop, 2);
  assert.equal(overlayBottom, 21);
  assert.match(lines.at(-1), /Ctrl\+C: Exit/);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});


test('Board action bar is contextual, fixed above footer, and top nav stays global only', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Board'}, snapshot: richSnapshot()});
  const lines = visibleLines(session.output());
  const navLine = lines.find(line => /Todo/.test(line) && /Notes/.test(line) && /Board/.test(line) && /Clocks/.test(line));
  const footerIndex = lines.findLastIndex(line => /Ctrl\+C: Exit/.test(line));
  const actionIndex = lines.findLastIndex(line => /Add card/.test(line) && /Add column/.test(line));

  assert.ok(navLine, 'expected global top nav');
  assert.doesNotMatch(navLine, /Add card|Add column|Details|Priority|Columns|Remove/);
  assert.ok(actionIndex >= 0, 'expected Board action bar');
  assert.equal(actionIndex, footerIndex - 1, 'expected Board actions immediately above footer');
  assert.match(lines[actionIndex], /Add card/);
  assert.match(lines[actionIndex], /Add column/);
  assert.doesNotMatch(lines[actionIndex], /Details/);
  assert.doesNotMatch(lines[actionIndex], /Edit/);
  assert.doesNotMatch(lines[actionIndex], /Move/);
  assert.doesNotMatch(lines[actionIndex], /Priority/);
  assert.doesNotMatch(lines[actionIndex], /Remove/);
  session.destroy();
});

test('Board action bar mantiene solo acciones generales aunque haya card seleccionado', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Board', board: {selectedCard: {columnIndex: 1, position: 1}}}, snapshot: richSnapshot()});

  const lines = visibleLines(session.output());
  const actionIndex = lines.findLastIndex(line => /Add card/.test(line) && /Add column/.test(line));

  assert.ok(actionIndex >= 0, 'expected Board action bar');
  assert.match(lines[actionIndex], /Add card/);
  assert.match(lines[actionIndex], /Add column/);
  assert.doesNotMatch(lines[actionIndex], /Details/);
  assert.doesNotMatch(lines[actionIndex], /Edit/);
  assert.doesNotMatch(lines[actionIndex], /Move/);
  assert.doesNotMatch(lines[actionIndex], /Priority/);
  assert.doesNotMatch(lines[actionIndex], /Remove/);
  assert.equal(session.state().board.overlay, null);
  session.destroy();
});

test('Board-only action bar labels are hidden outside Board', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Todo'}, snapshot: richSnapshot()});
  const output = session.output();

  assert.doesNotMatch(output, /Priority/);
  assert.doesNotMatch(output, /Columns/);
  assert.doesNotMatch(output, /Add card/);
  session.destroy();
});

test('Board card actions stay hidden until a card is selected', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: richSnapshot()});
  const output = session.output();

  assert.doesNotMatch(output, /Details/);
  assert.doesNotMatch(output, /Edit/);
  assert.doesNotMatch(output, /Move/);
  assert.doesNotMatch(output, /Priority/);
  assert.doesNotMatch(output, /Remove/);
  assert.doesNotMatch(output, /secret|stack|undefined|null/i);
  session.destroy();
});

test('Board click simple de card selecciona sin abrir detalle', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: realBoardSnapshot()});

  clickVisibleText(session, 'Write tests');

  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 1});
  assert.equal(session.state().board.overlay, null);
  assert.match(session.output(), /› Write tests/);
  assert.doesNotMatch(session.output(), /\[object Object\]/);
  session.destroy();
});


test('Board Enter delegates focused card list press and selects without details', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: realBoardSnapshot()});

  assert.equal(session.focus('board-card-list-1'), true);
  session.dispatchKey('ENTER');

  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 1});
  assert.equal(session.state().board.overlay, null);
  assert.match(session.output(), /› Write tests/);
  session.destroy();
});


test('Board overlay de card agrupa acciones de card y Edit prellena titulo y descripcion', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}, overlay: 'card-details'}, snapshot: realBoardSnapshot()});

  assert.equal(session.state().board.overlay, 'card-details');
  assert.match(session.output(), /Edit/);
  assert.match(session.output(), /Move/);
  assert.match(session.output(), /Priority/);
  assert.match(session.output(), /Remove/);

  session.click('board-card-edit');

  assert.equal(session.state().board.overlay, 'edit-card');
  assert.deepEqual(session.state().board.editCard, {
    title: 'Write tests',
    description: 'Cover the card overlay flows',
    error: ''
  });
  assert.doesNotMatch(session.output(), /\[object Object\]/);
  session.destroy();
});



test('Board Edit card pins Save and Cancel to the overlay bottom and expands the description editor', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}, overlay: 'card-details'}, snapshot: realBoardSnapshot()});

  session.click('board-card-edit');

  const lines = visibleLines(session.output());
  const actionRow = lines.findIndex(line => /Save/.test(line) && /Cancel/.test(line));
  const descriptionLabelRow = lines.findIndex(line => /Description/.test(line));
  const internalBottomRow = 20;

  assert.notEqual(actionRow, -1, `expected Edit card action row:\n${lines.join('\n')}`);
  assert.equal(actionRow, internalBottomRow, `Edit card actions must render on the last internal overlay row:\n${lines.join('\n')}`);
  assert.ok(actionRow - descriptionLabelRow >= 8, `Edit card description editor must use available vertical space before actions:\n${lines.join('\n')}`);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});

test('Board Edit card description Shift+Enter inserts a newline without saving', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    editCard(values) {
      calls.push(values);
      return {ok: true};
    }
  };

  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}, overlay: 'card-details'},
    snapshot: realBoardSnapshot(),
    boardActions
  });

  session.click('board-card-edit');
  session.focus('board-edit-description');
  session.dispatchKey('SHIFT_ENTER');
  session.dispatchText('Second line');

  assert.deepEqual(calls, []);
  assert.equal(session.state().board.overlay, 'edit-card');
  assert.equal(session.state().board.editCard.description, 'Cover the card overlay flows\nSecond line');

  session.click('board-edit-save');

  assert.deepEqual(calls, [{
    columnIndex: 1,
    position: 1,
    title: 'Write tests',
    description: 'Cover the card overlay flows\nSecond line'
  }]);
  session.destroy();
});

test('Board overlay de card envuelve encabezado largo sin ellipsis antes de descripcion', async () => {
  const Ui = require(uiModulePath);
  const longTitle = 'Card title alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau';
  const snapshot = baseSnapshot({
    board: {
      title: 'Launch board',
      totalCards: 1,
      columns: [
        {
          index: 1,
          title: 'Backlog With A Deliberately Long Column Name',
          count: 1,
          cards: [{title: longTitle, description: 'Description stays below the wrapped heading', position: 1}],
          remaining: 0
        }
      ],
      remainingColumns: 0
    }
  });

  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}, overlay: 'card-details'}, snapshot});
  const output = session.output();
  const lines = visibleLines(output);
  const firstHeadingLineIndex = lines.findIndex(line => /Backlog With A Deliberately/.test(line));
  const finalHeadingLineIndex = lines.findIndex(line => /sigma tau\s+│/.test(line));
  const descriptionIndex = lines.findIndex(line => /Description stays below the wrapped heading/.test(line));
  const borderIndex = lines.findIndex((line, index) => index > firstHeadingLineIndex && /│ ─{10,}/.test(line));

  assert.doesNotMatch(output, /…|\.\.\./, 'expected wrapped card details heading without ellipsis');
  assert.ok(firstHeadingLineIndex >= 0, `expected first wrapped heading segment, got:
${lines.join('\n')}`);
  assert.ok(finalHeadingLineIndex > firstHeadingLineIndex, `expected heading to wrap across multiple lines, got:
${lines.join('\n')}`);
  assert.equal(borderIndex, finalHeadingLineIndex + 1, `expected bottom border after wrapped heading block, got:
${lines.join('\n')}`);
  assert.ok(descriptionIndex > borderIndex, `expected description below wrapped heading border, got:
${lines.join('\n')}`);
  assert.ok(lines.every(line => line.length <= 80), `expected no rendered line to exceed 80 columns, got:
${lines.join('\n')}`);

  session.destroy();
});

test('Board overlay de card muestra columna y titulo como encabezado sin labels viejos', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}, overlay: 'card-details'}, snapshot: realBoardSnapshot()});
  const lines = visibleLines(session.output());
  const headingIndex = lines.findIndex(line => /Backlog \| Write tests/.test(line));
  const descriptionIndex = lines.findIndex(line => /Cover the card overlay flows/.test(line));
  const actionIndex = lines.findIndex(line => /Edit/.test(line) && /Move/.test(line) && /Priority/.test(line) && /Remove/.test(line) && /Close/.test(line));

  assert.doesNotMatch(session.output(), /Card details/);
  assert.doesNotMatch(session.output(), /Column:/);
  assert.ok(headingIndex >= 0, `expected combined card heading, got:
${lines.join('\n')}`);
  assert.ok(descriptionIndex > headingIndex, `expected description below heading, got:
${lines.join('\n')}`);
  assert.ok(actionIndex >= 0, `expected card action row, got:
${lines.join('\n')}`);
  assert.ok(actionIndex - headingIndex >= 5, `expected actions near overlay bottom, got heading at ${headingIndex + 1} and actions at ${actionIndex + 1}:
${lines.join('\n')}`);
  assert.match(lines[headingIndex + 1] || '', /─/, `expected bottom border under card heading, got:
${lines.join('\n')}`);
  assert.match(session.output(), /┌|└|─/, 'expected visible overlay container chrome in plain output');
  assert.match(session.ansiOutput(), /\[48;2;17;17;17m/, 'expected overlay background ANSI surface');
  assert.match(session.ansiOutput(), /\[48;2;31;41;55m/, 'expected card details pane background ANSI surface');
  session.destroy();
});




test('Board column details pins column actions to the overlay bottom', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Board', board: {overlay: 'column-details'}}, snapshot: richSnapshot()});

  const lines = visibleLines(session.output());
  const actionRow = lines.findIndex(line => /Rename/.test(line) && /WIP/.test(line) && /Default/.test(line) && /Remove column/.test(line) && /Close/.test(line));

  assert.notEqual(actionRow, -1, `expected Board column details footer actions:\n${lines.join('\\n')}`);
  assert.equal(actionRow, 20, `Board column details actions must render on the last internal overlay row:\n${lines.join('\\n')}`);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});

test('Board column details scopes column actions to footer and excludes global actions', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board', board: {overlay: 'column-details'}}, snapshot: richSnapshot()});

  assert.equal(session.state().board.overlay, 'column-details');
  assert.deepEqual(session.state().board.selectedColumnIndex, 1);
  const overlayText = scopedOverlayLines(session.output(), /Column: Backlog/).join('\n');

  assert.doesNotMatch(overlayText, /Add column/);
  assert.doesNotMatch(overlayText, /Reset to default layout/);
  assert.match(overlayText, /Rename/);
  assert.doesNotMatch(overlayText, /Left/);
  assert.doesNotMatch(overlayText, /Right/);
  assert.match(overlayText, /WIP/);
  assert.match(overlayText, /Default/);
  assert.match(overlayText, /Remove column/);
  session.destroy();
});


test('Board column details empty state excludes global column layout actions', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board', board: {overlay: 'column-details'}}, snapshot: baseSnapshot()});

  assert.equal(session.state().board.overlay, 'column-details');

  const overlayText = scopedOverlayLines(session.output(), /No columns yet/).join('\n');

  assert.match(overlayText, /Columns/);
  assert.match(overlayText, /No columns yet\./);
  assert.doesNotMatch(overlayText, /Add column/);
  assert.doesNotMatch(overlayText, /Reset to default layout/);
  assert.doesNotMatch(overlayText, /Choose a column first/);
  assert.match(overlayText, /Close/);
  session.destroy();
});

test('Board Remove column explains plural cards must be removed first', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board', board: {overlay: 'column-details', selectedColumnIndex: 1}}, snapshot: richSnapshot()});
  session.click('board-remove-column');

  assert.equal(session.state().board.overlay, 'card-action-error');
  assert.match(session.output(), /Move cards out of this column before removing it\./);
  assert.doesNotMatch(session.output(), /model/i);
  session.destroy();
});

test('Board Remove column explains singular card must be removed first', async () => {
  const Ui = require(uiModulePath);
  const snapshot = richSnapshot();
  snapshot.board = {
    ...snapshot.board,
    totalCards: 1,
    columns: [{title: 'Backlog', count: 1, cards: ['Write tests']}]
  };

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board', board: {overlay: 'column-details', selectedColumnIndex: 1}}, snapshot});
  session.click('board-remove-column');

  assert.equal(session.state().board.overlay, 'card-action-error');
  assert.match(session.output(), /Move cards out of this column before removing it\./);
  session.destroy();
});



test('Board overlay remove-card-confirm usa copy destructivo consistente', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}, overlay: 'remove-card-confirm'}, snapshot: realBoardSnapshot()});

  assert.equal(session.state().board.overlay, 'remove-card-confirm');
  assert.match(session.output(), /Delete card/);
  assert.match(session.output(), /This cannot be undone\./);
  assert.doesNotMatch(session.output(), /Remove "Write tests"\?/);
  assert.match(session.ansiOutput(), /\x1b\[48;2;143;29;44m\s*Delete card\s*\x1b\[49m/);
  session.destroy();
});


test('Board Remove dentro del overlay requiere armado y segundo click para eliminar card', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    removeCard(values) {
      calls.push(values);
      return {ok: true};
    }
  };

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}, overlay: 'card-details'}, snapshot: realBoardSnapshot(), boardActions});

  assert.equal(session.state().board.overlay, 'card-details');
  assert.equal(calls.length, 0);

  session.click('board-card-remove');

  assert.equal(session.state().board.overlay, 'card-details');
  assert.equal(calls.length, 0);
  assert.match(session.output(), /Select Delete card to confirm\./);
  assert.doesNotMatch(session.output(), /Select Remove again to delete this card\./);
  assert.match(session.output(), /Delete card/);

  assert.match(session.ansiOutput(), /\x1b\[48;2;143;29;44m\s*Delete card\s*\x1b\[49m/);

  session.click('board-card-remove');

  assert.deepEqual(calls, [{columnIndex: 1, position: 1}]);
  assert.equal(session.state().board.overlay, null);
  session.destroy();
});


test('Board CTRL_C limpia el armado stale de Remove al cerrar detalles', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}, overlay: 'card-details'}, snapshot: realBoardSnapshot()});
  session.click('board-card-remove');

  assert.equal(session.state().board.overlay, 'card-details');
  assert.deepEqual(session.state().board.removeCardArmedSelection, {columnIndex: 1, position: 1});
  assert.ok(session.state().board.removeCardArmedUntil > Date.now());

  session.dispatchKey('CTRL_C');

  assert.equal(session.state().board.overlay, null);
  assert.equal(session.state().board.removeCardArmedUntil, 0);
  assert.equal(session.state().board.removeCardArmedSelection, null);
  session.destroy();
});


test('Board Close limpia el armado stale de Remove al cerrar detalles', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}, overlay: 'card-details'}, snapshot: realBoardSnapshot()});
  session.click('board-card-remove');

  assert.equal(session.state().board.overlay, 'card-details');
  assert.deepEqual(session.state().board.removeCardArmedSelection, {columnIndex: 1, position: 1});
  assert.ok(session.state().board.removeCardArmedUntil > Date.now());

  session.click('board-details-close');

  assert.equal(session.state().board.overlay, null);
  assert.equal(session.state().board.removeCardArmedUntil, 0);
  assert.equal(session.state().board.removeCardArmedSelection, null);
  session.destroy();
});


test('Board Escape cancela el armado de Remove dentro del overlay', async () => {
  const Ui = require(uiModulePath);
  let called = false;
  const boardActions = {
    removeCard() {
      called = true;
      return {ok: true};
    }
  };

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}, overlay: 'card-details'}, snapshot: realBoardSnapshot(), boardActions});

  session.click('board-card-remove');
  session.dispatchKey('CTRL_C');
  assert.equal(session.state().board.overlay, null);
  session.destroy();

  const nextSession = await Ui.createHeadlessSession({state: {activeTab: 'Board', selectedCard: {columnIndex: 1, position: 1}, overlay: 'card-details'}, snapshot: realBoardSnapshot(), boardActions});

  assert.equal(called, false);
  assert.equal(nextSession.state().board.overlay, 'card-details');
  assert.match(nextSession.output(), /Remove/);
  assert.doesNotMatch(nextSession.output(), /Confirm delete/);
  nextSession.destroy();
});

test('mountInteractiveSession pasa dimensiones seguras cuando el TTY reporta cero', async () => {
  const Ui = require(uiModulePath);
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  stdout.columns = 0;
  stdout.rows = 0;

  const session = await Ui.mountInteractiveSession({stdin, stdout, snapshot: richSnapshot()});

  assert.doesNotMatch(session.output(), /ilu/);
  assert.match(session.output(), /Todo/);
  session.destroy();
});

test('resolveLayoutOptions usa columns de stdout para sesiones interactivas sin cols explicito', () => {
  const Ui = require(uiModulePath);

  const layout = Ui.resolveLayoutOptions({stdout: {columns: 60}});

  assert.equal(layout.cols, 60);
  assert.equal(layout.rows, 24);
  assert.equal(Object.hasOwn(layout, 'panelHeight'), false);
});

test('App hides page overlays when switching to another app', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    state: {
      activeTab: 'Notes',
      todo: {overlay: 'add-task'},
      board: {overlay: 'board-details'},
      clocksState: {overlay: 'add-clock'}
    },
    snapshot: richSnapshot()
  });

  const output = stripAnsi(session.output());

  assert.match(output, /Threat model/);
  assert.doesNotMatch(output, /Add task/);
  assert.doesNotMatch(output, /Board: Launch board/);
  assert.doesNotMatch(output, /Add clock/);
  session.destroy();
});



test('Board action bar exposes Add board and removes legacy board manager action', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        id: 'launch',
        title: 'Launch board',
        boards: [
          {id: 'launch', title: 'Launch board', description: 'Ship', current: true},
          {id: 'ops', title: 'Ops board', description: 'Ops', current: false}
        ],
        totalCards: 0,
        columns: [{index: 1, id: 'backlog', title: 'Backlog', count: 0, cards: [], isDefault: true}],
        remainingColumns: 0
      }
    })
  });

  const lines = visibleLines(session.output());
  const navLine = lines.find(line => /Todo/.test(line) && /Notes/.test(line) && /Board/.test(line) && /Clocks/.test(line));
  const actionLine = lines.find(line => /Add card/.test(line) && /Add column/.test(line) && /Reset to default layout/.test(line) && /Add board/.test(line));

  assert.ok(navLine, 'expected top nav to remain global');
  assert.match(navLine, /Sync/);
  assert.match(navLine, /Translate/);
  assert.match(navLine, /Speech/);
  assert.doesNotMatch(navLine, /Tools|Babel|TTS/);
  assert.ok(actionLine, `expected Board action line with Add column, Reset to default layout, and Add board, got:\n${lines.join('\n')}`);
  assert.ok(actionLine.indexOf('Add column') < actionLine.indexOf('Reset to default layout'));
  assert.ok(actionLine.indexOf('Reset to default layout') < actionLine.indexOf('Add board'));
  assert.doesNotMatch(actionLine, /Boards|Tools/);

  session.click('board-add-board');

  assert.equal(session.state().board.overlay, 'add-board');
  assert.equal(session.focusedId(), 'board-add-board-title');
  session.destroy();
});

test('Board selector click changes board and double click opens board details', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    useBoard(values) {
      calls.push(['useBoard', values]);
      return {ok: true};
    }
  };
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();
  const snapshot = baseSnapshot({
    board: {
      id: 'launch',
      title: 'Launch board',
      boards: [
        {id: 'launch', title: 'Launch board', description: 'Ship', current: true},
        {id: 'ops', title: 'Ops board', description: 'Ops details', current: false}
      ],
      totalCards: 0,
      columns: [{index: 1, id: 'backlog', title: 'Backlog', count: 0, cards: [], isDefault: true}],
      remainingColumns: 0
    }
  });
  const session = await Ui.mountInteractiveSession({stdin, stdout, cols: 80, rows: 24, state: {activeTab: 'Board'}, snapshot, boardActions});

  pressVisibleText(stdin, session, 'Ops board');

  assert.deepEqual(calls, [['useBoard', {id: 'ops'}]]);
  assert.doesNotMatch(session.output(), /Board: Ops board/);

  doublePressVisibleText(stdin, session, 'Ops board');

  assert.match(session.output(), /Board: Ops board/);
  assert.match(session.output(), /Ops details/);
  assert.match(session.output(), /Rename/);
  assert.match(session.output(), /Delete board/);
  assert.match(session.output(), /Close/);
  assert.doesNotMatch(session.output(), /Selected board:|Switch to board|board-details/);
  session.destroy();
});

test('Board details reuses rename and delete board flows', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    renameBoard(values) {
      calls.push(['renameBoard', values]);
      return {ok: true};
    },
    removeBoard(values) {
      calls.push(['removeBoard', values]);
      return {ok: true};
    }
  };
  const snapshot = baseSnapshot({
    board: {
      id: 'launch',
      title: 'Launch board',
      boards: [
        {id: 'launch', title: 'Launch board', description: 'Ship', current: true},
        {id: 'ops', title: 'Ops board', description: 'Ops details', current: false}
      ],
      totalCards: 0,
      columns: [{index: 1, id: 'backlog', title: 'Backlog', count: 0, cards: [], isDefault: true}],
      remainingColumns: 0
    }
  });
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board', board: {overlay: 'board-details', selectedBoardId: 'ops'}}, snapshot, boardActions});

  session.click('board-rename-board');

  assert.equal(session.focusedId(), 'board-rename-board-title');
  assert.deepEqual(session.state().board.renameBoard, {title: 'Ops board', description: 'Ops details', error: ''});

  session.dispatchKey('CTRL_A');
  session.dispatchText('Ops v2');
  session.focus('board-rename-board-description');
  session.dispatchKey('CTRL_A');
  session.dispatchText('Ops next');
  session.click('board-rename-board-save');

  const removeSession = await Ui.createHeadlessSession({state: {activeTab: 'Board', board: {overlay: 'board-details', selectedBoardId: 'ops'}}, snapshot, boardActions});
  removeSession.click('board-delete-board');

  assert.equal(removeSession.state().board.overlay, 'remove-board-confirm');
  assert.match(removeSession.output(), /Delete board/);

  removeSession.click('board-remove-board-confirm');

  assert.deepEqual(calls, [
    ['renameBoard', {boardId: 'ops', title: 'Ops v2', description: 'Ops detailsOps next'}],
    ['removeBoard', {boardId: 'ops'}]
  ]);
  assert.equal(removeSession.state().board.overlay, null);
  removeSession.destroy();
  session.destroy();
});

test('Board current board CRUD changes reset stale card and column focus without board manager', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    addBoard(values) {
      calls.push(['addBoard', values]);
      return {ok: true};
    },
    removeBoard(values) {
      calls.push(['removeBoard', values]);
      return {ok: true};
    }
  };
  const snapshot = baseSnapshot({
    board: {
      id: 'launch',
      title: 'Launch board',
      boards: [
        {id: 'launch', title: 'Launch board', description: 'Ship', current: true},
        {id: 'ops', title: 'Ops board', description: 'Ops details', current: false}
      ],
      totalCards: 1,
      columns: [
        {index: 1, id: 'backlog', title: 'Backlog', count: 0, cards: [], isDefault: true},
        {index: 2, id: 'doing', title: 'Doing', count: 1, cards: [{title: 'Stale card', position: 1}], isDefault: false}
      ],
      remainingColumns: 0
    }
  });

  const addSession = await Ui.createHeadlessSession({
    state: {activeTab: 'Board', board: {selectedColumnIndex: 2, selectedCard: {columnIndex: 2, position: 1}}},
    snapshot,
    boardActions
  });

  addSession.click('board-add-board');
  addSession.dispatchText('Product board');
  addSession.click('board-add-board-save');

  assert.deepEqual(calls, [['addBoard', {title: 'Product board', description: ''}]]);
  assert.equal(addSession.state().board.overlay, null);
  assert.equal(addSession.state().board.selectedCard, null);
  assert.equal(addSession.state().board.selectedColumnIndex, 1);
  assert.equal(addSession.focusedId(), 'board-card-list-1');
  addSession.destroy();

  const removeSession = await Ui.createHeadlessSession({
    state: {activeTab: 'Board', board: {overlay: 'board-details', selectedBoardId: 'launch', selectedColumnIndex: 2, selectedCard: {columnIndex: 2, position: 1}}},
    snapshot,
    boardActions
  });

  removeSession.click('board-delete-board');
  removeSession.click('board-remove-board-confirm');

  assert.deepEqual(calls, [
    ['addBoard', {title: 'Product board', description: ''}],
    ['removeBoard', {boardId: 'launch'}]
  ]);
  assert.equal(removeSession.state().board.overlay, null);
  assert.equal(removeSession.state().board.selectedCard, null);
  assert.equal(removeSession.state().board.selectedColumnIndex, 1);
  assert.equal(removeSession.focusedId(), 'board-card-list-1');
  removeSession.destroy();
});

test('Board reset default columns is blocked with cards and confirmed on empty boards', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    resetDefaultColumns() {
      calls.push(['resetDefaultColumns']);
      return {ok: true};
    }
  };
  const blockedSession = await Ui.createHeadlessSession({
    state: {activeTab: 'Board'},
    snapshot: realBoardSnapshot(),
    boardActions
  });

  blockedSession.click('board-reset-default-columns');

  assert.equal(blockedSession.state().board.overlay, 'card-action-error');
  assert.match(blockedSession.output(), /Move or remove cards before resetting columns\./);
  assert.deepEqual(calls, []);
  blockedSession.destroy();

  const emptySession = await Ui.createHeadlessSession({
    state: {activeTab: 'Board'},
    snapshot: baseSnapshot({
      board: {
        title: 'Empty board',
        totalCards: 0,
        columns: [{index: 1, id: 'backlog', title: 'Backlog', count: 0, cards: [], isDefault: true}],
        remainingColumns: 0
      }
    }),
    boardActions
  });

  emptySession.click('board-reset-default-columns');

  assert.equal(emptySession.state().board.overlay, 'reset-columns-confirm');
  assert.match(emptySession.output(), /Reset columns to the default layout\?/);
  assert.match(emptySession.output(), /This only works on empty boards\./);

  emptySession.click('board-reset-columns-confirm');

  assert.deepEqual(calls, [['resetDefaultColumns']]);
  assert.equal(emptySession.state().board.overlay, null);
  emptySession.destroy();
});

test('Board WIP limit validates invalid input before model calls and accepts zero as no limit', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    setWipLimit(values) {
      calls.push(values);
      return {ok: true};
    }
  };
  const snapshot = baseSnapshot({
    board: {
      title: 'Launch board',
      totalCards: 0,
      columns: [{index: 1, id: 'backlog', title: 'Backlog', count: 0, cards: [], wipLimit: null, isDefault: true}],
      remainingColumns: 0
    }
  });
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board', board: {overlay: 'column-details', selectedColumnIndex: 1}}, snapshot, boardActions});

  session.click('board-set-wip-limit');
  session.dispatchText('-1');
  session.click('board-set-wip-save');

  assert.equal(session.state().board.overlay, 'set-wip-limit');
  assert.match(session.output(), /Choose a WIP limit of 0 or higher\./);
  assert.deepEqual(calls, []);

  session.focus('board-wip-limit');
  session.dispatchKey('CTRL_A');
  session.dispatchText('0');
  session.click('board-set-wip-save');

  assert.deepEqual(calls, [{columnIndex: 1, wipLimit: 0}]);
  assert.equal(session.state().board.overlay, null);
  session.destroy();
});

test('Board set default column and blocked remove use safe visible copy', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    setDefaultColumn(values) {
      calls.push(['setDefaultColumn', values]);
      return {ok: true};
    },
    removeColumn(values) {
      calls.push(['removeColumn', values]);
      return {ok: true};
    }
  };
  const snapshot = baseSnapshot({
    board: {
      title: 'Launch board',
      defaultColumnId: 'backlog',
      totalCards: 1,
      columns: [
        {index: 1, id: 'backlog', title: 'Backlog', count: 0, cards: [], isDefault: true},
        {index: 2, id: 'doing', title: 'Doing', count: 1, cards: [{title: 'Card', position: 1}], isDefault: false}
      ],
      remainingColumns: 0
    }
  });
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board', board: {overlay: 'column-details', selectedColumnIndex: 2}}, snapshot, boardActions});

  session.click('board-set-default-column');

  assert.deepEqual(calls, [['setDefaultColumn', {columnIndex: 2}]]);
  assert.equal(session.state().board.overlay, null);

  const removeSession = await Ui.createHeadlessSession({state: {activeTab: 'Board', board: {overlay: 'column-details', selectedColumnIndex: 2}}, snapshot, boardActions});
  removeSession.click('board-remove-column');

  assert.equal(removeSession.state().board.overlay, 'card-action-error');
  assert.match(removeSession.output(), /Move cards out of this column before removing it\./);
  assert.deepEqual(calls, [['setDefaultColumn', {columnIndex: 2}]]);
  removeSession.destroy();
  session.destroy();
});

test('Board blocks removing an empty default column before model calls', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    removeColumn(values) {
      calls.push(values);
      return {ok: true};
    }
  };
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Board', board: {overlay: 'column-details', selectedColumnIndex: 1}},
    snapshot: baseSnapshot({
      board: {
        title: 'Launch board',
        defaultColumnId: 'backlog',
        totalCards: 0,
        columns: [
          {index: 1, id: 'backlog', title: 'Backlog', count: 0, cards: [], isDefault: true},
          {index: 2, id: 'doing', title: 'Doing', count: 0, cards: [], isDefault: false}
        ],
        remainingColumns: 0
      }
    }),
    boardActions
  });

  session.click('board-remove-column');

  assert.equal(session.state().board.overlay, 'card-action-error');
  assert.match(session.output(), /Set another default column before removing this one\./);
  assert.deepEqual(calls, []);
  session.destroy();
});

test('Board column header LEFT and RIGHT reorder columns and keep header focus', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const boardActions = {
    moveColumnLeft(values) {
      calls.push(['left', values]);
      return {ok: true};
    },
    moveColumnRight(values) {
      calls.push(['right', values]);
      return {ok: true};
    }
  };
  const snapshot = baseSnapshot({
    board: {
      title: 'Launch board',
      totalCards: 0,
      columns: [
        {index: 1, id: 'backlog', title: 'Backlog', count: 0, cards: [], isDefault: true},
        {index: 2, id: 'doing', title: 'Doing', count: 0, cards: [], isDefault: false},
        {index: 3, id: 'done', title: 'Done', count: 0, cards: [], isDefault: false}
      ],
      remainingColumns: 0
    }
  });
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot, boardActions});

  session.focus('board-column-header-2');
  session.dispatchKey('LEFT');

  assert.deepEqual(calls, [['left', {columnIndex: 2}]]);
  assert.equal(session.state().board.selectedColumnIndex, 1);
  assert.equal(session.focusedId(), 'board-column-header-1');

  const rightSession = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot, boardActions});
  rightSession.focus('board-column-header-1');
  rightSession.dispatchKey('RIGHT');

  assert.deepEqual(calls, [
    ['left', {columnIndex: 2}],
    ['right', {columnIndex: 1}]
  ]);
  assert.equal(rightSession.state().board.selectedColumnIndex, 2);
  assert.equal(rightSession.focusedId(), 'board-column-header-2');
  rightSession.destroy();
  session.destroy();
});



test('a11y shell closes active page overlay when switching tabs by keyboard shortcut', async () => {
  const {createHeadlessSession} = require(uiModulePath);
  const session = await createHeadlessSession({snapshot: richSnapshot(), cols: 80, rows: 24});

  try {
    session.click('todo-add-task');
    assert.match(session.output(), /Add task/);

    session.dispatchKey('CTRL_2');

    assert.equal(session.state().activeTab, 'Notes');
    assert.equal(session.state().todo.overlay, null);
    assert.doesNotMatch(session.output(), /Task title/);
  } finally {
    await session.destroy();
  }
});

test('a11y overlay opening sets stable initial focus', async () => {
  const {createHeadlessSession} = require(uiModulePath);
  const session = await createHeadlessSession({snapshot: richSnapshot(), cols: 80, rows: 24});

  try {
    session.click('todo-add-task');
    assert.equal(session.focusedId(), 'todo-add-title');

    session.click('todo-add-cancel');
    session.click('tab-clocks');
    session.click('clock-add-open');
    assert.equal(session.focusedId(), 'clock-add-name');
  } finally {
    await session.destroy();
  }
});

test('a11y top nav groups apps and Sync as a global control', async () => {
  const {createHeadlessSession} = require(uiModulePath);
  const session = await createHeadlessSession({snapshot: richSnapshot(), cols: 80, rows: 24});

  try {
    const navLine = visibleLines(session.output()).find(line => /Todo/.test(line) && /Speech/.test(line));
    assert.ok(navLine, 'expected nav line with primary apps and utilities');
    assert.match(navLine, /Todo.*Notes.*Board.*Clocks.*Translate.*Speech/);
    assert.ok(navLine.indexOf('Speech') < navLine.indexOf('Sync'), `expected Sync after app group:\n${navLine}`);
    assert.doesNotMatch(navLine, /Tools/);
  } finally {
    await session.destroy();
  }
});

test('a11y Board Space and Enter select without destructive card actions', async () => {
  const {createHeadlessSession} = require(uiModulePath);
  const actions = {
    removeCard() {
      assert.fail('Space must not remove a board card');
    },
    moveCard() {
      assert.fail('Space must not move a board card');
    },
    prioritizeCard() {
      assert.fail('Space must not reprioritize a board card');
    }
  };
  const session = await createHeadlessSession({snapshot: realBoardSnapshot(), state: {activeTab: 'Board'}, boardActions: actions, cols: 80, rows: 24});

  try {
    assert.equal(session.focus('board-card-list-1'), true);
    session.dispatchKey('SPACE');
    assert.equal(session.state().board.overlay, null);

    session.dispatchKey('ENTER');
    assert.equal(session.state().board.overlay, null);
    assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 1});
    assert.match(session.output(), /› Write tests/);
  } finally {
    await session.destroy();
  }
});

test('a11y Board exposes keyboard shortcut for card and column details', async () => {
  const {createHeadlessSession} = require(uiModulePath);
  const session = await createHeadlessSession({snapshot: realBoardSnapshot(), state: {activeTab: 'Board'}, cols: 80, rows: 24});

  try {
    assert.equal(session.focus('board-card-list-1'), true);
    session.dispatchKey('ENTER');
    assert.equal(session.state().board.overlay, null);
    assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 1});

    session.dispatchKey('o');
    assert.equal(session.state().board.overlay, 'card-details');
    assert.equal(session.focusedId(), 'board-card-details-scroll');

    session.dispatchKey('ESCAPE');
    assert.equal(session.state().board.overlay, null);

    assert.equal(session.focus('board-column-header-1'), true);
    session.dispatchKey('ENTER');
    assert.equal(session.state().board.overlay, null);
    assert.equal(session.state().board.selectedColumnIndex, 1);

    session.dispatchKey('o');
    assert.equal(session.state().board.overlay, 'column-details');
    assert.equal(session.focusedId(), 'board-remove-column');

    session.dispatchKey('ESCAPE');
    session.dispatchKey('CTRL_K');
    assert.match(session.output(), /Use O to open card or column details/);
  } finally {
    await session.destroy();
  }
});
