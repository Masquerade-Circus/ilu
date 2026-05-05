const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const factoryModulePath = path.join(repoRoot, 'utils', 'create-list-model.js');
const hooksModulePath = path.join(repoRoot, 'sync', 'ilu-hooks.js');
const syncIndexModulePath = path.join(repoRoot, 'sync', 'index.js');

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
  const state = {syncIndexLoadCount: 0};

  delete require.cache[require.resolve(factoryModulePath)];
  delete require.cache[require.resolve(hooksModulePath)];
  delete require.cache[require.resolve(syncIndexModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (/sync-core/.test(request)) {
      throw new Error(`Unexpected sync-core import: ${request}`);
    }
    if (request === './load-db') {
      return () => ({getCollection() { return fakeCollection; }});
    }
    if (request === './index' && parent && parent.filename === hooksModulePath) {
      state.syncIndexLoadCount += 1;
      return {
        notifyLocalMutation: async (context) => {
          events.push(context);
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

  return {
    createListModel: require(factoryModulePath),
    state,
    restore() {
      Module._load = originalLoad;
      delete require.cache[require.resolve(factoryModulePath)];
      delete require.cache[require.resolve(hooksModulePath)];
      delete require.cache[require.resolve(syncIndexModulePath)];
    }
  };
}

test('list model routes persistence notifications through consumer hooks lazily', async () => {
  const events = [];
  const {createListModel, state, restore} = loadFactory(events);

  try {
    const Model = createListModel({dbName: 'todos', collectionName: 'todos', itemKey: 'tasks', itemHasCheck: true});

    assert.equal(state.syncIndexLoadCount, 0);

    Model.add({title: 'Lista', description: ''});
    Model.tasks.add({title: 'Uno'});
    Model.tasks.check([0]);
    Model.tasks.edit(1, {title: 'Dos'});
    Model.tasks.remove(1);

    await new Promise(resolve => setImmediate(resolve));

    assert.equal(state.syncIndexLoadCount, 5);
    assert.deepEqual(events, [
      {domain: 'todos', action: 'use'},
      {domain: 'todos', action: 'save'},
      {domain: 'todos', action: 'save'},
      {domain: 'todos', action: 'save'},
      {domain: 'todos', action: 'save'}
    ]);
  } finally {
    restore();
  }
});
