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

test('Board Add card description handles multi-line paste as editor text', async () => {
  const Ui = require(uiModulePath);

  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: richSnapshot()});

  try {
    session.click('board-add-card');
    session.focus('board-add-description');
    session.dispatchText('Line one\nLine two');

    assert.equal(session.state().board.addCard.description, 'Line one\nLine two');
  } finally {
    session.destroy();
  }
});

test('Board Add card title handles multi-line paste as input text without submitting', async () => {
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
    session.dispatchText('Line one\nLine two');

    assert.equal(session.state().board.addCard.title, 'Line one\nLine two');
    assert.equal(session.state().board.overlay, 'add-card');
    assert.deepEqual(calls, []);
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
