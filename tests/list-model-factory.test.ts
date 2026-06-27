const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const factoryModulePath = path.join(repoRoot, 'utils', 'create-list-model.ts');

function createCollection() {
  const items = [];
  let sequence = 1;
  let updateCount = 0;

  function matchesQuery(item, query: any = {}) {
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
    find(query: any = {}) {
      return items
        .filter(item => matchesQuery(item, query))
        .sort((left, right) => left.index - right.index);
    },
    findOne(query: any = {}) {
      return this.find(query)[0];
    },
    update(item) {
      updateCount += 1;
      const index = items.findIndex(current => current.$id === item.$id);
      items[index] = item;
      return item;
    },
    updateCount() {
      return updateCount;
    },
    remove(item) {
      const index = items.findIndex(current => current.$id === item.$id);
      if (index >= 0) {
        items.splice(index, 1);
      }
    }
  };
}

function loadFactory() {
  const originalLoad = Module._load;
  const fakeCollection = createCollection();
  const syncCalls = [];

  delete require.cache[require.resolve(factoryModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './load-db') {
      return () => ({
        getCollection(name) {
          return fakeCollection;
        }
      });
    }

    if (request === './persistence-sync') {
      return {
        createCollectionPersistenceNotifier(dbName, collectionName) {
          return action => syncCalls.push({dbName, collectionName, action});
        }
      };
    }

    if (request === 'lodash/isUndefined') {
      return value => typeof value === 'undefined';
    }

    if (request === 'lodash/includes') {
      return (collection, value) => collection.includes(value);
    }

    return originalLoad.apply(this, arguments);
  };

  try {
      return {
        createListModel: require(factoryModulePath),
        fakeCollection,
        syncCalls
      };
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(factoryModulePath)];
  }
}

test('create-list-model crea listas con el itemKey configurado y conserva current', () => {
  const {createListModel} = loadFactory();
  const Model = createListModel({
    dbName: 'todos',
    collectionName: 'todos',
    itemKey: 'tasks',
    itemHasCheck: true
  });

  const first = Model.add({title: ' First ', description: ' Desc '});
  const second = Model.add({title: 'Second', description: ''});

  assert.equal(first.title, 'First');
  assert.equal(first.description, 'Desc');
  assert.deepEqual(first.tasks, []);
  assert.deepEqual(first.labels, []);
  assert.equal(first.index, 1);
  assert.equal(first.current, false);
  assert.equal(second.current, true);
  assert.equal(Model.getCurrent().$id, second.$id);
});

test('create-list-model agrega, edita y elimina items anidados y labels', () => {
  const {createListModel} = loadFactory();
  const Model = createListModel({
    dbName: 'notes',
    collectionName: 'notes',
    itemKey: 'notes'
  });

  Model.add({title: 'Ideas', description: ''});
  Model.notes.add({title: 'Nota 1', content: 'hola'});
  Model.labels.add({title: 'Importante', color: 'bgRed'});
  Model.notes.edit(1, {title: 'Nota editada'});
  Model.labels.edit(1, {title: 'Urgente'});

  let current = Model.getCurrent();
  assert.equal(current.notes[0].done, false);
  assert.deepEqual(current.notes[0].labels, []);
  assert.equal(current.notes[0].title, 'Nota editada');
  assert.equal(current.labels[0].title, 'Urgente');

  Model.notes.remove(1);
  Model.labels.remove(1);

  current = Model.getCurrent();
  assert.deepEqual(current.notes, []);
  assert.deepEqual(current.labels, []);
});

test('create-list-model rechaza operaciones anidadas inválidas sin persistir cambios', () => {
  const {createListModel, fakeCollection} = loadFactory();
  const Model = createListModel({
    dbName: 'todos',
    collectionName: 'todos',
    itemKey: 'tasks',
    itemHasCheck: true
  });

  Model.add({title: 'Today', description: ''});
  Model.tasks.add({title: 'One'});
  const before = JSON.stringify(Model.getCurrent().tasks);

  assert.throws(() => Model.tasks.edit(2, {title: 'Bad'}), /Invalid tasks position/i);
  assert.throws(() => Model.tasks.remove(2), /Invalid tasks position/i);
  assert.throws(() => Model.tasks.remove(0), /Invalid tasks position/i);

  assert.equal(JSON.stringify(Model.getCurrent().tasks), before);
  assert.equal(fakeCollection.count(), 1);
});

test('create-list-model expone check solo para colecciones que lo necesitan', () => {
  const {createListModel} = loadFactory();
  const TodosModel = createListModel({
    dbName: 'todos',
    collectionName: 'todos',
    itemKey: 'tasks',
    itemHasCheck: true
  });
  const NotesModel = createListModel({
    dbName: 'notes',
    collectionName: 'notes',
    itemKey: 'notes'
  });

  TodosModel.add({title: 'Lista', description: ''});
  TodosModel.tasks.add({title: 'Uno'});
  TodosModel.tasks.add({title: 'Dos'});
  TodosModel.tasks.check([1]);

  assert.equal(typeof TodosModel.tasks.check, 'function');
  assert.equal(NotesModel.notes.check, undefined);
  assert.deepEqual(
    TodosModel.getCurrent().tasks.map(item => item.done),
    [false, true]
  );
});

test('create-list-model reorders nested tasks and preserves item fields', () => {
  const {createListModel} = loadFactory();
  const Model = createListModel({
    dbName: 'todos',
    collectionName: 'todos',
    itemKey: 'tasks',
    itemHasCheck: true
  });

  Model.add({title: 'Today', description: ''});
  Model.tasks.add({title: 'First', description: 'A', labels: ['a']});
  Model.tasks.add({title: 'Second', description: 'B', labels: ['b']});
  Model.tasks.add({title: 'Third', description: 'C', labels: ['c']});
  Model.tasks.check([1]);

  Model.tasks.reorder({fromIndex: 2, toIndex: 1});

  assert.deepEqual(
    Model.getCurrent().tasks.map(item => ({title: item.title, description: item.description, done: item.done, labels: item.labels})),
    [
      {title: 'Second', description: 'B', done: true, labels: ['b']},
      {title: 'First', description: 'A', done: false, labels: ['a']},
      {title: 'Third', description: 'C', done: false, labels: ['c']}
    ]
  );
});

test('create-list-model rechaza reorder inválido sin persistir ni notificar sync', () => {
  const {createListModel, fakeCollection, syncCalls} = loadFactory();
  const Model = createListModel({
    dbName: 'notes',
    collectionName: 'notes',
    itemKey: 'notes'
  });

  Model.add({title: 'Research', description: ''});
  Model.notes.add({title: 'Alpha', content: 'One', labels: ['x']});
  Model.notes.add({title: 'Beta', content: 'Two', labels: ['y']});
  Model.notes.add({title: 'Gamma', content: 'Three', labels: ['z']});

  Model.notes.reorder({fromIndex: 2, toIndex: 3});
  const updateCount = fakeCollection.updateCount();
  const syncCount = syncCalls.length;

  assert.throws(() => Model.notes.reorder({fromIndex: 1, toIndex: 0}), /Invalid notes position/i);
  assert.throws(() => Model.notes.reorder({fromIndex: 9, toIndex: 1}), /Invalid notes position/i);
  assert.throws(() => Model.notes.reorder({fromIndex: '1', toIndex: 2}), /Invalid notes position/i);

  assert.deepEqual(
    Model.getCurrent().notes.map(item => ({title: item.title, content: item.content, labels: item.labels})),
    [
      {title: 'Alpha', content: 'One', labels: ['x']},
      {title: 'Gamma', content: 'Three', labels: ['z']},
      {title: 'Beta', content: 'Two', labels: ['y']}
    ]
  );
  assert.equal(fakeCollection.updateCount(), updateCount);
  assert.equal(syncCalls.length, syncCount);
});
