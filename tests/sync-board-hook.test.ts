const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const modelModulePath = path.join(repoRoot, 'scrumban', 'model.ts');
const hooksModulePath = path.join(repoRoot, 'sync', 'ilu-hooks.ts');
const syncIndexModulePath = path.join(repoRoot, 'sync', 'index.ts');

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
    find(query: any = {}) {
      return items.filter(item => Object.entries(query).every(([key, value]) => item[key] === value)).sort((a, b) => a.index - b.index);
    },
    findOne(query: any = {}) { return this.find(query)[0]; },
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
  const state = {syncIndexLoadCount: 0};

  delete require.cache[require.resolve(modelModulePath)];
  delete require.cache[require.resolve(hooksModulePath)];
  delete require.cache[require.resolve(syncIndexModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (/sync-core/.test(request)) {
      throw new Error(`Unexpected sync-core import: ${request}`);
    }
    if (request === '../utils/load-db') {
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
    return originalLoad.apply(this, arguments);
  };

  return {
    Model: require(modelModulePath),
    state,
    restore() {
      Module._load = originalLoad;
      delete require.cache[require.resolve(modelModulePath)];
      delete require.cache[require.resolve(hooksModulePath)];
      delete require.cache[require.resolve(syncIndexModulePath)];
    }
  };
}

test('board model routes persistence notifications through consumer hooks lazily', async () => {
  const events = [];
  const {Model, state, restore} = loadBoardModel(events);

  try {
    assert.equal(state.syncIndexLoadCount, 0);

    Model.add({title: 'Board', description: ''});
    Model.cards.add({title: 'Card'});
    Model.cards.edit({columnIndex: 1, position: 1, values: {title: 'Card 2'}});
    Model.cards.move({fromColumn: 1, fromPosition: 1, toColumn: 2});
    Model.cards.remove({columnIndex: 1, positions: [1]});

    await new Promise(resolve => setImmediate(resolve));

    assert.equal(state.syncIndexLoadCount, 5);
    assert.deepEqual(events, [
      {domain: 'boards', action: 'use'},
      {domain: 'boards', action: 'save'},
      {domain: 'boards', action: 'save'},
      {domain: 'boards', action: 'save'},
      {domain: 'boards', action: 'save'}
    ]);
  } finally {
    restore();
  }
});
