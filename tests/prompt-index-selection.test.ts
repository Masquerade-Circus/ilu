require('colors');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const promptSelectionModulePath = path.join(repoRoot, 'utils', 'prompt-index-selection.ts');

function loadPromptSelectionWithStubs({promptAnswers = []}: any = {}) {
  const originalLoad = Module._load;
  const promptCalls = [];
  const queuedAnswers = Array.isArray(promptAnswers) ? [...promptAnswers] : [promptAnswers];

  delete require.cache[require.resolve(promptSelectionModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './prompts') {
      return {
        prompt: async (questions) => {
          promptCalls.push(questions);

          if (queuedAnswers.length === 0) {
            throw new Error('No prompt answers left');
          }

          return queuedAnswers.shift();
        }
      };
    }

    if (request === './') {
      return {
        log: {
          info() {}
        }
      };
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const promptSelection = require(promptSelectionModulePath);
    return {promptSelection, promptCalls};
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(promptSelectionModulePath)];
  }
}

test('selectOne uses a searchable prompt, filters choices by name, and returns the selected index', {concurrency: false}, async () => {
  const {promptSelection, promptCalls} = loadPromptSelectionWithStubs({
    promptAnswers: [{index: 2}]
  });

  const selectedIndex = await promptSelection.selectOne(
    [
      {title: 'Write docs'},
      {title: 'Fix Login'},
      {title: 'Ship release'}
    ],
    {
      message: 'Select an item',
      emptyMessage: 'No items',
      getChoiceName: item => item.title
    }
  );

  assert.equal(selectedIndex, 2);
  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].type, 'search');
  assert.equal(promptCalls[0][0].name, 'index');

  assert.deepEqual(promptCalls[0][0].choices, [
    {name: 'Write docs', value: 1},
    {name: 'Fix Login', value: 2},
    {name: 'Ship release', value: 3}
  ]);
});
