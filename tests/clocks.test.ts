require('colors');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const clocksModulePath = path.join(repoRoot, 'clocks', 'clocks.ts');
const priorityPromptModulePath = path.join(repoRoot, 'clocks', 'priority-prompt.ts');

function loadClocksWithStubs({promptAnswers, priorityMoves, savedClocks = [], events}: any = {}) {
  const originalLoad = Module._load;
  const logs = [];
  const promptCalls = [];
  const queuedAnswers = Array.isArray(promptAnswers) ? [...promptAnswers] : [promptAnswers];
  const queuedPriorityMoves = Array.isArray(priorityMoves) ? [...priorityMoves] : [priorityMoves];
  const modelState = {
    clocks: savedClocks.map(clock => ({...clock})),
    addCalls: [],
    removeCalls: [],
    moveCalls: []
  };

  delete require.cache[require.resolve(clocksModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../utils/prompts') {
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

    if (request === '../utils') {
      return {
        log: Object.assign(
          (message) => {
            if (events) {
              events.push('log');
            }
            logs.push(message);
          },
          {
            info(message) {
              if (events) {
                events.push('log.info');
              }
              logs.push(message);
            },
            pointerSmall(message) {
              if (events) {
                events.push('log.pointerSmall');
              }
              logs.push(message);
            },
            cross(message) {
              if (events) {
                events.push('log.cross');
              }
              logs.push(message);
            }
          }
        )
      };
    }

    if (request === './model') {
      return {
        add(clock) {
          modelState.addCalls.push(clock);
          modelState.clocks.push(clock);
        },
        find() {
          return modelState.clocks;
        },
        get(index) {
          return modelState.clocks[index - 1];
        },
        remove(index) {
          modelState.removeCalls.push(index);
          if (typeof index === 'number') {
            modelState.clocks.splice(index - 1, 1);
            return;
          }

          if (Array.isArray(index)) {
            [...index]
              .sort((left, right) => right - left)
              .forEach(position => {
                modelState.clocks.splice(position - 1, 1);
              });
            return;
          }

          modelState.clocks = [];
        },
        move(move) {
          modelState.moveCalls.push(move);
          const [clock] = modelState.clocks.splice(move.fromPosition - 1, 1);
          if (clock) {
            modelState.clocks.splice(move.toPosition - 1, 0, clock);
          }
        }
      };
    }

    if (request === './priority-prompt') {
      return async (options) => {
        promptCalls.push([{type: 'clock-priority', ...options}]);

        if (queuedPriorityMoves.length === 0) {
          throw new Error('No priority moves left');
        }

        return queuedPriorityMoves.shift();
      };
    }

    if (request === 'lodash/isUndefined') {
      return value => typeof value === 'undefined';
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    const Clocks = require(clocksModulePath);
    return {Clocks, logs, modelState, promptCalls};
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(clocksModulePath)];
  }
}

function withProcessStubs(run) {
  const originalExit = process.exit;
  const exitCalls = [];

  process.exit = (code) => {
    exitCalls.push(code);
    throw new Error(`process.exit:${code}`);
  };

  return run({exitCalls}).finally(() => {
    process.exit = originalExit;
  });
}

function withIntlDateTimeFormatStub(formattedTimes, run) {
  const originalDateTimeFormat = Intl.DateTimeFormat;

  (Intl as any).DateTimeFormat = function DateTimeFormatStub(locale, options: any = {}) {
    return {
      format() {
        return formattedTimes[options.timeZone] || '00:00:00';
      }
    };
  };

  return Promise.resolve()
    .then(run)
    .finally(() => {
      Intl.DateTimeFormat = originalDateTimeFormat;
    });
}

test('clock valida timezone con Intl antes de persistir', {concurrency: false}, async () => {
  const {Clocks, modelState} = loadClocksWithStubs({
    promptAnswers: [
      {timezone: 'Mars/Olympus'},
      {name: 'Base'}
    ]
  });

  await withProcessStubs(async ({exitCalls}) => {
    await assert.rejects(
      Clocks.add(),
      /process\.exit:1/
    );

    assert.deepEqual(exitCalls, [1]);
  });

  assert.deepEqual(modelState.addCalls, []);
});

test('clock --show no limpia la terminal antes de renderizar los relojes', {concurrency: false}, async () => {
  const events = [];
  const {Clocks, logs} = loadClocksWithStubs({
    events,
    savedClocks: [
      {timezone: 'America/Mexico_City', name: 'CDMX'}
    ]
  });
  const originalConsoleClear = console.clear;

  console.clear = () => {
    events.push('clear');
  };

  try {
    await withIntlDateTimeFormatStub({
      'America/Mexico_City': '10:15:20'
    }, async () => {
      Clocks.show();
    });
  } finally {
    console.clear = originalConsoleClear;
  }

  assert.deepEqual(events, ['log.pointerSmall']);
  assert.ok(logs.some(entry => /CDMX/.test(entry)));
});

test('clock --add usa búsqueda Valyrian con todos los timezones disponibles y resuelve alias utc', {concurrency: false}, async () => {
  const originalSupportedValuesOf = Intl.supportedValuesOf;
  Intl.supportedValuesOf = () => [
    'America/Mexico_City',
    'America/Monterrey',
    'Europe/Madrid'
  ];

  try {
    const {Clocks, modelState, promptCalls} = loadClocksWithStubs({
      promptAnswers: [
        {timezone: 'Etc/UTC'},
        {name: 'CDMX'}
      ]
    });

    await withIntlDateTimeFormatStub({
      'Etc/UTC': '10:15:20'
    }, async () => {
      await Clocks.add();
    });

    assert.equal(promptCalls.length, 2);
    assert.equal(promptCalls[0][0].type, 'search');
    assert.equal(promptCalls[0][0].name, 'timezone');
    assert.deepEqual(
      promptCalls[0][0].choices.map(choice => choice.value),
      ['Etc/UTC', 'America/Mexico_City', 'America/Monterrey', 'Europe/Madrid']
    );
    assert.equal(promptCalls[1][0].name, 'name');
    assert.deepEqual(modelState.addCalls, [{timezone: 'Etc/UTC', name: 'CDMX'}]);
  } finally {
    Intl.supportedValuesOf = originalSupportedValuesOf;
  }
});

test('clock --remove sin posición permite eliminar múltiples relojes seleccionados', {concurrency: false}, async () => {
  const {Clocks, modelState, promptCalls, logs} = loadClocksWithStubs({
    savedClocks: [
      {name: 'CDMX', timezone: 'America/Mexico_City'},
      {name: 'Madrid', timezone: 'Europe/Madrid'},
      {name: 'UTC', timezone: 'Etc/UTC'}
    ],
    promptAnswers: [
      {indexes: [1, 3]}
    ]
  });

  await withIntlDateTimeFormatStub({
    'America/Mexico_City': '10:15:20'
  }, async () => {
    await Clocks.remove(true);
  });

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].type, 'checkbox');
  assert.equal(promptCalls[0][0].name, 'indexes');
  assert.deepEqual(
    promptCalls[0][0].choices.map(choice => choice.value),
    [1, 2, 3]
  );
  assert.deepEqual(modelState.removeCalls, [[1, 3]]);
  assert.deepEqual(modelState.clocks, [{name: 'Madrid', timezone: 'Europe/Madrid'}]);
  assert.match(logs[0], /2 clocks have been removed/i);
});

test('clock --remove por posición mantiene fast path', {concurrency: false}, () => {
  const {Clocks, modelState, logs, promptCalls} = loadClocksWithStubs({
    savedClocks: [
      {name: 'CDMX', timezone: 'America/Mexico_City'},
      {name: 'Madrid', timezone: 'Europe/Madrid'}
    ]
  });

  Clocks.remove(2);

  assert.deepEqual(promptCalls, []);
  assert.deepEqual(modelState.removeCalls, [2]);
  assert.match(logs[0], /The clock "2" has been removed\./);
});

test('clock --priority reordena relojes guardados y show refleja el nuevo orden', {concurrency: false}, async () => {
  const {Clocks, modelState, logs, promptCalls} = loadClocksWithStubs({
    savedClocks: [
      {name: 'CDMX', timezone: 'America/Mexico_City'},
      {name: 'Madrid', timezone: 'Europe/Madrid'},
      {name: 'UTC', timezone: 'Etc/UTC'}
    ],
    priorityMoves: [
      {fromPosition: 3, toPosition: 1}
    ]
  });

  await withIntlDateTimeFormatStub({
    'America/Mexico_City': '10:15:20',
    'Europe/Madrid': '17:15:20',
    'Etc/UTC': '16:15:20'
  }, async () => {
    await Clocks.priority();
  });

  assert.equal(promptCalls.length, 1);
  assert.equal(promptCalls[0][0].type, 'clock-priority');
  assert.deepEqual(
    promptCalls[0][0].clocks.map(clock => clock.name),
    ['CDMX', 'Madrid', 'UTC']
  );
  assert.deepEqual(modelState.moveCalls, [{fromPosition: 3, toPosition: 1}]);
  assert.deepEqual(modelState.clocks.map(clock => clock.name), ['UTC', 'CDMX', 'Madrid']);
  assert.deepEqual(logs, [
    `1 ${'16:15:20'.cyan.bold} - ${'UTC'.white} ${'(Etc/UTC)'.gray}`,
    `2 ${'10:15:20'.cyan.bold} - ${'CDMX'.white} ${'(America/Mexico_City)'.gray}`,
    `3 ${'17:15:20'.cyan.bold} - ${'Madrid'.white} ${'(Europe/Madrid)'.gray}`
  ]);
});

test('clock priority prompt devuelve el origen navegado antes de arrastrar', {concurrency: false}, () => {
  const priorityPrompt = require(priorityPromptModulePath);
  const clocks = [
    {name: 'CDMX', timezone: 'America/Mexico_City'},
    {name: 'Madrid', timezone: 'Europe/Madrid'},
    {name: 'UTC', timezone: 'Etc/UTC'}
  ];
  let state = priorityPrompt.createState({clocks});

  ['down', 'down', 'space', 'up', 'up', 'space', 'enter'].forEach(key => {
    state = priorityPrompt.reducePriorityPrompt(state, key);
  });

  assert.deepEqual(state.clocks.map(clock => clock.name), ['UTC', 'CDMX', 'Madrid']);
  assert.equal(state.status, 'confirmed');
  assert.equal(state.dragging, false);
  assert.deepEqual(state.pendingMove, {fromPosition: 3, toPosition: 1});
});

test('clock actions enruta opts.priority antes del show por defecto', {concurrency: false}, async () => {
  const events = [];
  const {Clocks, modelState} = loadClocksWithStubs({
    events,
    savedClocks: [
      {name: 'CDMX', timezone: 'America/Mexico_City'},
      {name: 'UTC', timezone: 'Etc/UTC'}
    ],
    priorityMoves: [
      {fromPosition: 2, toPosition: 1}
    ]
  });

  await Clocks.actions([], {priority: true});

  assert.deepEqual(modelState.moveCalls, [{fromPosition: 2, toPosition: 1}]);
  assert.deepEqual(events, ['log.pointerSmall', 'log.pointerSmall']);
});

test('clock --priority no intenta reordenar cuando hay menos de dos relojes', {concurrency: false}, async () => {
  const {Clocks, modelState, logs, promptCalls} = loadClocksWithStubs({
    savedClocks: [
      {name: 'CDMX', timezone: 'America/Mexico_City'}
    ],
    priorityMoves: [
      {fromPosition: 1, toPosition: 1}
    ]
  });

  await withIntlDateTimeFormatStub({
    'America/Mexico_City': '10:15:20'
  }, async () => {
    await Clocks.priority();
  });

  assert.deepEqual(promptCalls, []);
  assert.deepEqual(modelState.moveCalls, []);
  assert.match(logs[0], /at least two clocks/i);
  assert.match(logs[1], /CDMX/);
});

test('clock show lista todos los relojes con hora antes del nombre y timezone', {concurrency: false}, async () => {
  const {Clocks, logs} = loadClocksWithStubs({
    savedClocks: [
      {name: 'CDMX', timezone: 'America/Mexico_City'},
      {name: 'UTC', timezone: 'Etc/UTC'}
    ]
  });

  await withIntlDateTimeFormatStub({
    'America/Mexico_City': '10:15:20',
    'Etc/UTC': '16:15:20'
  }, async () => {
    Clocks.show();
  });

  assert.deepEqual(logs, [
    `1 ${'10:15:20'.cyan.bold} - ${'CDMX'.white} ${'(America/Mexico_City)'.gray}`,
    `2 ${'16:15:20'.cyan.bold} - ${'UTC'.white} ${'(Etc/UTC)'.gray}`
  ]);
});
