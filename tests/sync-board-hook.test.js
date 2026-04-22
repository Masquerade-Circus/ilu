const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const modelModulePath = path.join(repoRoot, 'scrumban', 'model.js');

function createCollection() {
  const items = [];
  let sequence = 1;

  return {
    count() { return items.length; },
    add(doc) {
      const inserted = {...doc, $id: String(sequence++)};
      items.push(inserted);
      return inserted;
    },
    get(id) { return items.find(item => item.$id === id); },
    find(query = {}) {
      return items.filter(item => Object.entries(query).every(([key, value]) => item[key] === value)).sort((a, b) => a.index - b.index);
    },
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

function loadBoardModel(events) {
  const originalLoad = Module._load;
  const fakeCollection = createCollection();

  delete require.cache[require.resolve(modelModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../utils/load-db') {
      return () => ({getCollection() { return fakeCollection; }});
    }
    if (request === '../sync/ilu-hooks') {
      return async (context) => {
        events.push(context);
      };
    }
    return originalLoad.apply(this, arguments);
  };

  try {
    return require(modelModulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(modelModulePath)];
  }
}

test('board model notifies sync after board persistence', async () => {
  const events = [];
  const Model = loadBoardModel(events);

  Model.add({title: 'Board', description: ''});
  Model.cards.add({title: 'Card'});
  Model.cards.edit({columnIndex: 1, position: 1, values: {title: 'Card 2'}});
  Model.cards.remove({columnIndex: 1, positions: [1]});

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length >= 3, true);
  assert.equal(events.every(event => event.domain === 'boards'), true);
});
