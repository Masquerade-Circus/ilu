const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {PassThrough} = require('node:stream');

const repoRoot = path.resolve(__dirname, '..');
const priorityPromptModulePath = path.join(repoRoot, 'scrumban', 'board-priority-prompt.js');

function createInteractiveStream() {
  const stream = new PassThrough();
  stream.isTTY = true;
  stream.isRaw = false;
  stream.setRawMode = (value) => {
    stream.isRaw = value;
  };
  return stream;
}

test('priority prompt reducer inicia sobre la columna completa y toma, mueve y suelta una card', () => {
  delete require.cache[require.resolve(priorityPromptModulePath)];

  const {createState, reducePriorityPrompt} = require(priorityPromptModulePath);
  let state = createState({
    columnTitle: 'Ready',
    cards: [
      {title: 'One', position: 1},
      {title: 'Two', position: 2},
      {title: 'Three', position: 3}
    ]
  });

  state = reducePriorityPrompt(state, 'space');
   state = reducePriorityPrompt(state, 'down');
   state = reducePriorityPrompt(state, 'space');

  assert.equal(state.dragging, false);
  assert.equal(state.cursorIndex, 1);
  assert.deepEqual(state.cards.map(card => card.title), ['Two', 'One', 'Three']);
  assert.deepEqual(state.pendingMove, {
    fromPosition: 1,
    toPosition: 2
  });
});

test('priority prompt reducer solo confirma con enter cuando no está arrastrando', () => {
  delete require.cache[require.resolve(priorityPromptModulePath)];

  const {createState, reducePriorityPrompt} = require(priorityPromptModulePath);
  let state = createState({
    columnTitle: 'Ready',
    cards: [
      {title: 'One', position: 1},
      {title: 'Two', position: 2}
    ]
  });

  state = reducePriorityPrompt(state, 'space');
  state = reducePriorityPrompt(state, 'enter');

  assert.equal(state.status, 'idle');

  state = reducePriorityPrompt(state, 'space');
  state = reducePriorityPrompt(state, 'enter');

  assert.equal(state.status, 'confirmed');
});

test('priority prompt reducer cancela con escape sin generar movimiento pendiente', () => {
  delete require.cache[require.resolve(priorityPromptModulePath)];

  const {createState, reducePriorityPrompt} = require(priorityPromptModulePath);
  let state = createState({
    columnTitle: 'Ready',
    cards: [
      {title: 'One', position: 1},
      {title: 'Two', position: 2}
    ]
  });

  state = reducePriorityPrompt(state, 'space');
  state = reducePriorityPrompt(state, 'escape');

  assert.equal(state.status, 'cancelled');
  assert.equal(state.pendingMove, null);
});

test('priority prompt reconoce Space aunque keypress solo entregue sequence', async () => {
  delete require.cache[require.resolve(priorityPromptModulePath)];

  const promptBoardPriority = require(priorityPromptModulePath);
  const input = createInteractiveStream();
  const output = new PassThrough();
  const resultPromise = promptBoardPriority({
    columnTitle: 'Ready',
    cards: [
      {title: 'One', position: 1},
      {title: 'Two', position: 2},
      {title: 'Three', position: 3}
    ],
    input,
    output
  });

  input.emit('keypress', ' ', {sequence: ' '});
  input.emit('keypress', '\u001b[B', {name: 'down', sequence: '\u001b[B'});
  input.emit('keypress', ' ', {sequence: ' '});
  input.emit('keypress', '\r', {name: 'return', sequence: '\r'});

  const result = await resultPromise;

  assert.deepEqual(result, {
    fromPosition: 1,
    toPosition: 2
  });
});
