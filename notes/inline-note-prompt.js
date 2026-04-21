const readline = require('node:readline');

function createState({message, initialValue = ''} = {}) {
  return {
    message: message || 'Content',
    value: initialValue,
    status: 'idle'
  };
}

function reduceInlineNotePrompt(state, action = {}) {
  if (state.status !== 'idle') {
    return state;
  }

  switch (action.type) {
    case 'input':
      if (!action.value) {
        return state;
      }

      return {...state, value: `${state.value}${action.value}`};
    case 'newline':
      return {...state, value: `${state.value}\n`};
    case 'backspace':
      if (state.value.length === 0) {
        return state;
      }

      return {...state, value: state.value.slice(0, -1)};
    case 'confirm':
      return {...state, status: 'confirmed'};
    case 'cancel':
      return {...state, status: 'cancelled'};
    default:
      return state;
  }
}

function render(state) {
  const content = state.value.length > 0 ? state.value : '(empty)';

  return [
    state.message,
    'Enter confirma · Ctrl+N nueva línea · Shift+Enter nueva línea (si la terminal lo reporta) · Esc cancela',
    '',
    content
  ].join('\n');
}

function failInteractivePrompt(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function mapKey(sequence, key = {}) {
  if (key.ctrl && key.name === 'c') {
    return {type: 'interrupt'};
  }

  if (key.ctrl && key.name === 'n') {
    return {type: 'newline'};
  }

  if (key.name === 'escape') {
    return {type: 'cancel'};
  }

  if (key.name === 'backspace') {
    return {type: 'backspace'};
  }

  if ((key.name === 'return' || key.name === 'enter') && key.shift) {
    return {type: 'newline'};
  }

  if (key.name === 'return' || key.name === 'enter') {
    return {type: 'confirm'};
  }

  if (typeof sequence === 'string' && sequence.length > 0 && !key.ctrl && !key.meta) {
    return {type: 'input', value: sequence};
  }

  return null;
}

async function promptInlineNote({message, initialValue = '', input = process.stdin, output = process.stdout} = {}) {
  if (!input || !input.isTTY) {
    failInteractivePrompt('This command requires an interactive terminal (TTY). Piped or non-interactive stdin is not supported.');
  }

  return new Promise(resolve => {
    let state = createState({message, initialValue});
    const wasRaw = typeof input.isRaw === 'boolean' ? input.isRaw : false;

    function cleanup() {
      input.removeListener('keypress', handleKeypress);
      if (typeof input.setRawMode === 'function') {
        input.setRawMode(wasRaw);
      }
      if (typeof input.pause === 'function') {
        input.pause();
      }
    }

    function draw() {
      if (typeof readline.cursorTo === 'function') {
        readline.cursorTo(output, 0, 0);
      }
      if (typeof readline.clearScreenDown === 'function') {
        readline.clearScreenDown(output);
      }
      output.write(`${render(state)}\n`);
    }

    function finish(value) {
      cleanup();
      if (output !== process.stdout) {
        output.write('\n');
      }
      resolve(value);
    }

    function handleKeypress(sequence, key) {
      const action = mapKey(sequence, key);

      if (!action) {
        return;
      }

      if (action.type === 'interrupt') {
        cleanup();
        failInteractivePrompt('Interactive prompt cancelled or closed before completion.');
        return;
      }

      state = reduceInlineNotePrompt(state, action);

      if (state.status === 'cancelled') {
        finish(null);
        return;
      }

      if (state.status === 'confirmed') {
        finish(state.value);
        return;
      }

      draw();
    }

    readline.emitKeypressEvents(input);
    if (typeof input.setRawMode === 'function') {
      input.setRawMode(true);
    }
    if (typeof input.resume === 'function') {
      input.resume();
    }

    input.on('keypress', handleKeypress);
    draw();
  });
}

module.exports = Object.assign(promptInlineNote, {
  createState,
  reduceInlineNotePrompt,
  render,
  mapKey
});
