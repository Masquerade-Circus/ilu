import test from 'node:test';
import assert from 'node:assert/strict';
import createListModel from '../utils/create-list-model';
import { configureSyncExecutor } from '../sync/ilu-hooks';
import { withTempHome } from '../support/home-sandbox';

function loadFactory(events) {
  const state = {syncIndexLoadCount: 0};
  const restoreExecutor = configureSyncExecutor({
    notifyLocalMutation: async (context) => {
      state.syncIndexLoadCount += 1;
      events.push(context);
    }
  });

  return {
    createListModel,
    state,
    restore() {
      restoreExecutor();
    }
  };
}

test('list model routes persistence notifications through consumer hooks lazily', async () => {
  return withTempHome(async () => {
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
  }, {prefix: 'ilu-list-hook-'});
});
