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
    count() { return items.length; },
    add(doc) {
      const inserted = {...doc, $id: String(sequence++)};
      items.push(inserted);
      return inserted;
    },
    get(id) { return items.find(item => item.$id === id); },
    find(query = {}) { return items.filter(item => matchesQuery(item, query)).sort((a, b) => a.index - b.index); },
    findOne(query = {}) { return this.find(query)[0]; },
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

function loadFactory(events) {
  const originalLoad = Module._load;
  const fakeCollection = createCollection();

  delete require.cache[require.resolve(factoryModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './load-db') {
      return () => ({getCollection() { return fakeCollection; }});
    }
    if (request === '../sync/ilu-hooks') {
      return async (context) => {
        events.push(context);
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
    return require(factoryModulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(factoryModulePath)];
  }
}

test('list model notifies sync after persistence mutations', async () => {
  const events = [];
  const createListModel = loadFactory(events);
  const Model = createListModel({dbName: 'todos', collectionName: 'todos', itemKey: 'tasks', itemHasCheck: true});

  Model.add({title: 'Lista', description: ''});
  Model.tasks.add({title: 'Uno'});
  Model.tasks.check([0]);
  Model.tasks.edit(1, {title: 'Dos'});
  Model.tasks.remove(1);

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length >= 5, true);
  assert.equal(events.every(event => event.domain === 'todos'), true);
});
