const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const priorityPromptModulePath = path.join(repoRoot, 'scrumban', 'board-priority-prompt.ts');

test('priority prompt construye choices desde la columna completa', () => {
  delete require.cache[require.resolve(priorityPromptModulePath)];

  const {createCardChoices} = require(priorityPromptModulePath);

  assert.deepEqual(createCardChoices([
    {title: 'One', position: 1},
    {title: 'Two', position: 2}
  ]), [
    {name: '1. One', value: 1},
    {name: '2. Two', value: 2}
  ]);
});

test('priority prompt rechaza columnas con menos de dos cards', async () => {
  delete require.cache[require.resolve(priorityPromptModulePath)];

  const promptBoardPriority = require(priorityPromptModulePath);

  await assert.rejects(
    promptBoardPriority({columnTitle: 'Ready', cards: [{title: 'One', position: 1}]}),
    /at least two cards/
  );
});

test('priority prompt usa prompts nativos para elegir origen y destino', async () => {
  delete require.cache[require.resolve(priorityPromptModulePath)];

  const promptBoardPriority = require(priorityPromptModulePath);
  const calls = [];
  const promptsModule = {
    async prompt(questions) {
      calls.push(questions[0]);
      return calls.length === 1 ? {fromPosition: 3} : {toPosition: 1};
    }
  };

  const result = await promptBoardPriority({
    columnTitle: 'Ready',
    cards: [
      {title: 'One', position: 1},
      {title: 'Two', position: 2},
      {title: 'Three', position: 3}
    ],
    promptsModule
  });

  assert.deepEqual(result, {fromPosition: 3, toPosition: 1});
  assert.equal(calls[0].type, 'search');
  assert.equal(calls[1].type, 'number');
  assert.deepEqual(calls[1].defaultValue, 3);
});

test('priority prompt rechaza destino decimal desde la validación del prompt', async () => {
  delete require.cache[require.resolve(priorityPromptModulePath)];

  const promptBoardPriority = require(priorityPromptModulePath);
  const calls = [];
  const promptsModule = {
    async prompt(questions) {
      calls.push(questions[0]);
      return calls.length === 1 ? {fromPosition: 1} : {toPosition: 2};
    }
  };

  const result = await promptBoardPriority({
    columnTitle: 'Ready',
    cards: [
      {title: 'One', position: 1},
      {title: 'Two', position: 2}
    ],
    promptsModule
  });

  assert.deepEqual(result, {fromPosition: 1, toPosition: 2});
  assert.equal(typeof calls[1].validate, 'function');
  assert.match(calls[1].validate(1.5), /whole number|integer/i);
  assert.equal(calls[1].validate(2), true);
});

test('priority prompt devuelve null cuando origen y destino coinciden', async () => {
  delete require.cache[require.resolve(priorityPromptModulePath)];

  const promptBoardPriority = require(priorityPromptModulePath);
  const promptsModule = {
    async prompt(questions) {
      return questions[0].name === 'fromPosition' ? {fromPosition: 1} : {toPosition: 1};
    }
  };

  const result = await promptBoardPriority({
    columnTitle: 'Ready',
    cards: [
      {title: 'One', position: 1},
      {title: 'Two', position: 2}
    ],
    promptsModule
  });

  assert.equal(result, null);
});

test('priority prompt rechaza destino fuera de rango antes de devolver movimiento', async () => {
  delete require.cache[require.resolve(priorityPromptModulePath)];

  const promptBoardPriority = require(priorityPromptModulePath);
  const promptsModule = {
    async prompt(questions) {
      return questions[0].name === 'fromPosition' ? {fromPosition: 1} : {toPosition: 9};
    }
  };

  await assert.rejects(
    promptBoardPriority({
      columnTitle: 'Ready',
      cards: [
        {title: 'One', position: 1},
        {title: 'Two', position: 2}
      ],
      promptsModule
    }),
    /valid destination position/
  );
});
