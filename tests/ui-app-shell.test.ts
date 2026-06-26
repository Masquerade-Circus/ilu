const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  repoRoot,
  uiModulePath,
  uiModuleRegistryPath,
  countWord,
  stripAnsi,
  visibleLines,
  terminalTitles,
  scopedOverlayLines,
  clickVisibleText,
  mousePrimaryPressSequence,
  mouseDragSequence,
  mouseWheelDownSequence,
  pressVisibleText,
  doublePressVisibleText,
  wheelDownVisibleText,
  firstVisibleCardTitle,
  baseSnapshot,
  richSnapshot,
  realBoardSnapshot,
  FakeStdin,
  FakeStdout,
  loadUiWithPatchedModules,
  loadUiWithSyncHook,
  boardSnapshotModels,
  orderedTextIndex,
} = require('./test-helpers/ui-app');

test('active editor renders only the active page factory', async () => {
  const counts = {todo: 0, notes: 0, clocks: 0, board: 0};

  await loadUiWithPatchedModules((request, parent, loaded) => {
    if (!parent || parent.filename !== uiModuleRegistryPath) {
      return loaded;
    }

    if (request === './modules/todos/MainView' || request === './modules/todos/MainView.tsx') {
      return {...loaded, createTodoMainView(options) { counts.todo += 1; return loaded.createTodoMainView(options); }};
    }

    if (request === './modules/notes/MainView' || request === './modules/notes/MainView.tsx') {
      return {...loaded, createNotesMainView(options) { counts.notes += 1; return loaded.createNotesMainView(options); }};
    }

    if (request === './modules/clocks/MainView' || request === './modules/clocks/MainView.tsx') {
      return {...loaded, createClocksMainView(options) { counts.clocks += 1; return loaded.createClocksMainView(options); }};
    }

    if (request === './modules/board/MainView' || request === './modules/board/MainView.tsx') {
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
    if ((request === './modules/todos/MainView' || request === './modules/todos/MainView.tsx') && parent && parent.filename === uiModuleRegistryPath) {
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
  const cases: any[] = [
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
  const cases: any[] = [
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

test('mountInteractiveSession updates Sync top nav after background board sync completes', async () => {
  let syncListener = null;
  const syncHook = function noopNotifySync() {};
  syncHook.onSyncStatus = (listener) => {
    syncListener = listener;
    return () => {
      syncListener = null;
    };
  };
  syncHook.flushPending = () => false;

  await loadUiWithSyncHook(syncHook, async (Ui) => {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const session = await Ui.mountInteractiveSession({stdin, stdout, snapshot: richSnapshot()});

    assert.equal(typeof syncListener, 'function');
    syncListener({state: 'pending', message: 'Sync pending', context: {domain: 'boards', action: 'save'}});
    assert.match(session.output(), /Sync pending/);

    syncListener({state: 'synced', message: 'Synced', context: {domain: 'boards', action: 'save'}});
    assert.match(session.output(), /Synced/);
    assert.doesNotMatch(session.output(), /Sync pending/);

    await session.destroy();
  });
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

  const cases: any[] = [
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

test('Ctrl+C in a focused input uses Valyrian copy and keeps the UI running', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: richSnapshot()});

  try {
    session.click('board-add-card');
    session.focus('board-add-title');
    for (const char of 'Ship card') {
      session.dispatchKey(char);
    }
    session.dispatchKey('CTRL_A');
    session.dispatchKey('CTRL_C');

    assert.equal(session.state().running, true);
    assert.equal(session.clipboard(), 'Ship card');
  } finally {
    session.destroy();
  }
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
    await new Promise<void>(resolve => queueMicrotask(resolve));

    const lines = visibleLines(session.output());
    const headerLine = lines.find(line => /Backlog/.test(line) && /Doing/.test(line) && /Done/.test(line));

    assert.equal(lines.length, 24, 'expected resized output to stay inside 60x24 frame');
    assert.equal(lines.filter(line => line.length > 60).length, 0);
    assert.ok(headerLine, `expected board to reflow useful column headers after resize, got:\n${lines.join('\n')}`);
  } finally {
    session.destroy();
  }
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

test('createHeadlessSession no selecciona Board cards por ids sinteticos fuera del runtime', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: realBoardSnapshot()});

  session.click('board-card-1-1');

  assert.equal(session.state().board.selectedCard, null);
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
