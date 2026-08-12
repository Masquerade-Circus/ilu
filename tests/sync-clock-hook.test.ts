import test from 'node:test';
import assert from 'node:assert/strict';
import { configureSyncExecutor } from '../sync/ilu-hooks';
import { withTempHome } from '../support/home-sandbox';

async function loadClocksModel(events) {
  const state = {syncIndexLoadCount: 0};
  const restoreExecutor = configureSyncExecutor({
    sync: async (context) => {
      state.syncIndexLoadCount += 1;
      events.push(context);
    }
  });
  const modelUrl = new URL('../clocks/model.ts', import.meta.url);
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

test('clock model routes persistence notifications through consumer hooks lazily', async () => {
  return withTempHome(async () => {
    const events = [];
    const {Model, state, restore} = await loadClocksModel(events);

    try {
      assert.equal(state.syncIndexLoadCount, 0);

      Model.add({name: 'UTC', timezone: 'UTC'});
      Model.remove(1);
      Model.remove([]);

      await new Promise(resolve => setImmediate(resolve));

      assert.equal(state.syncIndexLoadCount, 3);
      assert.deepEqual(events, [
        {domain: 'clocks', action: 'save'},
        {domain: 'clocks', action: 'save'},
        {domain: 'clocks', action: 'save'}
      ]);
    } finally {
      restore();
    }
  }, {prefix: 'ilu-clock-hook-'});
});
