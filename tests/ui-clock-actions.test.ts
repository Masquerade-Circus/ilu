const test = require('node:test');
const assert = require('node:assert/strict');

const {createClockActions, searchTimezoneChoices} = require('../ui/modules/clocks/actions');

function createClockModel(items = [
  {name: 'UTC', timezone: 'Etc/UTC'},
  {name: 'Mexico City', timezone: 'America/Mexico_City'},
  {name: 'Tokyo', timezone: 'Asia/Tokyo'}
]) {
  const calls = [];
  const clocks = items.map(item => ({...item}));
  const model = {
    find() {
      return clocks;
    },
    add(values) {
      calls.push(['add', values]);
      clocks.push({...values});
      return clocks;
    },
    remove(indexes) {
      calls.push(['remove', indexes]);
      for (const position of [...indexes].sort((left, right) => right - left)) {
        clocks.splice(position - 1, 1);
      }
      return clocks;
    },
    move(values) {
      calls.push(['move', values]);
      const [clock] = clocks.splice(values.fromPosition - 1, 1);
      clocks.splice(values.toPosition - 1, 0, clock);
      return clocks;
    }
  };

  return {model, calls, clocks};
}

test('Clock adapter rejects invalid names timezones and positions before model calls', () => {
  const {model, calls} = createClockModel();
  const actions = createClockActions({model});

  assert.deepEqual(actions.addClock({name: '   ', timezone: 'Etc/UTC'}), {ok: false, error: 'Clock name is required.'});
  assert.deepEqual(actions.addClock({name: 'Home', timezone: 'Invalid/Zone'}), {ok: false, error: 'Choose a valid timezone.'});
  assert.deepEqual(actions.removeClocks({positions: []}), {ok: false, error: 'Choose a clock first.'});
  assert.deepEqual(actions.removeClocks({positions: [0, Number.NaN]}), {ok: false, error: 'Choose a clock first.'});
  assert.deepEqual(actions.moveClock({fromPosition: 1, toPosition: 1}), {ok: false, error: 'Choose a different clock position.'});
  assert.deepEqual(actions.moveClock({fromPosition: 1, toPosition: 9}), {ok: false, error: 'Choose a valid clock position.'});
  assert.deepEqual(calls, []);
});

test('Clock adapter calls clock model APIs with normalized payloads', () => {
  const {model, calls, clocks} = createClockModel();
  const actions = createClockActions({model});

  assert.equal(actions.addClock({name: '  London  ', timezone: '  Europe/London  '}).ok, true);
  assert.equal(actions.removeClocks({positions: [3, 2, 3]}).ok, true);
  assert.equal(actions.moveClock({fromPosition: 2, toPosition: 1}).ok, true);

  assert.deepEqual(calls, [
    ['add', {name: 'London', timezone: 'Europe/London'}],
    ['remove', [2, 3]],
    ['move', {fromPosition: 2, toPosition: 1}]
  ]);
  assert.deepEqual(clocks.map(clock => clock.name), ['London', 'UTC']);
});

test('Clock adapter converts thrown model failures into safe copy', () => {
  const actions = createClockActions({model: {find() { return [{name: 'UTC', timezone: 'Etc/UTC'}]; }, add() { throw new Error('db failed at /home/user/token stack'); }}});

  const result = actions.addClock({name: 'UTC', timezone: 'Etc/UTC'});

  assert.equal(result.ok, false);
  assert.equal(result.error, 'Clock could not be saved. Try again.');
  assert.doesNotMatch(result.error, /\/home|token|stack/i);
});

test('Clock timezone search includes UTC alias fallback without truncating results', () => {
  const choices = searchTimezoneChoices('utc');

  assert.ok(choices.length >= 1);
  assert.deepEqual(choices[0], {name: 'UTC (Etc/UTC)', value: 'Etc/UTC'});
});
