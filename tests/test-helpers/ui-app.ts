const assert = require('node:assert/strict');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..', '..');
require('tsx/cjs');

const uiModulePath = path.join(repoRoot, 'ui', 'app.tsx');
const uiModuleRegistryPath = path.join(repoRoot, 'ui', 'module-registry.ts');

function countWord(output, word) {
  const pattern = String.raw`\b${word}\b`;
  const matches = output.match(new RegExp(pattern, 'gi'));
  return matches ? matches.length : 0;
}

function stripAnsi(output) {
  return output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function visibleLines(output) {
  return stripAnsi(output).split(/\r?\n/);
}

function terminalTitles(output) {
  return Array.from(output.matchAll(/\x1b\]0;([^\x07]*)\x07/g), match => match[1]);
}

function scopedOverlayLines(output, markerPattern) {
  const lines = visibleLines(output);
  const markerIndex = lines.findIndex(line => markerPattern.test(line));
  const frameText = lines.join('\n');

  assert.notEqual(markerIndex, -1, 'expected overlay marker ' + markerPattern + ' in:\n' + frameText);

  let startIndex = markerIndex;
  while (startIndex > 0 && !/┌/.test(lines[startIndex])) {
    startIndex -= 1;
  }

  const overlayLeft = lines[startIndex].lastIndexOf('┌');
  assert.notEqual(overlayLeft, -1, 'expected overlay top border for ' + markerPattern + ':\n' + frameText);

  let endIndex = markerIndex;
  while (endIndex < lines.length - 1 && lines[endIndex][overlayLeft] !== '└') {
    endIndex += 1;
  }

  assert.equal(lines[endIndex][overlayLeft], '└', 'expected overlay bottom border for ' + markerPattern + ':\n' + frameText);

  return lines.slice(startIndex, endIndex + 1);
}



function clickVisibleText(session, text, occurrence = 0) {
  const lines = visibleLines(session.output());
  let seen = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(text);

    if (column < 0) {
      continue;
    }

    if (seen === occurrence) {
      session.clickAt(column + 1, index + 1);
      return;
    }

    seen += 1;
  }

  assert.fail(`expected visible text target "${text}" in:
${lines.join('\n')}`);
}


function mousePrimaryPressSequence(x, y) {
  return `\x1b[<0;${x};${y}M`;
}

function mouseDragSequence(x, y) {
  return `\x1b[<32;${x};${y}M`;
}

function mouseWheelDownSequence(x, y) {
  return `\x1b[<65;${x};${y}M`;
}

function pressVisibleText(stdin, session, text, occurrence = 0) {
  const lines = visibleLines(session.output());
  let seen = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(text);

    if (column < 0) {
      continue;
    }

    if (seen === occurrence) {
      stdin.send(mousePrimaryPressSequence(column + 1, index + 1));
      return;
    }

    seen += 1;
  }

  assert.fail(`expected visible text target "${text}" in:
${lines.join('\n')}`);
}

function doublePressVisibleText(stdin, session, text, occurrence = 0) {
  pressVisibleText(stdin, session, text, occurrence);
  pressVisibleText(stdin, session, text, occurrence);
}

function wheelDownVisibleText(stdin, session, text, occurrence = 0) {
  const lines = visibleLines(session.output());
  let seen = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(text);

    if (column < 0) {
      continue;
    }

    if (seen === occurrence) {
      stdin.send(mouseWheelDownSequence(column + 1, index + 1));
      return;
    }

    seen += 1;
  }

  assert.fail(`expected visible wheel target "${text}" in:
${lines.join('\n')}`);
}


function firstVisibleCardTitle(output) {
  const line = visibleLines(output).find(value => /│\s*(?:[›•]\s*)?Card \d+/.test(value));
  const match = line && line.match(/Card \d+/);

  return match ? match[0] : null;
}

function findNodeById(nodes, id) {
  for (const node of nodes || []) {
    if (node.type === 'element' && node.props && node.props.id === id) {
      return node;
    }

    const child = findNodeById(node.children, id);

    if (child) {
      return child;
    }
  }

  return null;
}

function baseSnapshot(overrides: any = {}) {
  return {
    todo: {title: 'Today', items: [], remaining: 0},
    notes: {title: 'Notes list', items: [], remaining: 0},
    board: {title: 'Board view', columns: [], totalCards: 0},
    clocks: {items: [], remaining: 0},
    ...overrides
  };
}

function richSnapshot() {
  return baseSnapshot({
    todo: {title: 'Today', items: [{text: 'Ship read view', done: false}], remaining: 0},
    notes: {title: 'Research', items: [{text: 'Threat model'}], remaining: 0},
    board: {
      title: 'Launch board',
      totalCards: 2,
      columns: [
        {title: 'Backlog', count: 2, cards: ['Write tests', 'Wire UI']},
        {title: 'Done', count: 0, cards: []}
      ]
    },
    clocks: {items: [{name: 'UTC', time: '12:00'}, {name: 'Mexico City', time: '06:00'}], remaining: 0}
  });
}

function realBoardSnapshot() {
  return baseSnapshot({
    board: {
      title: 'Launch board',
      totalCards: 2,
      columns: [
        {
          index: 1,
          title: 'Backlog',
          count: 2,
          cards: [
            {title: 'Write tests', description: 'Cover the card overlay flows', position: 1},
            {title: 'Wire UI', description: '', position: 2}
          ],
          remaining: 0
        }
      ],
      remainingColumns: 0
    }
  });
}

class FakeStdin extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.rawMode = false;
    this.resumed = false;
    this.paused = false;
  }

  setRawMode(value) {
    this.rawMode = value;
  }

  resume() {
    this.resumed = true;
  }

  pause() {
    this.paused = true;
  }

  send(chunk) {
    this.emit('data', chunk);
  }
}

class FakeStdout extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.columns = 80;
    this.rows = 24;
    this.chunks = [];
  }

  write(chunk) {
    this.chunks.push(String(chunk));
    return true;
  }

  output() {
    return this.chunks.join('');
  }
}



async function loadUiWithPatchedModules(patch, run) {
  const originalLoad = Module._load;
  delete require.cache[require.resolve(uiModulePath)];
  delete require.cache[require.resolve(uiModuleRegistryPath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    const loaded = originalLoad.apply(this, arguments);
    return patch(request, parent, loaded);
  };

  try {
    const Ui = require(uiModulePath);
    return await run(Ui);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(uiModulePath)];
    delete require.cache[require.resolve(uiModuleRegistryPath)];
  }
}

async function loadUiWithSyncHook(syncHook, run) {
  const originalLoad = Module._load;
  delete require.cache[require.resolve(uiModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../sync/ilu-hooks' && parent && parent.filename === uiModulePath) {
      return syncHook;
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const Ui = require(uiModulePath);
    return await run(Ui);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(uiModulePath)];
  }
}

function boardSnapshotModels(board) {
  return {
    todos: {getCurrent: () => ({title: 'Today', tasks: []}), getFirst: () => null},
    notes: {getCurrent: () => ({title: 'Notes', notes: []}), getFirst: () => null},
    boards: {getCurrent: () => board, getFirst: () => null},
    clocks: {find: () => []}
  };
}

function orderedTextIndex(output, labels) {
  const text = stripAnsi(output);
  return labels.map(label => text.indexOf(label));
}

module.exports = {
  repoRoot,
  uiModulePath,
  uiModuleRegistryPath,
  countWord,
  stripAnsi,
  visibleLines,
  terminalTitles,
  scopedOverlayLines,
  clickVisibleText,
  mousePrimaryPressSequence,
  mouseDragSequence,
  mouseWheelDownSequence,
  pressVisibleText,
  doublePressVisibleText,
  wheelDownVisibleText,
  firstVisibleCardTitle,
  findNodeById,
  baseSnapshot,
  richSnapshot,
  realBoardSnapshot,
  FakeStdin,
  FakeStdout,
  loadUiWithPatchedModules,
  loadUiWithSyncHook,
  boardSnapshotModels,
  orderedTextIndex,
};
