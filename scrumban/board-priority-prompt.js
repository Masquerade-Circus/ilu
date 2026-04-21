const readline = require('node:readline');

function cloneCards(cards = []) {
  return cards.map(card => ({...card}));
}

function createState({columnTitle, cards, selectedPosition}) {
  return {
    columnTitle,
    cards: cloneCards(cards),
    cursorIndex: Math.max(0, (selectedPosition || 1) - 1),
    originalIndex: Math.max(0, (selectedPosition || 1) - 1),
    dragging: false,
    pendingMove: null,
    status: 'idle'
  };
}

function swapCards(cards, leftIndex, rightIndex) {
  const nextCards = cloneCards(cards);
  const temporary = nextCards[leftIndex];
  nextCards[leftIndex] = nextCards[rightIndex];
  nextCards[rightIndex] = temporary;
  return nextCards;
}

function updatePendingMove(state) {
  if (state.cursorIndex === state.originalIndex) {
    return null;
  }

  return {
    fromPosition: state.originalIndex + 1,
    toPosition: state.cursorIndex + 1
  };
}

function reducePriorityPrompt(state, key) {
  if (state.status !== 'idle') {
    return state;
  }

  if (key === 'escape' || key === 'ctrl+c') {
    return {...state, status: 'cancelled', dragging: false, pendingMove: null};
  }

  if (key === 'enter') {
    if (state.dragging) {
      return state;
    }

    return {...state, status: 'confirmed'};
  }

  if (key === 'space') {
    if (!state.dragging) {
      return {...state, dragging: true};
    }

    return {...state, dragging: false, pendingMove: updatePendingMove(state)};
  }

  if (key !== 'up' && key !== 'down') {
    return state;
  }

  const delta = key === 'up' ? -1 : 1;
  const nextCursorIndex = state.cursorIndex + delta;

  if (nextCursorIndex < 0 || nextCursorIndex >= state.cards.length) {
    return state;
  }

  if (!state.dragging) {
    return {...state, cursorIndex: nextCursorIndex};
  }

  const cards = swapCards(state.cards, state.cursorIndex, nextCursorIndex);

  return {
    ...state,
    cards,
    cursorIndex: nextCursorIndex,
    pendingMove: {
      fromPosition: state.originalIndex + 1,
      toPosition: nextCursorIndex + 1
    }
  };
}

function getCardPrefix(state, index) {
  const isCursor = state.cursorIndex === index;
  const isDragging = state.dragging && isCursor;

  if (isDragging) {
    return '●';
  }

  if (isCursor) {
    return '›';
  }

  return ' ';
}

function render(state) {
  const instructions = state.dragging
    ? 'Space suelta · ↑/↓ reordena · Enter deshabilitado mientras arrastras · Esc cancela'
    : 'Space toma/suelta · ↑/↓ navega o reordena · Enter confirma · Esc cancela';

  return [
    `Reorder card priority in ${state.columnTitle}`,
    instructions,
    '',
    ...state.cards.map((card, index) => `${getCardPrefix(state, index)} ${index + 1}. ${card.title}`)
  ].join('\n');
}

function failInteractivePrompt(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function mapKey(_, key = {}) {
  const sequence = typeof key.sequence === 'string' ? key.sequence : _;

  if (key.ctrl && key.name === 'c') {
    return 'ctrl+c';
  }

  if (key.name === 'return') {
    return 'enter';
  }

  if (key.name === 'escape') {
    return 'escape';
  }

  if (key.name === 'space') {
    return 'space';
  }

  if (sequence === ' ') {
    return 'space';
  }

  if (key.name === 'up') {
    return 'up';
  }

  if (key.name === 'down') {
    return 'down';
  }

  return null;
}

async function promptBoardPriority({columnTitle, cards, selectedPosition, input = process.stdin, output = process.stdout} = {}) {
  if (!input || !input.isTTY) {
    failInteractivePrompt('This command requires an interactive terminal (TTY). Piped or non-interactive stdin is not supported.');
  }

  return new Promise(resolve => {
    let state = createState({columnTitle, cards, selectedPosition});
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
      const mappedKey = mapKey(sequence, key);

      if (!mappedKey) {
        return;
      }

      state = reducePriorityPrompt(state, mappedKey);

      if (mappedKey === 'ctrl+c') {
        cleanup();
        failInteractivePrompt('Interactive prompt cancelled or closed before completion.');
        return;
      }

      if (state.status === 'cancelled') {
        finish(null);
        return;
      }

      if (state.status === 'confirmed') {
        finish(state.pendingMove);
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

module.exports = Object.assign(promptBoardPriority, {
  createState,
  reducePriorityPrompt,
  render
});
