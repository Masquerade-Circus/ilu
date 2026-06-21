const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
process.env.TSX_TSCONFIG_PATH = path.join(repoRoot, 'tsconfig.ui.json');
require('tsx/cjs');

const Ui = require('../ui/app.tsx');

function visible(output) {
  return output.replace(/\[[0-?]*[ -/]*[@-~]/g, '');
}

function visibleLines(output) {
  return visible(output).split(/\r?\n/);
}

function snapshot(clocks = [
  {name: 'UTC', timezone: 'Etc/UTC', time: '12:00', position: 1},
  {name: 'Mexico City', timezone: 'America/Mexico_City', time: '06:00', position: 2}
]) {
  return {
    todo: {title: 'Today', items: [], remaining: 0},
    notes: {title: 'Notes', items: [], remaining: 0},
    board: {title: 'Board', columns: [], totalCards: 0},
    clocks: {items: clocks, remaining: 0}
  };
}

test('Clocks UI exposes approved empty state and direct action bar controls', async () => {
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Clocks'}, snapshot: snapshot([])});
  const output = visible(session.output());

  assert.match(output, /No clocks yet\. Add a clock to see it here\./);
  assert.equal(visibleLines(session.output()).some(line => line.trim() === 'Clocks'), false);
  assert.match(output, /Add clock/);
  assert.match(output, /Move up/);
  assert.match(output, /Move down/);
  assert.match(output, /Remove/);
  assert.doesNotMatch(output, /Reorder clocks/);
  assert.doesNotMatch(output, /clocks command|adapter|snapshot|runtime|criteria/i);
  session.destroy();
});

test('Clocks UI shows names and timezones in the page and names with seconds in the footer', async () => {
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Clocks'}, snapshot: snapshot([
    {name: 'UTC', timezone: 'Etc/UTC', time: '12:00:03', position: 1},
    {name: 'Mexico City', timezone: 'America/Mexico_City', time: '06:00:04', position: 2}
  ])});
  const output = visible(session.output());
  const footerLine = output.split(/\r?\n/).find(line => line.includes('Ctrl+K: Help  Ctrl+C: Exit')) || '';

  assert.match(output, /UTC/);
  assert.match(output, /Etc\/UTC/);
  assert.match(output, /Mexico City/);
  assert.match(output, /America\/Mexico_City/);
  assert.match(footerLine, /UTC 12:00:03/);
  assert.match(footerLine, /Mexico City 06:00:04/);
  assert.doesNotMatch(footerLine, /Etc\/UTC|America\/Mexico_City/);
  session.destroy();
});

test('Clocks footer keeps 80-column layout when clock names and seconds do not fit', async () => {
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Clocks'},
    snapshot: snapshot([
      {name: 'Extremely Long Clock Name One', timezone: 'Etc/UTC', time: '12:00:03', position: 1},
      {name: 'Extremely Long Clock Name Two', timezone: 'America/Mexico_City', time: '06:00:04', position: 2},
      {name: 'Extremely Long Clock Name Three', timezone: 'Europe/Madrid', time: '18:00:05', position: 3},
      {name: 'Extremely Long Clock Name Four', timezone: 'Asia/Tokyo', time: '02:00:06', position: 4}
    ])
  });
  const lines = visibleLines(session.output());
  const footerLine = lines.find(line => line.includes('Ctrl+K: Help  Ctrl+C: Exit')) || '';

  assert.ok(footerLine.length <= 80, `expected compact footer within 80 columns, got ${footerLine.length}: ${footerLine}`);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});

test('Clocks footer renders deterministic ANSI colors per visible clock', async () => {
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Clocks'}, snapshot: snapshot([
    {name: 'UTC', timezone: 'Etc/UTC', time: '12:00:03', position: 1},
    {name: 'Mexico City', timezone: 'America/Mexico_City', time: '06:00:04', position: 2}
  ])});

  try {
    const ansi = session.ansiOutput();
    const ansiSpan = String.raw`(?:\x1b\[[0-?]*[ -/]*[@-~])*`;

    assert.match(ansi, new RegExp(String.raw`\x1b\[38;2;248;113;113m${ansiSpan}UTC 12:00:03`));
    assert.match(ansi, new RegExp(String.raw`\x1b\[38;2;96;165;250m${ansiSpan}Mexico City 06:00:04`));
  } finally {
    session.destroy();
  }
});

test('Clocks footer refreshes automatically each second and stops after destroy', async () => {
  let second = 0;
  let calls = 0;
  const buildSnapshot = () => {
    calls += 1;
    return snapshot([{
      name: 'UTC',
      timezone: 'Etc/UTC',
      time: `12:00:${String(second).padStart(2, '0')}`,
      position: 1
    }]);
  };
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Clocks'}, buildSnapshot});

  assert.match(visible(session.output()), /UTC 12:00:00/);
  second = 1;
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.match(visible(session.output()), /UTC 12:00:01/);

  session.destroy();
  const callsAfterDestroy = calls;
  second = 2;
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(calls, callsAfterDestroy);
});

test('Clocks add workflow exposes required name and timezone search copy before save', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Clocks'},
    snapshot: snapshot(),
    clockActions: {
      addClock(values) {
        calls.push(values);
        return {ok: false, error: 'Clock name is required.'};
      }
    }
  });

  session.click('clock-add-open');
  session.click('clock-add-save');

  const output = visible(session.output());
  assert.match(output, /Add clock/);
  assert.match(output, /Clock name/);
  assert.match(output, /Time zone/);
  assert.match(output, /Search time zones/);
  assert.doesNotMatch(output, /\bTimezone\b/);
  assert.doesNotMatch(output, /Search timezone/);
  assert.match(output, /Clock name is required\./);
  assert.deepEqual(calls, []);
  session.destroy();
});

test('Clocks add workflow requires a selected timezone before calling the action', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Clocks'},
    snapshot: snapshot(),
    clockActions: {
      addClock(values) {
        calls.push(values);
        return {ok: true};
      }
    }
  });

  session.click('clock-add-open');
  session.focus('clock-add-name');
  session.dispatchText('Local');
  session.click('clock-add-save');

  assert.match(visible(session.output()), /Choose a time zone from the list\./);
  assert.deepEqual(calls, []);
  session.destroy();
});

test('Clocks list press opens clock details with per-clock actions', async () => {
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Clocks'}, snapshot: snapshot()});

  session.focus('clock-items');
  session.dispatchKey('ENTER');

  const output = visible(session.output());
  assert.match(output, /Clock details/);
  assert.match(output, /UTC/);
  assert.match(output, /Time zone: Etc\/UTC/);
  assert.match(output, /Move up/);
  assert.match(output, /Move down/);
  assert.match(output, /Remove/);
  assert.match(output, /Close/);
  session.destroy();
});



test('Clocks remove overlay pins destructive action and cancel to the overlay bottom', async () => {
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, state: {activeTab: 'Clocks'}, snapshot: snapshot()});

  session.click('clock-remove-open');

  const lines = visibleLines(session.output());
  const actionRow = lines.findIndex(line => /Remove clock/.test(line) && /Cancel/.test(line));

  assert.notEqual(actionRow, -1, `expected Clocks remove actions:\n${lines.join('\n')}`);
  assert.equal(actionRow, 20, `Clocks remove actions must render on the last internal overlay row:\n${lines.join('\n')}`);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});

test('Clocks remove workflow requires explicit visible confirmation for the selected clock', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Clocks'},
    snapshot: snapshot(),
    clockActions: {
      removeClocks(values) {
        calls.push(values);
        return {ok: true};
      }
    }
  });

  session.click('clock-remove-open');
  assert.match(visible(session.output()), /Remove “UTC”\?/);
  session.click('clock-remove-confirm');

  assert.deepEqual(calls, [{positions: [1]}]);
  session.destroy();
});

test('Clocks priority workflow moves the selected clock through direct action bar controls', async () => {
  const calls = [];
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Clocks'},
    snapshot: snapshot(),
    clockActions: {
      moveClock(values) {
        calls.push(values);
        return {ok: true};
      }
    }
  });

  assert.doesNotMatch(visible(session.output()), /Choose a clock to move\./);
  session.click('clock-move-down');

  assert.deepEqual(calls, [{fromPosition: 1, toPosition: 2}]);
  session.destroy();
});

test('Clocks overlay closes visually when switching away from Clocks by keyboard shortcut', async () => {
  const session = await Ui.createHeadlessSession({state: {activeTab: 'Clocks'}, snapshot: snapshot()});

  session.click('clock-add-open');
  assert.match(visible(session.output()), /Clock name/);
  session.dispatchKey('CTRL_1');

  const output = visible(session.output());
  assert.match(output, /Todo/);
  assert.doesNotMatch(output, /Clock name|Search time zones|Search timezone/);
  session.destroy();
});

test('Clocks remove workflow shows safe errors without closing the confirmation', async () => {
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Clocks'},
    snapshot: snapshot(),
    clockActions: {
      removeClocks() {
        return {ok: false, error: 'Clock could not be removed. Try again.'};
      }
    }
  });

  session.click('clock-remove-open');
  session.click('clock-remove-confirm');

  const output = visible(session.output());
  assert.match(output, /Remove “UTC”\?/);
  assert.match(output, /Clock could not be removed\. Try again\./);
  session.destroy();
});

test('Clocks add and remove overlays use the full overlay surface without inset margins', async () => {
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Clocks'},
    snapshot: snapshot()
  });

  session.click('clock-add-open');
  const addLines = visibleLines(session.output());
  assert.equal(addLines.filter(line => line.length > 80).length, 0, `expected no overdraw in add overlay:\n${addLines.join('\n')}`);
  assert.equal(addLines.some(line => line.startsWith('          ') && line.includes('Add clock')), false, 'expected add overlay content not to be inset by the old 10% margin');

  session.click('clock-add-cancel');
  session.click('clock-remove-open');
  const removeLines = visibleLines(session.output());
  assert.equal(removeLines.filter(line => line.length > 80).length, 0, `expected no overdraw in remove overlay:\n${removeLines.join('\n')}`);
  assert.equal(removeLines.some(line => line.startsWith('          ') && line.includes('Remove “UTC”?')), false, 'expected remove overlay content not to be inset by the old 10% margin');
  session.destroy();
});

test('Clocks remove overlay wraps long clock names and time zones without truncation inside 80 columns', async () => {
  const longName = `Clock ${'A'.repeat(110)}`;
  const longTimezone = `America/${'B'.repeat(110)}`;
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    state: {activeTab: 'Clocks'},
    snapshot: snapshot([
      {name: longName, timezone: longTimezone, time: '09:00', position: 1}
    ])
  });

  session.click('clock-remove-open');

  const output = visible(session.output());
  const lines = visibleLines(session.output());
  assert.match(output, /Remove “Clock/);
  assert.doesNotMatch(output, /…/);
  assert.match(output, /AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/);
  assert.match(output, /BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB/);
  assert.equal(lines.filter(line => line.length > 80).length, 0, `expected no overdraw in remove overlay:\n${lines.join('\n')}`);
  session.destroy();
});

test('Clocks remove workflow normalizes stale selection after removing the selected last position', async () => {
  let currentClocks = [
    {name: 'UTC', timezone: 'Etc/UTC', time: '12:00', position: 1},
    {name: 'Mexico City', timezone: 'America/Mexico_City', time: '06:00', position: 2}
  ];
  const calls = [];
  const session = await Ui.createHeadlessSession({
    state: {activeTab: 'Clocks', clocksState: {selectedClockPosition: 2}},
    buildSnapshot() {
      return snapshot(currentClocks);
    },
    clockActions: {
      removeClocks(values) {
        calls.push(values);
        currentClocks = currentClocks
          .filter(clock => !values.positions.includes(clock.position))
          .map((clock, index) => ({...clock, position: index + 1}));
        return {ok: true};
      }
    }
  });

  session.click('clock-remove-open');
  assert.match(visible(session.output()), /Remove “Mexico City”\?/);
  session.click('clock-remove-confirm');

  assert.deepEqual(calls, [{positions: [2]}]);
  assert.equal(session.state().clocksState.selectedClockPosition, 1);

  session.click('clock-remove-open');
  const output = visible(session.output());
  assert.match(output, /Remove “UTC”\?/);
  assert.doesNotMatch(output, /Choose a clock first\./);
  session.destroy();
});
