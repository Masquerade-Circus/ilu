const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const factoryModulePath = path.join(repoRoot, 'utils', 'create-list-model.js');

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

function loadFactory() {
  const originalLoad = Module._load;
  const fakeCollection = createCollection();

  delete require.cache[require.resolve(factoryModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './load-db') {
      return () => ({
        getCollection(name) {
          return fakeCollection;
        }
      });
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
      fakeCollection
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
