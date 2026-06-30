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

test('Board clickAt visible de card usa press semantico de List para seleccionar sin abrir detalles', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Board'}, snapshot: realBoardSnapshot()});

  clickVisibleText(session, 'Write tests');

  assert.deepEqual(session.state().board.selectedCard, {columnIndex: 1, position: 1});
  assert.equal(session.state().board.overlay, null);
  assert.match(session.output(), /› Write tests/);
  session.destroy();
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
    await new Promise<void>(resolve => queueMicrotask(resolve));

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
    await new Promise<void>(resolve => queueMicrotask(resolve));

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
    await new Promise<void>(resolve => queueMicrotask(resolve));
    assert.match(session.output(), /› Wire UI/);
    assert.doesNotMatch(session.output(), /Doing \| Wire UI/);

    doublePressVisibleText(stdin, session, 'Wire UI');
    await new Promise<void>(resolve => queueMicrotask(resolve));
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
  const {formatBoardColumnHeader} = require(path.join(repoRoot, 'ui', 'modules', 'board', 'BoardColumn.tsx'));
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

test('Board ignores multi-line paste when focus is not a text entry', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Board'}, snapshot: richSnapshot()});

  try {
    assert.equal(session.focus('board-card-list-1'), true);
    session.dispatchText('Injected text\nSecond line');

    assert.equal(session.state().board.overlay, null);
    assert.deepEqual(session.state().board.selectedCard, null);
    assert.doesNotMatch(session.output(), /Injected text/);
  } finally {
    session.destroy();
  }
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
