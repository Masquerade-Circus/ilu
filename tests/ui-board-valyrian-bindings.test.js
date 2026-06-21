const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
process.env.TSX_TSCONFIG_PATH = path.join(repoRoot, 'tsconfig.ui.json');
require('tsx/cjs');

const {createBoardKeyBindings} = require('../ui/pages/board/MainView.tsx');
const Ui = require('../ui/app.tsx');

function bindingSignature(binding) {
  return {
    key: binding.key,
    scope: binding.scope,
    focusedTag: binding.when && binding.when.focusedTag,
    commandId: binding.command && binding.command.id
  };
}

test('Board delegates Editor Enter and List press keys to Valyrian defaults', () => {
  const forbiddenBindings = createBoardKeyBindings()
    .map(bindingSignature)
    .filter(binding => {
      const forcesEditorEnter = binding.key === 'ENTER'
        && binding.scope === 'editor'
        && binding.focusedTag === 'terminal-editor';
      const interceptsListPress = (binding.key === 'ENTER' || binding.key === 'SPACE')
        && binding.scope === 'list'
        && binding.focusedTag === 'terminal-list';

      return forcesEditorEnter || interceptsListPress;
    });

  assert.deepEqual(forbiddenBindings, []);
});

function snapshot() {
  return {
    todo: {title: 'Today', items: [], remaining: 0},
    notes: {title: 'Notes', items: [], remaining: 0},
    board: {
      title: 'Board',
      columns: [
        {title: 'Backlog', wipLimit: null, cards: []}
      ],
      totalCards: 0
    },
    clocks: {items: [], remaining: 0}
  };
}

function boardActions(calls) {
  const ok = () => ({ok: true});

  return {
    addCard: ok,
    editCard: ok,
    moveCard: ok,
    prioritizeCard: ok,
    removeCard: ok,
    addColumn: ok,
    renameColumn: ok,
    moveColumnLeft: ok,
    moveColumnRight: ok,
    removeColumn: ok,
    setWipLimit(values) {
      calls.push(values);
      return {ok: true};
    }
  };
}

test('Board WIP overlay rejects non-numeric input before calling the action', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board', board: {overlay: 'set-wip-limit', selectedColumnIndex: 1, wipLimit: {title: 'abc'}}},
    snapshot: snapshot(),
    boardActions: boardActions(calls)
  });

  session.click('board-set-wip-save');

  assert.deepEqual(calls, []);
  assert.match(session.output(), /Choose a WIP limit of 0 or higher\./);
  session.destroy();
});

test('Board WIP overlay rejects empty Enter submit before calling the action', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board', board: {overlay: 'set-wip-limit', selectedColumnIndex: 1, wipLimit: {title: ''}}},
    snapshot: snapshot(),
    boardActions: boardActions(calls)
  });

  session.focus('board-wip-limit');
  session.dispatchKey('ENTER');

  assert.deepEqual(calls, []);
  assert.match(session.output(), /Choose a WIP limit of 0 or higher\./);
  session.destroy();
});

test('Board WIP overlay handles invalid Enter submit without throwing', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board', board: {overlay: 'set-wip-limit', selectedColumnIndex: 1, wipLimit: {title: 'abc'}}},
    snapshot: snapshot(),
    boardActions: boardActions(calls)
  });

  session.focus('board-wip-limit');
  assert.doesNotThrow(() => session.dispatchKey('ENTER'));

  assert.deepEqual(calls, []);
  assert.match(session.output(), /Choose a WIP limit of 0 or higher\./);
  session.destroy();
});

test('Board WIP overlay submits finite NumberInput values with zero as no limit', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Board', board: {overlay: 'set-wip-limit', selectedColumnIndex: 1, wipLimit: {title: '0'}}},
    snapshot: snapshot(),
    boardActions: boardActions(calls)
  });

  session.click('board-set-wip-save');

  assert.deepEqual(calls, [{columnIndex: 1, wipLimit: 0}]);
  session.destroy();
});
