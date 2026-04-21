const test = require('node:test');
const assert = require('node:assert/strict');

const promptModule = require('../notes/inline-note-prompt');

test('inline note prompt agrega texto al final y Ctrl+N inserta nueva línea', () => {
  let state = promptModule.createState({message: 'Content of the note'});

  state = promptModule.reduceInlineNotePrompt(state, {type: 'input', value: 'H'});
  state = promptModule.reduceInlineNotePrompt(state, {type: 'input', value: 'o'});
  state = promptModule.reduceInlineNotePrompt(state, {type: 'input', value: 'l'});
  state = promptModule.reduceInlineNotePrompt(state, {type: 'input', value: 'a'});
  state = promptModule.reduceInlineNotePrompt(state, {type: 'newline'});
  state = promptModule.reduceInlineNotePrompt(state, {type: 'input', value: 'm'});
  state = promptModule.reduceInlineNotePrompt(state, {type: 'input', value: 'u'});
  state = promptModule.reduceInlineNotePrompt(state, {type: 'input', value: 'n'});
  state = promptModule.reduceInlineNotePrompt(state, {type: 'input', value: 'd'});
  state = promptModule.reduceInlineNotePrompt(state, {type: 'input', value: 'o'});

  assert.equal(state.value, 'Hola\nmundo');
  assert.equal(state.status, 'idle');
});

test('inline note prompt confirma con Enter y conserva contenido inicial al editar', () => {
  let state = promptModule.createState({message: 'Content of the note', initialValue: 'Base'});

  state = promptModule.reduceInlineNotePrompt(state, {type: 'input', value: '!'});
  state = promptModule.reduceInlineNotePrompt(state, {type: 'confirm'});

  assert.equal(state.status, 'confirmed');
  assert.equal(state.value, 'Base!');
});

test('inline note prompt cancela con Esc', () => {
  const state = promptModule.reduceInlineNotePrompt(
    promptModule.createState({message: 'Content of the note', initialValue: 'Base'}),
    {type: 'cancel'}
  );

  assert.equal(state.status, 'cancelled');
  assert.equal(state.value, 'Base');
});

test('inline note prompt renderiza instrucciones y contenido actual', () => {
  const output = promptModule.render(
    promptModule.createState({message: 'Content of the note', initialValue: 'Linea 1\nLinea 2'})
  );

  assert.match(output, /Enter confirma/);
  assert.match(output, /Ctrl\+N nueva línea/);
  assert.match(output, /Esc cancela/);
  assert.match(output, /Linea 1/);
  assert.match(output, /Linea 2/);
});
