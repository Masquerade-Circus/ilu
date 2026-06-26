const test = require('node:test');
const assert = require('node:assert/strict');
const {
  uiModulePath,
  visibleLines,
  richSnapshot,
  realBoardSnapshot,
} = require('./test-helpers/ui-app');

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
