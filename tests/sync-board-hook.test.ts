import test from 'node:test';
import assert from 'node:assert/strict';
import { configureSyncExecutor } from '../sync/ilu-hooks';
import { withTempHome } from '../support/home-sandbox';

async function loadBoardModel(events) {
  const state = {syncIndexLoadCount: 0};
  const restoreExecutor = configureSyncExecutor({
    sync: async (context) => {
      state.syncIndexLoadCount += 1;
      events.push(context);
    }
  });
  const modelUrl = new URL('../scrumban/model.ts', import.meta.url);
  modelUrl.searchParams.set('hook', `${Date.now()}-${Math.random()}`);
  const modelModule = await import(modelUrl.href);

  return {
    Model: modelModule.default,
    state,
    restore() {
      restoreExecutor();
    }
  };
}

test('board model routes persistence notifications through consumer hooks lazily', async () => {
  return withTempHome(async () => {
    const events = [];
    const {Model, state, restore} = await loadBoardModel(events);

    try {
      assert.equal(state.syncIndexLoadCount, 0);

      Model.add({title: 'Board', description: ''});
      Model.cards.add({title: 'Card'});
      Model.cards.edit({columnIndex: 1, position: 1, values: {title: 'Card 2'}});
      Model.cards.move({fromColumn: 1, fromPosition: 1, toColumn: 2});
      Model.cards.remove({columnIndex: 2, positions: [1]});

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
  }, {prefix: 'ilu-board-hook-'});
});
