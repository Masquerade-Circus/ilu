import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
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
} from './test-helpers/ui-app.ts';
const require = createRequire(import.meta.url);

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

test('Board selector renders null-id boards without dispatching unsafe board actions', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const snapshot = baseSnapshot({
    board: {
      id: null,
      title: 'Imported board',
      boards: [
        {id: null, title: 'Imported board', description: 'Needs id repair', current: true},
        {id: 'ops', title: 'Ops board', description: 'Ops details', current: false}
      ],
      totalCards: 0,
      columns: [{index: 1, title: 'Backlog', count: 0, cards: []}],
      remainingColumns: 0
    }
  });
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Board'},
    snapshot,
    boardActions: {
      useBoard(values) {
        calls.push(['useBoard', values]);
        return {ok: true};
      }
    }
  });

  session.click('board-switch-board-1');
  session.click('board-switch-ops');

  assert.deepEqual(calls, [['useBoard', {id: 'ops'}]]);
  assert.equal(session.state().board.overlay, null);
  assert.match(session.output(), /Imported board/);
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
