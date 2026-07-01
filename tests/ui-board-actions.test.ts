import test from 'node:test';
import assert from 'node:assert/strict';
import * as __cjsImport80 from '../ui/modules/board/actions';

const { createBoardActions } = __cjsImport80;
function createInjectedModel(overrides: any = {}) {
  const calls = [];
  const model = {
    getCurrent() {
      return {title: 'Launch board'};
    },
    cards: {
      add(values) {
        calls.push(values);
        return {saved: true, values};
      }
    },
    ...overrides
  };

  return {model, calls};
}

test('addCard rejects an empty title before calling the model', () => {
  const {model, calls} = createInjectedModel();
  const actions = createBoardActions({model});

  const result = actions.addCard({title: '   ', description: 'Details'});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Title is required.');
  assert.equal(calls.length, 0);
});

test('addCard trims title and description before persistence', () => {
  const {model, calls} = createInjectedModel();
  const actions = createBoardActions({model});

  const result = actions.addCard({title: '  Ship modal  ', description: '  Wire save  '});

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{title: 'Ship modal', description: 'Wire save'}]);
});

test('addCard allows empty description after trimming', () => {
  const {model, calls} = createInjectedModel();
  const actions = createBoardActions({model});

  const result = actions.addCard({title: 'Card', description: '   '});

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{title: 'Card', description: ''}]);
});

test('addCard reports missing current board without closing the caller flow as success', () => {
  const {model, calls} = createInjectedModel({
    getCurrent() {
      return null;
    }
  });
  const actions = createBoardActions({model});

  const result = actions.addCard({title: 'Card', description: 'Details'});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Choose a board before adding a card.');
  assert.equal(calls.length, 0);
});

test('addCard converts model failures into safe user-facing errors', () => {
  const {model} = createInjectedModel({
    cards: {
      add() {
        throw new Error('DB path /secret/internal failed');
      }
    }
  });
  const actions = createBoardActions({model});

  const result = actions.addCard({title: 'Card', description: 'Details'});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Card could not be saved. Try again.');
});

test('card and column actions fail closed when model operations are missing', () => {
  const {model} = createInjectedModel({cards: {}, columns: {}});
  const actions = createBoardActions({model});

  assert.deepEqual(actions.addCard({title: 'Card'}), {ok: false, error: 'Card could not be saved. Try again.'});
  assert.deepEqual(actions.editCard({columnIndex: 1, position: 1, title: 'Card'}), {ok: false, error: 'Card could not be updated. Try again.'});
  assert.deepEqual(actions.moveCard({fromColumn: 1, fromPosition: 1, toColumn: 2}), {ok: false, error: 'Card could not be moved. Try again.'});
  assert.deepEqual(actions.prioritizeCard({columnIndex: 1, position: 1, toPosition: 2}), {ok: false, error: 'Priority could not be changed. Try again.'});
  assert.deepEqual(actions.removeCard({columnIndex: 1, position: 1}), {ok: false, error: 'Card could not be removed. Try again.'});
  assert.deepEqual(actions.addColumn({title: 'Column'}), {ok: false, error: 'Column could not be saved. Try again.'});
  assert.deepEqual(actions.renameColumn({columnIndex: 1, title: 'Column'}), {ok: false, error: 'Column could not be renamed. Try again.'});
  assert.deepEqual(actions.moveColumnLeft({columnIndex: 2}), {ok: false, error: 'Column could not be moved. Try again.'});
  assert.deepEqual(actions.moveColumnRight({columnIndex: 1}), {ok: false, error: 'Column could not be moved. Try again.'});
  assert.deepEqual(actions.removeColumn({columnIndex: 1}), {ok: false, error: 'Column could not be removed. Try again.'});
  assert.deepEqual(actions.setWipLimit({columnIndex: 1, wipLimit: 2}), {ok: false, error: 'Column WIP limit could not be changed. Try again.'});
  assert.deepEqual(actions.setDefaultColumn({columnIndex: 1}), {ok: false, error: 'Default column could not be changed. Try again.'});
});


test('card and column actions call existing model APIs with safe payloads', () => {
  const calls = [];
  const {model} = createInjectedModel({
    cards: {
      add(values) {
        calls.push(['cards.add', values]);
        return {saved: true};
      },
      edit(values) {
        calls.push(['cards.edit', values]);
        return {saved: true};
      },
      move(values) {
        calls.push(['cards.move', values]);
        return {saved: true};
      },
      remove(values) {
        calls.push(['cards.remove', values]);
        return {saved: true};
      }
    },
    columns: {
      add(values) {
        calls.push(['columns.add', values]);
        return {saved: true};
      },
      edit(index, values) {
        calls.push(['columns.edit', index, values]);
        return {saved: true};
      },
      reorder(values) {
        calls.push(['columns.reorder', values]);
        return {saved: true};
      },
      remove(index) {
        calls.push(['columns.remove', index]);
        return {saved: true};
      }
    }
  });
  const actions = createBoardActions({model});

  assert.equal(actions.editCard({columnIndex: 1, position: 2, title: '  New  ', description: '  Desc  '}).ok, true);
  assert.equal(actions.moveCard({fromColumn: 1, fromPosition: 2, toColumn: 2}).ok, true);
  assert.equal(actions.prioritizeCard({columnIndex: 1, position: 2, toPosition: 1}).ok, true);
  assert.equal(actions.removeCard({columnIndex: 1, position: 2}).ok, true);
  assert.equal(actions.addColumn({title: '  Review  '}).ok, true);
  assert.equal(actions.renameColumn({columnIndex: 2, title: '  Doing  '}).ok, true);
  assert.equal(actions.moveColumnLeft({columnIndex: 2}).ok, true);
  assert.equal(actions.moveColumnRight({columnIndex: 2}).ok, true);
  assert.equal(actions.removeColumn({columnIndex: 2}).ok, true);

  assert.deepEqual(calls, [
    ['cards.edit', {columnIndex: 1, position: 2, values: {title: 'New', description: 'Desc'}}],
    ['cards.move', {fromColumn: 1, fromPosition: 2, toColumn: 2}],
    ['cards.move', {fromColumn: 1, fromPosition: 2, toColumn: 1, toPosition: 1}],
    ['cards.remove', {columnIndex: 1, positions: [2]}],
    ['columns.add', {title: 'Review'}],
    ['columns.edit', 2, {title: 'Doing'}],
    ['columns.reorder', {fromIndex: 2, toIndex: 1}],
    ['columns.reorder', {fromIndex: 2, toIndex: 3}],
    ['columns.remove', 2]
  ]);
});

test('actions reject invalid selections before calling the model', () => {
  const {model, calls} = createInjectedModel();
  const actions = createBoardActions({model});

  assert.equal(actions.editCard({columnIndex: 0, position: 1, title: 'x'}).ok, false);
  assert.equal(actions.moveCard({fromColumn: 1, fromPosition: 0, toColumn: 2}).ok, false);
  assert.equal(actions.prioritizeCard({columnIndex: 1, position: 1, toPosition: 0}).ok, false);
  assert.equal(actions.removeCard({columnIndex: 1}).ok, false);
  assert.equal(actions.addColumn({title: '   '}).ok, false);
  assert.equal(actions.renameColumn({columnIndex: 1, title: '   '}).ok, false);
  assert.equal(actions.moveColumnLeft({columnIndex: 1}).ok, false);
  assert.equal(calls.length, 0);
});


test('useBoard rejects missing ids before calling the model', () => {
  const calls = [];
  const {model} = createInjectedModel({
    use(id) {
      calls.push(id);
      return {saved: true};
    }
  });
  const actions = createBoardActions({model});

  const result = actions.useBoard({id: '   '});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Choose a board first.');
  assert.deepEqual(calls, []);
});

test('useBoard opens a board through the model with a trimmed id', () => {
  const calls = [];
  const {model} = createInjectedModel({
    use(id) {
      calls.push(id);
      return {id, current: true};
    }
  });
  const actions = createBoardActions({model});

  const result = actions.useBoard({id: '  board-2  '});

  assert.equal(result.ok, true);
  assert.deepEqual(result.board, {id: 'board-2', current: true});
  assert.deepEqual(calls, ['board-2']);
});

test('useBoard converts model failures into safe user-facing errors', () => {
  const {model} = createInjectedModel({
    use() {
      throw new Error('internal db path leaked');
    }
  });
  const actions = createBoardActions({model});

  const result = actions.useBoard({id: 'board-2'});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'We couldn’t open this board. Try again.');
});


test('useBoard forwards numeric iludb ids without string coercion', () => {
  const calls = [];
  const {model} = createInjectedModel({
    use(id) {
      calls.push(id);
      return {$id: id, current: true};
    }
  });
  const actions = createBoardActions({model});

  const result = actions.useBoard({id: 2});

  assert.equal(result.ok, true);
  assert.deepEqual(result.board, {$id: 2, current: true});
  assert.deepEqual(calls, [2]);
});

test('board management and column parity actions reject invalid values before model calls', () => {
  const calls = [];
  const {model} = createInjectedModel({
    getCurrent() {
      return null;
    },
    add(values) {
      calls.push(['add', values]);
      return {saved: true};
    },
    save(board) {
      calls.push(['save', board]);
      return {saved: true};
    },
    remove(board) {
      calls.push(['remove', board]);
      return {saved: true};
    },
    columns: {
      edit(index, values) {
        calls.push(['columns.edit', index, values]);
        return {saved: true};
      },
      setDefault(index) {
        calls.push(['columns.setDefault', index]);
        return {saved: true};
      },
      resetSimpleDefault() {
        calls.push(['columns.resetSimpleDefault']);
        return {saved: true};
      }
    }
  });
  const actions = createBoardActions({model});

  assert.equal(actions.addBoard({title: '   ', description: 'x'}).ok, false);
  assert.equal(actions.renameBoard({boardId: null, title: 'Name'}).ok, false);
  assert.equal(actions.renameBoard({boardId: 1, title: '   '}).ok, false);
  assert.equal(actions.removeBoard({boardId: '   '}).ok, false);
  assert.equal(actions.resetDefaultColumns().ok, false);
  assert.equal(actions.setWipLimit({columnIndex: 1, wipLimit: -1}).ok, false);
  assert.equal(actions.setWipLimit({columnIndex: 1, wipLimit: 'abc'}).ok, false);
  assert.equal(actions.setDefaultColumn({columnIndex: 0}).ok, false);

  assert.deepEqual(calls, []);
});

test('board management actions call existing model APIs with trimmed safe payloads', () => {
  const calls = [];
  const boards = [
    {$id: 1, title: 'Launch board', description: 'Old', current: true, columns: []},
    {$id: 2, title: 'Ops board', description: '', current: false, columns: []}
  ];
  const {model} = createInjectedModel({
    find() {
      return boards;
    },
    get(id) {
      calls.push(['get', id]);
      return boards.find(board => board.$id === id || board.$id === Number(id));
    },
    getCurrent() {
      return boards.find(board => board.current === true) || null;
    },
    getFirst() {
      return boards[1] || null;
    },
    use(id) {
      calls.push(['use', id]);
      return {id, current: true};
    },
    add(values) {
      calls.push(['add', values]);
      return {$id: 3, ...values, current: true};
    },
    save(board) {
      calls.push(['save', {...board}]);
      return board;
    },
    remove(board) {
      calls.push(['remove', board.$id]);
      const found = boards.find(item => item.$id === board.$id);
      if (found) {
        found.current = false;
      }
      return {removed: true};
    }
  });
  const actions = createBoardActions({model});

  assert.equal(actions.addBoard({title: '  Product  ', description: '  Work  '}).ok, true);
  assert.equal(actions.renameBoard({boardId: 1, title: '  Launch v2  ', description: '  Done  '}).ok, true);
  assert.equal(actions.removeBoard({boardId: 1}).ok, true);

  assert.deepEqual(calls, [
    ['add', {title: 'Product', description: 'Work'}],
    ['get', 1],
    ['save', {$id: 1, title: 'Launch v2', description: 'Done', current: true, columns: []}],
    ['get', 1],
    ['remove', 1],
    ['use', 2]
  ]);
});

test('column parity actions enforce reset constraints and forward WIP/default operations', () => {
  const calls = [];
  const board = {
    title: 'Launch board',
    columns: [
      {title: 'Backlog', id: 'backlog', cards: [], wipLimit: null},
      {title: 'Doing', id: 'doing', cards: [], wipLimit: 2}
    ]
  };
  const {model} = createInjectedModel({
    getCurrent() {
      return board;
    },
    columns: {
      edit(index, values) {
        calls.push(['columns.edit', index, values]);
        return {saved: true};
      },
      setDefault(index) {
        calls.push(['columns.setDefault', index]);
        return {saved: true};
      },
      resetSimpleDefault() {
        calls.push(['columns.resetSimpleDefault']);
        return {saved: true};
      }
    }
  });
  const actions = createBoardActions({model});

  assert.equal(actions.resetDefaultColumns().ok, true);
  assert.equal(actions.setWipLimit({columnIndex: 1, wipLimit: '0'}).ok, true);
  assert.equal(actions.setWipLimit({columnIndex: 2, wipLimit: ' 4 '}).ok, true);
  assert.equal(actions.setDefaultColumn({columnIndex: 2}).ok, true);

  assert.deepEqual(calls, [
    ['columns.resetSimpleDefault'],
    ['columns.edit', 1, {wipLimit: null}],
    ['columns.edit', 2, {wipLimit: 4}],
    ['columns.setDefault', 2]
  ]);
});

test('resetDefaultColumns blocks non-empty boards before calling the model', () => {
  const calls = [];
  const {model} = createInjectedModel({
    getCurrent() {
      return {title: 'Launch board', columns: [{title: 'Backlog', cards: [{title: 'Card'}]}]};
    },
    columns: {
      resetSimpleDefault() {
        calls.push(['columns.resetSimpleDefault']);
        return {saved: true};
      }
    }
  });
  const actions = createBoardActions({model});

  const result = actions.resetDefaultColumns();

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Move or remove cards before resetting columns.');
  assert.deepEqual(calls, []);
});

test('board and column parity actions convert model failures into safe user-facing errors', () => {
  const {model} = createInjectedModel({
    add() {
      throw new Error('secret path /home/user/.ssh leaked');
    },
    get() {
      throw new Error('secret board load failed');
    },
    columns: {
      edit() {
        throw new Error('WIP limit must be null or an integer');
      },
      setDefault() {
        throw new Error('internal default column id failed');
      },
      resetSimpleDefault() {
        throw new Error('internal reset failed');
      }
    }
  });
  const actions = createBoardActions({model});

  assert.equal(actions.addBoard({title: 'Board'}).error, 'Board could not be saved. Try again.');
  assert.equal(actions.renameBoard({boardId: 1, title: 'Board'}).error, 'Board could not be renamed. Try again.');
  assert.equal(actions.setWipLimit({columnIndex: 1, wipLimit: '2'}).error, 'Column WIP limit could not be changed. Try again.');
  assert.equal(actions.setDefaultColumn({columnIndex: 1}).error, 'Default column could not be changed. Try again.');
  assert.equal(actions.resetDefaultColumns().error, 'Columns could not be reset. Try again.');
});
