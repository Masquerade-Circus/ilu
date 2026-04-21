require('colors');

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const {PassThrough} = require('node:stream');
let inquirer = require('inquirer');

if (inquirer.default) {
  inquirer = inquirer.default;
}

const repoRoot = path.resolve(__dirname, '..');
const clocksModulePath = path.join(repoRoot, 'clocks', 'clocks.js');

function loadClocksWithStubs({promptAnswers, savedClocks = [], events} = {}) {
  const originalLoad = Module._load;
  const logs = [];
  const promptCalls = [];
  const queuedAnswers = Array.isArray(promptAnswers) ? [...promptAnswers] : [promptAnswers];
  const modelState = {
    clocks: savedClocks.map(clock => ({...clock})),
    addCalls: [],
    removeCalls: []
  };

  delete require.cache[require.resolve(clocksModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../utils/inquirer') {
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
        }
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

  Intl.DateTimeFormat = function DateTimeFormatStub(locale, options = {}) {
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

async function runPromptWithActualInquirer(type) {
  const input = new PassThrough();
  const output = new PassThrough();
  let rendered = '';
  let settleTimer;

  output.on('data', chunk => {
    rendered += chunk.toString('utf8');
  });

  output.once('data', () => {
    setImmediate(() => {
      input.write('\n');
    });
  });

  const prompt = inquirer.createPromptModule({
    input,
    output,
    skipTTYChecks: true,
    clearPromptOnDone: false
  });

  const answerPromise = prompt([
    {
      type,
      name: 'timezone',
      message: 'Select a timezone',
      choices: [
        {name: 'America/Mexico_City', value: 'America/Mexico_City'},
        {name: 'Europe/Madrid', value: 'Europe/Madrid'}
      ]
    }
  ]);

  const guardedAnswerPromise = Promise.race([
    answerPromise,
    new Promise((_, reject) => {
      settleTimer = setTimeout(() => {
        reject(new Error(`Prompt "${type}" did not settle in time`));
      }, 1000);
    })
  ]);

  try {
    const answer = await guardedAnswerPromise;

    return {answer, rendered};
  } finally {
    clearTimeout(settleTimer);
    input.end();
    input.destroy();
    output.end();
    output.destroy();
  }
}

test('clock valida timezone con Intl antes de persistir', {concurrency: false}, async () => {
  const {Clocks, modelState} = loadClocksWithStubs({
    promptAnswers: [
      {search: 'Mars'},
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

test('clock --show limpia la terminal antes de renderizar los relojes', {concurrency: false}, async () => {
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

  assert.deepEqual(events, ['clear', 'log.pointerSmall']);
  assert.ok(logs.some(entry => /CDMX/.test(entry)));
});

test('clock --add usa un prompt soportado por el runtime actual de inquirer para seleccionar timezone', {concurrency: false}, async () => {
  const promptModule = inquirer.createPromptModule();
  const selectRuntime = await runPromptWithActualInquirer('select');

  assert.equal('list' in promptModule.prompts, false);
  assert.equal('select' in promptModule.prompts, true);
  assert.equal(selectRuntime.answer.timezone, 'America/Mexico_City');
  assert.match(selectRuntime.rendered, /America\/Mexico_City/);
  assert.match(selectRuntime.rendered, /↑↓ navigate/u);

  const originalSupportedValuesOf = Intl.supportedValuesOf;
  Intl.supportedValuesOf = () => [
    'America/Mexico_City',
    'America/Monterrey',
    'Europe/Madrid'
  ];

  try {
    const {Clocks, modelState, promptCalls} = loadClocksWithStubs({
      promptAnswers: [
        {search: 'mex'},
        {timezone: 'America/Mexico_City'},
        {name: 'CDMX'}
      ]
    });

    await withIntlDateTimeFormatStub({
      'America/Mexico_City': '10:15:20'
    }, async () => {
      await Clocks.add();
    });

    assert.equal(promptCalls.length, 3);
    assert.equal(promptCalls[0][0].name, 'search');
    assert.equal(promptCalls[1][0].type, 'select');
    assert.equal(promptCalls[1][0].name, 'timezone');
    assert.deepEqual(
      promptCalls[1][0].choices.map(choice => choice.value),
      ['America/Mexico_City']
    );
    assert.equal(promptCalls[2][0].name, 'name');
    assert.deepEqual(modelState.addCalls, [{timezone: 'America/Mexico_City', name: 'CDMX'}]);
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
