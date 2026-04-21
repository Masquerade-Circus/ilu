const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const modelModulePath = path.join(repoRoot, 'scrumban', 'model.js');

function createCollection() {
  const items = [];
  let sequence = 1;

  function matchesQuery(item, query = {}) {
    return Object.entries(query).every(([key, value]) => item[key] === value);
  }

  return {
    count() {
      return items.length;
    },
    add(doc) {
      const inserted = {...doc, $id: String(sequence++)};
      items.push(inserted);
      return inserted;
    },
    get(id) {
      return items.find(item => item.$id === id);
    },
    find(query = {}) {
      return items
        .filter(item => matchesQuery(item, query))
        .sort((left, right) => left.index - right.index);
    },
    findOne(query = {}) {
      return this.find(query)[0];
    },
    update(item) {
      const index = items.findIndex(current => current.$id === item.$id);
      items[index] = item;
      return item;
    },
    remove(item) {
      const index = items.findIndex(current => current.$id === item.$id);
      if (index >= 0) {
        items.splice(index, 1);
      }
    }
  };
}

function loadModel() {
  const originalLoad = Module._load;
  const fakeCollection = createCollection();

  delete require.cache[require.resolve(modelModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../utils/load-db') {
      return () => ({
        getCollection() {
          return fakeCollection;
        }
      });
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    return {
      Model: require(modelModulePath),
      fakeCollection
    };
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(modelModulePath)];
  }
}

test('scrumban model creates boards with default columns and current selection', () => {
  const {Model} = loadModel();

  const first = Model.add({title: ' Product ', description: ' Delivery '});
  const second = Model.add({title: ' Ops ', description: ''});

  assert.equal(first.title, 'Product');
  assert.equal(first.description, 'Delivery');
  assert.equal(first.columns.length, 4);
  assert.equal(first.defaultColumnId, 'backlog');
  assert.deepEqual(first.columns.map(column => ({id: column.id, title: column.title, wipLimit: column.wipLimit})), [
    {id: 'backlog', title: 'Backlog', wipLimit: null},
    {id: 'ready', title: 'Ready', wipLimit: null},
    {id: 'in-progress', title: 'In Progress', wipLimit: null},
    {id: 'done', title: 'Done', wipLimit: null}
  ]);
  assert.equal(first.current, false);
  assert.equal(second.current, true);
  assert.equal(Model.getCurrent().$id, second.$id);
});

test('scrumban model creates boards with custom columns and defaultColumnId', () => {
  const {Model} = loadModel();

  const board = Model.add({
    title: 'Custom',
    description: 'Flow',
    defaultColumnId: 'queued',
    columns: [
      {id: 'triage', title: 'Triage', wipLimit: null},
      {id: 'queued', title: 'Queued', wipLimit: 2},
      {id: 'ship', title: 'Ship', wipLimit: null}
    ]
  });

  assert.equal(board.defaultColumnId, 'queued');
  assert.deepEqual(board.columns.map(column => ({id: column.id, title: column.title, wipLimit: column.wipLimit, cards: column.cards})), [
    {id: 'triage', title: 'Triage', wipLimit: null, cards: []},
    {id: 'queued', title: 'Queued', wipLimit: 2, cards: []},
    {id: 'ship', title: 'Ship', wipLimit: null, cards: []}
  ]);
});

test('scrumban model does not persist a board when defaultColumnId is invalid', () => {
  const {Model, fakeCollection} = loadModel();

  assert.throws(() => {
    Model.add({
      title: 'Invalid default',
      description: '',
      defaultColumnId: 'missing-column',
      columns: [
        {id: 'triage', title: 'Triage', wipLimit: null},
        {id: 'doing', title: 'Doing', wipLimit: null}
      ]
    });
  }, /board default column must match an existing column/i);

  assert.equal(fakeCollection.count(), 0);
  assert.equal(Model.getCurrent(), undefined);
});

test('scrumban model adds cards to the board default column when no column is provided', () => {
  const {Model} = loadModel();

  Model.add({
    title: 'Product',
    description: '',
    defaultColumnId: 'queued',
    columns: [
      {id: 'triage', title: 'Triage', wipLimit: null},
      {id: 'queued', title: 'Queued', wipLimit: null},
      {id: 'done', title: 'Done', wipLimit: null}
    ]
  });
  Model.cards.add({title: 'Write docs', description: 'v1'});

  const current = Model.getCurrent();

  assert.deepEqual(current.columns.map(column => ({id: column.id, titles: column.cards.map(card => card.title)})), [
    {id: 'triage', titles: []},
    {id: 'queued', titles: ['Write docs']},
    {id: 'done', titles: []}
  ]);
  assert.equal(current.columns[1].cards[0].position, 1);
});

test('scrumban model renames columns without changing ids or defaultColumnId', () => {
  const {Model} = loadModel();

  Model.add({title: 'Product', description: ''});

  Model.columns.edit(2, {title: 'Next Up'});

  const current = Model.getCurrent();

  assert.equal(current.defaultColumnId, 'backlog');
  assert.deepEqual(current.columns.map(column => ({id: column.id, title: column.title})), [
    {id: 'backlog', title: 'Backlog'},
    {id: 'ready', title: 'Next Up'},
    {id: 'in-progress', title: 'In Progress'},
    {id: 'done', title: 'Done'}
  ]);
});

test('scrumban model reorders columns while preserving ids', () => {
  const {Model} = loadModel();

  Model.add({title: 'Product', description: ''});

  Model.columns.reorder({fromIndex: 4, toIndex: 2});

  const current = Model.getCurrent();

  assert.equal(current.defaultColumnId, 'backlog');
  assert.deepEqual(current.columns.map(column => column.id), ['backlog', 'done', 'ready', 'in-progress']);
  assert.deepEqual(current.columns.map(column => column.index), [1, 2, 3, 4]);
});

test('scrumban model rejects removing a column that still has cards', () => {
  const {Model} = loadModel();

  Model.add({title: 'Product', description: ''});
  Model.cards.add({title: 'Write docs', description: ''});

  assert.throws(() => {
    Model.columns.remove(1);
  }, /cannot remove a column with cards/i);
});

test('scrumban model rejects removing the default column until another default is assigned', () => {
  const {Model} = loadModel();

  Model.add({title: 'Product', description: ''});

  assert.throws(() => {
    Model.columns.remove(1);
  }, /cannot remove the default column/i);
});

test('scrumban model resets the simple default columns with a consistent defaultColumnId', () => {
  const {Model} = loadModel();

  Model.add({
    title: 'Product',
    description: '',
    defaultColumnId: 'queued',
    columns: [
      {id: 'triage', title: 'Triage', wipLimit: null},
      {id: 'queued', title: 'Queued', wipLimit: 2},
      {id: 'ship', title: 'Ship', wipLimit: null}
    ]
  });

  Model.columns.resetSimpleDefault();

  const current = Model.getCurrent();

  assert.equal(current.defaultColumnId, 'backlog');
  assert.equal(current.columns.length, 4);
  assert.deepEqual(current.columns.map(column => ({id: column.id, title: column.title, wipLimit: column.wipLimit})), [
    {id: 'backlog', title: 'Backlog', wipLimit: null},
    {id: 'ready', title: 'Ready', wipLimit: null},
    {id: 'in-progress', title: 'In Progress', wipLimit: null},
    {id: 'done', title: 'Done', wipLimit: null}
  ]);
});

test('scrumban model rejects invalid WIP limits when editing columns', () => {
  const {Model} = loadModel();

  Model.add({title: 'Product', description: ''});

  assert.throws(() => {
    Model.columns.edit(2, {wipLimit: 0});
  }, /wip limit must be null or an integer greater than or equal to 1/i);

  assert.throws(() => {
    Model.columns.edit(2, {wipLimit: -1});
  }, /wip limit must be null or an integer greater than or equal to 1/i);

  assert.throws(() => {
    Model.columns.edit(2, {wipLimit: Number.NaN});
  }, /wip limit must be null or an integer greater than or equal to 1/i);

  assert.equal(Model.getCurrent().columns[1].wipLimit, null);
});

test('scrumban model rejects invalid WIP limits when creating boards with custom columns', () => {
  const {Model} = loadModel();

  assert.throws(() => {
    Model.add({
      title: 'Product',
      description: '',
      columns: [
        {id: 'ideas', title: 'Ideas', wipLimit: 0},
        {id: 'ready', title: 'Ready', wipLimit: null}
      ]
    });
  }, /wip limit must be null or an integer greater than or equal to 1/i);
});

test('scrumban model rejects invalid WIP limits when adding columns', () => {
  const {Model} = loadModel();

  Model.add({title: 'Product', description: ''});

  assert.throws(() => {
    Model.columns.add({title: 'Ready for QA', wipLimit: 0});
  }, /wip limit must be null or an integer greater than or equal to 1/i);
});

test('scrumban model moves cards forward and auto-pulls earlier columns while capacity allows', () => {
  const {Model} = loadModel();

  Model.add({title: 'Product', description: ''});
  Model.columns.edit(2, {wipLimit: 2});
  Model.cards.add({title: 'One', description: ''}, {columnIndex: 1});
  Model.cards.add({title: 'Two', description: ''}, {columnIndex: 1});
  Model.cards.add({title: 'Three', description: ''}, {columnIndex: 1});

  Model.cards.move({fromColumn: 1, fromPosition: 1, toColumn: 3, toPosition: 1});

  const current = Model.getCurrent();

  assert.deepEqual(current.columns[0].cards.map(card => card.title), ['Three']);
  assert.deepEqual(current.columns[1].cards.map(card => card.title), ['Two']);
  assert.deepEqual(current.columns[2].cards.map(card => card.title), ['One']);
});

test('scrumban model keeps auto-pull based on visual column order after reorder', () => {
  const {Model} = loadModel();

  Model.add({title: 'Product', description: ''});
  Model.columns.reorder({fromIndex: 2, toIndex: 1});
  Model.cards.add({title: 'One', description: ''}, {columnIndex: 1});
  Model.cards.add({title: 'Two', description: ''}, {columnIndex: 1});
  Model.cards.add({title: 'Three', description: ''}, {columnIndex: 2});

  Model.cards.move({fromColumn: 1, fromPosition: 1, toColumn: 4, toPosition: 1});

  const current = Model.getCurrent();

  assert.deepEqual(current.columns.map(column => ({id: column.id, titles: column.cards.map(card => card.title)})), [
    {id: 'ready', titles: []},
    {id: 'backlog', titles: ['Two']},
    {id: 'in-progress', titles: ['Three']},
    {id: 'done', titles: ['One']}
  ]);
});

test('scrumban model stops the auto-pull chain when an intermediate column is full', () => {
  const {Model} = loadModel();

  Model.add({title: 'Product', description: ''});
  Model.columns.edit(2, {wipLimit: 1});
  Model.cards.add({title: 'One', description: ''}, {columnIndex: 1});
  Model.cards.add({title: 'Two', description: ''}, {columnIndex: 2});
  Model.cards.add({title: 'Three', description: ''}, {columnIndex: 1});

  Model.cards.move({fromColumn: 1, fromPosition: 1, toColumn: 3, toPosition: 1});

  const current = Model.getCurrent();

  assert.deepEqual(current.columns[0].cards.map(card => card.title), ['Three']);
  assert.deepEqual(current.columns[1].cards.map(card => card.title), ['Two']);
  assert.deepEqual(current.columns[2].cards.map(card => card.title), ['One']);
});
