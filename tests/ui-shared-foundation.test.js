const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
process.env.TSX_TSCONFIG_PATH = path.join(repoRoot, 'tsconfig.ui.json');
require('tsx/cjs');

const uiModulePath = path.join(repoRoot, 'ui', 'app.tsx');

function stripAnsi(output) {
  return output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function visibleLines(output) {
  return stripAnsi(output).split(/\r?\n/);
}

function overlayContractFor(cols, rows) {
  const marginX = Math.round(cols * 0.1);
  const marginY = Math.round(rows * 0.1);

  return {
    x: marginX,
    y: marginY,
    width: cols - marginX * 2,
    height: rows - marginY * 2
  };
}

function normalizeRenderedLines(lines) {
  const normalizedLines = [...lines];

  while (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1].trimEnd() === '') {
    normalizedLines.pop();
  }

  return normalizedLines;
}

function assertFullSurfaceOverlay(lines, label, cols = 80, rows = 24) {
  const normalizedLines = normalizeRenderedLines(lines);
  const contract = overlayContractFor(cols, rows);
  const topLine = normalizedLines[contract.y] || '';
  const bottomLine = normalizedLines[contract.y + contract.height - 1] || '';
  const rightColumn = contract.x + contract.width - 1;

  assert.equal(normalizedLines.filter(line => line.length > cols).length, 0, `${label} must not render lines wider than ${cols}`);
  assert.ok(normalizedLines.length <= rows, `${label} must not render more than ${rows} rows`);
  assert.equal(topLine[contract.x], '┌', `${label} must start overlay surface at the 10 percent horizontal and vertical margin`);
  assert.equal(topLine[rightColumn], '┐', `${label} must end overlay top edge at the expected width`);
  assert.equal(bottomLine[contract.x], '└', `${label} must fill overlay surface height`);
  assert.equal(bottomLine[rightColumn], '┘', `${label} must end overlay bottom edge at the expected width`);

  for (let index = contract.y + 1; index < contract.y + contract.height - 1; index += 1) {
    assert.equal(normalizedLines[index]?.[contract.x], '│', `${label} must paint left surface edge on row ${index + 1}`);
    assert.equal(normalizedLines[index]?.[rightColumn], '│', `${label} must paint right surface edge on row ${index + 1}`);
  }
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

function failMutator(name) {
  return () => {
    throw new Error(`mutator ${name} should not be called`);
  };
}

test('shared action-result helper rejects unsafe raw error details', () => {
  const {createUiErrorResult, createUiSuccessResult} = require('../ui/action-results');

  const unsafe = new Error('provider failed at /home/user/.ssh/key with token=abc123\n    at internal stack');
  const failure = createUiErrorResult(unsafe, 'Something went wrong. Try again.');
  const success = createUiSuccessResult({id: 7, refreshed: true});

  assert.deepEqual(failure, {ok: false, error: 'Something went wrong. Try again.'});
  assert.deepEqual(success, {ok: true, id: 7, refreshed: true});
  assert.doesNotMatch(failure.error, /\/home|\.ssh|token|abc123|stack|provider/i);
});

test('utility launcher actions are removed because utility apps live in top nav', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot()});
  const lines = visibleLines(session.output());
  const navLine = lines.find(line => /Todo/.test(line) && /Notes/.test(line) && /Board/.test(line) && /Clocks/.test(line) && /Sync/.test(line) && /Translate/.test(line) && /Speech/.test(line));

  assert.ok(navLine, 'expected global top nav with utility apps');
  assert.match(navLine, /Todo.*Notes.*Board.*Clocks.*Translate.*Speech/);
  assert.ok(navLine.indexOf('Speech') < navLine.indexOf('Sync'), `expected Sync after app group:\n${navLine}`);
  assert.doesNotMatch(session.output(), /\bTools\b|Choose a tool\./);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});

test('top nav leaves one visual row before the active panel', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot()});
  const output = session.output();
  session.destroy();

  const lines = visibleLines(output);
  const navIndex = lines.findIndex(line => /Todo/.test(line) && /Notes/.test(line) && /Board/.test(line) && /Clocks/.test(line) && /Sync/.test(line) && /Translate/.test(line) && /Speech/.test(line));

  assert.ok(navIndex >= 0, `expected global top nav:
${lines.join('\n')}`);
  assert.equal(lines[navIndex + 1]?.trim(), '', `expected one blank visual row below top nav:
${lines.join('\n')}`);
  assert.ok(normalizeRenderedLines(lines).length <= 24, 'layout must stay within 24 rows');
  assert.equal(lines.filter(line => line.length > 80).length, 0);
});

test('board action bar keeps board actions without utility launcher noise', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Board'}, snapshot: baseSnapshot()});
  const lines = visibleLines(session.output());
  const actionLine = lines.findLast(line => /Add card/.test(line) && /Add column/.test(line));

  assert.ok(actionLine, `expected Board actions in shared action bar:\n${lines.join('\n')}`);
  assert.doesNotMatch(actionLine, /\bTools\b/);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});

test('utility app surfaces use approved app wording without tool overlay copy', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot()});

  session.click('tab-sync');
  assert.match(session.output(), /Sync/);
  assert.match(session.output(), /Set up sync/);

  session.click('tab-translate');
  assert.match(session.output(), /Translate/);
  assert.match(session.output(), /Text to translate/);

  session.click('tab-speech');
  assert.match(session.output(), /Text to Speech/);
  assert.match(session.output(), /Create audio/);
  assert.doesNotMatch(session.output(), /\bTools\b|Choose a tool\./);
  session.destroy();
});

test('utility secondary overlays close before app exit', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Sync'}, snapshot: baseSnapshot()});

  session.click('sync-setup');

  assert.equal(session.state().utilities.activeOverlay, 'sync-init');
  assert.match(session.output(), /Remote URL/);

  session.dispatchKey('CTRL_C');

  assert.equal(session.state().utilities.activeOverlay, null);
  assert.equal(session.state().running, true);
  assert.doesNotMatch(session.output(), /Remote URL/);

  session.click('sync-setup');
  session.dispatchKey('ESCAPE');

  assert.equal(session.state().utilities.activeOverlay, null);
  assert.equal(session.state().running, true);
  session.destroy();
});
test('Board, Todo details, and utility overlays fill the 80x24 surface without overdraw', async () => {
  const Ui = require(uiModulePath);

  const boardSession = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Board'}, snapshot: baseSnapshot({
    board: {
      title: 'Launch board',
      totalCards: 1,
      columns: [{index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', description: '', position: 1}], remaining: 0}],
      remainingColumns: 0
    }
  })});

  boardSession.click('board-add-card');
  assertFullSurfaceOverlay(visibleLines(boardSession.output()), 'Board Add card overlay');
  boardSession.destroy();

  const todoSession = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Todo', todo: {selectedTaskPosition: 1, overlay: 'task-details'}}, snapshot: baseSnapshot({
    todo: {
      title: 'Today',
      currentListId: 1,
      lists: [{id: 1, title: 'Today', current: true}],
      items: [{id: 1, position: 1, text: 'Review Todo details', description: 'Keep the overlay inside the 80x24 surface', done: false, labels: ['ui']}],
      remaining: 0
    }
  })});

  assertFullSurfaceOverlay(visibleLines(todoSession.output()), 'Todo details overlay');
  todoSession.destroy();

  const utilitySession = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Sync'}, snapshot: baseSnapshot()});

  utilitySession.click('sync-setup');
  assertFullSurfaceOverlay(visibleLines(utilitySession.output()), 'Sync setup overlay');
  utilitySession.destroy();
});



test('Board overlays keep the base board panel mounted by default', () => {
  const {createBoardMainView, createInitialBoardState} = require('../ui/pages/board/MainView.tsx');
  const board = {
    id: 'launch',
    title: 'Launch board',
    totalCards: 1,
    boards: [{id: 'launch', title: 'Launch board', current: true}],
    columns: [{index: 1, title: 'Backlog', count: 1, cards: [{title: 'Write tests', description: '', position: 1}], remaining: 0}],
    remainingColumns: 0
  };
  const overlays = [
    'add-card',
    'card-action-error',
    'card-details',
    'edit-card',
    'move-card',
    'priority-card',
    'remove-card-confirm',
    'column-details',
    'add-column',
    'rename-column',
    'add-board',
    'rename-board',
    'remove-board-confirm',
    'set-wip-limit',
    'reset-columns-confirm'
  ].map((overlay) => ({
    name: overlay,
    state: createInitialBoardState({
      overlay,
      selectedBoardId: 'launch',
      selectedCard: {columnIndex: 1, position: 1},
      selectedColumnIndex: 1
    })
  }));

  for (const overlay of overlays) {
    const view = createBoardMainView({
      board,
      state: overlay.state,
      isActive: true,
      width: 80,
      panelHeight: 17,
      boardActions: {},
      refreshSnapshot: () => {}
    });

    assert.ok(view.activePanelNodes.length > 1, `${overlay.name} must keep board selector and columns mounted`);
  }
});

test('Todo details overlay pins its action row to the internal bottom nav row', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Todo', todo: {selectedTaskPosition: 1, overlay: 'task-details'}}, snapshot: baseSnapshot({
    todo: {
      title: 'Today',
      currentListId: 1,
      lists: [{id: 1, title: 'Today', current: true}],
      items: [{id: 1, position: 1, text: 'Review Todo details', description: 'Keep the overlay inside the 80x24 surface', done: false, labels: ['ui']}],
      remaining: 0
    }
  })});
  const lines = visibleLines(session.output());
  const contract = overlayContractFor(80, 24);
  const internalBottomRow = contract.y + contract.height - 2;
  const actionRow = lines.findIndex(line => /Edit task/.test(line) && /Mark done/.test(line) && /Remove task/.test(line) && /Close/.test(line));

  assert.notEqual(actionRow, -1, `expected Todo details action row:\n${lines.join('\n')}`);
  assert.equal(actionRow, internalBottomRow, `Todo details actions must render on the last internal overlay row:\n${lines.join('\n')}`);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});


test('Note details overlay pins its action row to the internal bottom nav row', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Notes', notesState: {selectedNotePosition: 1, overlay: 'note-details'}}, snapshot: baseSnapshot({
    notes: {
      title: 'Notes',
      currentListId: 'n1',
      lists: [{id: 'n1', title: 'Notes', current: true}],
      items: [{id: 1, position: 1, text: 'Review Note details', description: 'Keep actions pinned', done: false, labels: ['ui']}],
      remaining: 0
    }
  })});
  const lines = visibleLines(session.output());
  const contract = overlayContractFor(80, 24);
  const internalBottomRow = contract.y + contract.height - 2;
  const actionRow = lines.findIndex(line => /Edit note/.test(line) && /Remove note/.test(line) && /Close/.test(line));

  assert.notEqual(actionRow, -1, `expected Note details action row:\n${lines.join('\n')}`);
  assert.equal(actionRow, internalBottomRow, `Note details actions must render on the last internal overlay row:\n${lines.join('\n')}`);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});

test('shared snapshot enrichment exposes list identities without calling mutators', () => {
  const {buildReadSnapshot} = require('../ui/read-model');
  const todoLists = [
    {$id: 1, title: 'Today', current: true, tasks: [{title: 'Ship UI', description: 'Foundation', done: false, labels: ['work']}]},
    {$id: 2, title: 'Later', current: false, tasks: []}
  ];
  const noteLists = [
    {$id: 'n1', title: 'Research', current: true, notes: [{title: 'Threat model', description: 'Keep reads safe', labels: ['sec']}]}
  ];

  const snapshot = buildReadSnapshot({
    models: {
      todos: {
        getCurrent: () => todoLists[0],
        getFirst: () => todoLists[0],
        find: () => todoLists,
        add: failMutator('todo.add'),
        save: failMutator('todo.save'),
        remove: failMutator('todo.remove'),
        use: failMutator('todo.use')
      },
      notes: {
        getCurrent: () => noteLists[0],
        getFirst: () => noteLists[0],
        find: () => noteLists,
        add: failMutator('notes.add'),
        save: failMutator('notes.save'),
        remove: failMutator('notes.remove'),
        use: failMutator('notes.use')
      },
      boards: {getCurrent: () => null, getFirst: () => null, find: () => []},
      clocks: {find: () => [{name: 'UTC', timezone: 'UTC'}], add: failMutator('clock.add')}
    },
    now: new Date('2026-06-02T12:00:00Z')
  });

  assert.equal(snapshot.todo.currentListId, 1);
  assert.deepEqual(snapshot.todo.lists, [
    {id: 1, title: 'Today', current: true},
    {id: 2, title: 'Later', current: false}
  ]);
  assert.deepEqual(snapshot.todo.items[0], {
    id: 1,
    position: 1,
    text: 'Ship UI',
    description: 'Foundation',
    done: false,
    labels: ['work']
  });
  assert.equal(snapshot.notes.currentListId, 'n1');
  assert.deepEqual(snapshot.notes.items[0], {
    id: 1,
    position: 1,
    text: 'Threat model',
    description: 'Keep reads safe',
    done: false,
    labels: ['sec']
  });
  assert.equal(snapshot.clocks.items[0].timezone, 'UTC');
  assert.equal(snapshot.clocks.items[0].position, 1);
});

test('top nav exposes Translate and Speech as apps with Sync as a global control without Tools launcher copy', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot()});
  const lines = visibleLines(session.output());
  const navLine = lines.find(line => /Todo/.test(line) && /Notes/.test(line) && /Board/.test(line) && /Clocks/.test(line) && /Sync/.test(line) && /Translate/.test(line) && /Speech/.test(line));

  assert.ok(navLine, `expected app labels and Sync global control in top nav:\n${lines.join('\n')}`);
  assert.doesNotMatch(session.output(), /\bTools\b|Choose a tool\./);
  assert.equal(lines.filter(line => line.length > 80).length, 0);

  session.click('tab-sync');
  assert.equal(session.state().activeTab, 'Sync');
  assert.match(session.output(), /Sync/);
  assert.doesNotMatch(session.output(), /Choose a tool\./);

  session.click('tab-translate');
  assert.equal(session.state().activeTab, 'Translate');
  assert.match(session.output(), /Text to translate/);

  session.click('tab-speech');
  assert.equal(session.state().activeTab, 'Speech');
  assert.match(session.output(), /Text to Speech/);
  session.destroy();
});

test('Ctrl shortcuts can select the utility apps as top-level routes', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot()});

  session.dispatchKey('CTRL_5');
  assert.equal(session.state().activeTab, 'Sync');

  session.dispatchKey('CTRL_6');
  assert.equal(session.state().activeTab, 'Translate');

  session.dispatchKey('CTRL_7');
  assert.equal(session.state().activeTab, 'Speech');
  session.destroy();
});
test('AppOverlay pins bottomNav to the internal bottom row with tall content', () => {
  const {renderTerminal, Screen, Text} = require('@valyrianjs/terminal');
  const {AppOverlay} = require('../ui/components/Overlay.tsx');
  const content = Array.from({length: 30}, (_, index) => Text({}, [`Content ${index + 1}`]));
  const output = renderTerminal(
    Screen({}, [
      Text({}, ['Base']),
      AppOverlay({
        title: Text({}, ['Overlay title']),
        content,
        bottomNav: Text({}, ['Bottom actions'])
      })
    ]),
    {cols: 80, rows: 24}
  );
  const lines = visibleLines(output);
  const contract = overlayContractFor(80, 24);
  const internalBottomRow = contract.y + contract.height - 2;
  const borderBottomRow = contract.y + contract.height - 1;

  assert.match(lines[internalBottomRow], /Bottom actions/, 'bottomNav must render on the last internal overlay row');
  assert.equal(lines[borderBottomRow][contract.x], '└', 'bottomNav must not displace the overlay bottom border');
  assert.equal(lines.filter(line => line.length > 80).length, 0, 'AppOverlay bottomNav contract must not overdraw 80 columns');
});

test('shared overlay props keep the 10 percent margin contract and modal defaults', () => {
  const {createOverlayProps} = require('../ui/components/Overlay.tsx');

  assert.deepEqual(createOverlayProps().margin, {x: '10%', y: '10%'});
  assert.equal(createOverlayProps().trapFocus, true);
  assert.equal(createOverlayProps().backdrop, true);
  assert.deepEqual(createOverlayProps({trapFocus: false, backdrop: false}).margin, {x: '10%', y: '10%'});
  assert.equal(createOverlayProps({trapFocus: false, backdrop: false}).trapFocus, false);
  assert.equal(createOverlayProps({trapFocus: false, backdrop: false}).backdrop, false);
});

test('StateText applies semantic tone styles to ANSI output without depending on global text state lookup', () => {
  const {mountTerminal, Screen} = require('@valyrianjs/terminal');
  const {errorStateText, emptyStateText, loadingStateText} = require('../ui/components/StateText.tsx');
  const session = mountTerminal(Screen({}, [
    errorStateText('Unsafe state'),
    emptyStateText('Nothing here'),
    loadingStateText('Loading data')
  ]), {runtime: 'headless', cols: 80, rows: 8});
  const ansi = session.ansiOutput();
  const plain = session.output();
  session.destroy();

  assert.match(plain, /Unsafe state/);
  assert.match(plain, /Nothing here/);
  assert.match(plain, /Loading data/);
  assert.match(ansi, /\x1b\[/, `expected StateText semantic styles to produce ANSI spans:\n${JSON.stringify(ansi)}`);
});

test('UtilityHost render paths do not start status or voice preparation side effects', () => {
  const {renderTerminal, Screen} = require('@valyrianjs/terminal');
  const {createUtilityPanel} = require('../ui/components/utility/panels.tsx');
  const {createUtilityOverlay} = require('../ui/components/utility/overlays.tsx');
  const syncActions = {
    status: failMutator('sync.status'),
    retry: failMutator('sync.retry'),
    enable: failMutator('sync.enable'),
    disable: failMutator('sync.disable'),
    init: failMutator('sync.init')
  };
  const babelActions = {translate: failMutator('babel.translate'), copyResult: failMutator('babel.copyResult')};
  const ttsActions = {
    voices: ['nova'],
    getDefaultVoice: failMutator('tts.getDefaultVoice'),
    createAudio: failMutator('tts.createAudio'),
    setDefaultVoice: failMutator('tts.setDefaultVoice')
  };
  const state = {
    activeOverlay: 'tts-voice',
    sync: {label: 'Not set up', details: ['Status: Not set up'], error: '', operation: null, statusLoaded: false, initForm: {remoteUrl: '', branch: 'main', confirmed: false, error: ''}},
    babel: {text: '', source: 'auto', target: 'en', translation: '', dictionaryEntries: [], error: '', message: '', operation: null, inputVersion: 0},
    tts: {inputFile: '', outputFile: '', voice: 'alloy', voices: ['alloy'], error: '', message: '', operation: null}
  };

  const output = renderTerminal(Screen({}, [
    ...createUtilityPanel('Sync', state, syncActions, babelActions, ttsActions),
    ...createUtilityPanel('Speech', state, syncActions, babelActions, ttsActions),
    createUtilityOverlay(state, syncActions, babelActions, ttsActions, {width: 80, rows: 24})
  ]), {cols: 80, rows: 24});

  assert.match(output, /Sync/);
  assert.match(output, /Text to/);
  assert.match(output, /Choose voice/);
  assert.deepEqual(state.tts.voices, ['alloy']);
  assert.equal(state.tts.voice, 'alloy');
});
