const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const boardRendererModulePath = path.join(repoRoot, 'scrumban', 'board-renderer.js');
const renderBoard = require(boardRendererModulePath);

function loadRenderBoardWithCliTableStub(cliTableFactory) {
  const originalLoad = Module._load;
  delete require.cache[require.resolve(boardRendererModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'cli-table') {
      return cliTableFactory;
    }

    return originalLoad(request, parent, isMain);
  };

  try {
    return require(boardRendererModulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(boardRendererModulePath)];
  }
}

function loadBoardRendererWithoutCliTable() {
  const originalLoad = Module._load;
  delete require.cache[require.resolve(boardRendererModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'cli-table') {
      let error = new Error("Cannot find module 'cli-table'");
      error.code = 'MODULE_NOT_FOUND';
      throw error;
    }

    return originalLoad(request, parent, isMain);
  };

  try {
    return require(boardRendererModulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(boardRendererModulePath)];
  }
}

function withTerminalColumns(columns, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'columns');

  Object.defineProperty(process.stdout, 'columns', {
    configurable: true,
    enumerable: descriptor ? descriptor.enumerable : true,
    writable: true,
    value: columns
  });

  try {
    return callback();
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdout, 'columns', descriptor);
    } else {
      delete process.stdout.columns;
    }
  }
}

test('board renderer delegates to cli-table when the dependency is available', () => {
  const constructorCalls = [];
  const pushedRows = [];

  class FakeCliTable {
    constructor(options) {
      constructorCalls.push(options);
    }

    push(row) {
      pushedRows.push(row);
    }

    toString() {
      return 'cli-table-output';
    }
  }

  const renderBoardWithCliTable = loadRenderBoardWithCliTableStub(FakeCliTable);
  const output = renderBoardWithCliTable({
    title: 'Product',
    columns: [
      {title: 'Backlog', wipLimit: null, cards: [{title: 'Spec API', position: 1}]},
      {title: 'Ready', wipLimit: 2, cards: [{title: 'Review copy', position: 1}]},
      {title: 'Done', wipLimit: null, cards: []}
    ]
  }, {terminalColumns: 55});

  assert.equal(output, 'cli-table-output');
  assert.equal(constructorCalls.length, 1);
  assert.deepEqual(constructorCalls[0].head, ['Backlog', 'Ready (1/2)', 'Done']);
  assert.deepEqual(constructorCalls[0].colWidths, [16, 19, 10]);
  assert.deepEqual(pushedRows, [['1 Spec API', '1 Review copy', '']]);
});

test('board renderer infers cli-table widths from process stdout columns', () => {
  const constructorCalls = [];

  class FakeCliTable {
    constructor(options) {
      constructorCalls.push(options);
    }

    push() {}

    toString() {
      return 'cli-table-output';
    }
  }

  const renderBoardWithCliTable = loadRenderBoardWithCliTableStub(FakeCliTable);

  withTerminalColumns(55, () => {
    renderBoardWithCliTable({
      title: 'Product',
      columns: [
        {title: 'Backlog', wipLimit: null, cards: [{title: 'Spec API', position: 1}]},
        {title: 'Ready', wipLimit: 2, cards: [{title: 'Review copy', position: 1}]},
        {title: 'Done', wipLimit: null, cards: []}
      ]
    });
  });

  assert.deepEqual(constructorCalls[0].colWidths, [16, 19, 10]);
});

test('board renderer keeps a minimum cli-table width per column on narrow terminals', () => {
  const constructorCalls = [];

  class FakeCliTable {
    constructor(options) {
      constructorCalls.push(options);
    }

    push() {}

    toString() {
      return 'cli-table-output';
    }
  }

  const renderBoardWithCliTable = loadRenderBoardWithCliTableStub(FakeCliTable);

  renderBoardWithCliTable({
    title: 'Product',
    columns: [
      {title: 'Backlog', wipLimit: null, cards: [{title: 'Spec API', position: 1}]},
      {title: 'Ready', wipLimit: 2, cards: [{title: 'Review copy', position: 1}]}
    ]
  }, {terminalColumns: 17});

  assert.deepEqual(constructorCalls[0].colWidths, [5, 5]);
});

test('board renderer weights cli-table widths by visible column content', () => {
  const constructorCalls = [];

  class FakeCliTable {
    constructor(options) {
      constructorCalls.push(options);
    }

    push() {}

    toString() {
      return 'cli-table-output';
    }
  }

  const renderBoardWithCliTable = loadRenderBoardWithCliTableStub(FakeCliTable);

  renderBoardWithCliTable({
    title: 'Product',
    columns: [
      {title: 'Todo', wipLimit: null, cards: [{title: 'Tiny', position: 1}]},
      {title: 'Implementation', wipLimit: null, cards: [{title: 'A much longer card title', position: 1}]},
      {title: 'Done', wipLimit: null, cards: []}
    ]
  }, {terminalColumns: 55});

  assert.deepEqual(constructorCalls[0].colWidths, [10, 27, 8]);
});

test('board renderer wraps card content within cli-table column width instead of truncating it', () => {
  const pushedRows = [];

  class FakeCliTable {
    push(row) {
      pushedRows.push(row);
    }

    toString() {
      return 'cli-table-output';
    }
  }

  const renderBoardWithCliTable = loadRenderBoardWithCliTableStub(FakeCliTable);

  renderBoardWithCliTable({
    title: 'Product',
    columns: [
      {title: 'Ready', wipLimit: null, cards: [{title: 'Review copy', position: 1}]}
    ]
  }, {terminalColumns: 14});

  assert.deepEqual(pushedRows, [['1 Review\ncopy']]);
});

test('board renderer requires cli-table instead of falling back to a manual table renderer', () => {
  assert.throws(() => loadBoardRendererWithoutCliTable(), /Cannot find module 'cli-table'/);
});

test('board renderer uses the installed cli-table dependency output', () => {
  const CliTable = require('cli-table');
  const board = {
    title: 'Product',
    columns: [
      {title: 'Backlog', wipLimit: null, cards: [{title: 'Spec API', position: 1}]},
      {title: 'Ready', wipLimit: 2, cards: [{title: 'Review copy', position: 1}]},
      {title: 'Done', wipLimit: null, cards: []}
    ]
  };
  const expected = new CliTable({
    head: ['Backlog', 'Ready (1/2)', 'Done'],
    colWidths: [16, 19, 10],
    style: {
      compact: true,
      head: []
    }
  });

  expected.push(['1 Spec API', '1 Review copy', '']);

  assert.equal(renderBoard(board, {terminalColumns: 55}), expected.toString());
});
