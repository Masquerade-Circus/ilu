const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const promptsModulePath = path.resolve(__dirname, '..', 'utils', 'prompts.ts');

function withProcessStubs(run) {
  const originalExit = process.exit;
  const originalStderrWrite = process.stderr.write;
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const stderrWrites = [];
  const exitCalls = [];

  process.exit = (code) => {
    exitCalls.push(code);
    throw new Error(`process.exit:${code}`);
  };

  process.stderr.write = (chunk, encoding, callback) => {
    stderrWrites.push(String(chunk));

    if (typeof encoding === 'function') {
      encoding();
    }

    if (typeof callback === 'function') {
      callback();
    }

    return true;
  };

  return run({
    stderrWrites,
    exitCalls,
    setIsTTY(value) {
      Object.defineProperty(process.stdin, 'isTTY', {
        configurable: true,
        enumerable: stdinDescriptor ? stdinDescriptor.enumerable : true,
        writable: true,
        value
      });
    }
  }).finally(() => {
    process.exit = originalExit;
    process.stderr.write = originalStderrWrite;

    if (stdinDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
    } else {
      delete process.stdin.isTTY;
    }
  });
}

test('utils/prompts falla limpio cuando stdin no es TTY antes de abrir Valyrian', async () => {
  const prompts = require(promptsModulePath);

  await withProcessStubs(async ({stderrWrites, exitCalls, setIsTTY}) => {
    setIsTTY(false);

    await assert.rejects(
      prompts.prompt([{type: 'input', name: 'title', message: 'Title'}]),
      /process\.exit:1/
    );

    assert.deepEqual(exitCalls, [1]);
    assert.match(stderrWrites.join(''), /interactive terminal/i);
  });
});

test('utils/prompts normaliza choices para Valyrian y respeta default primero', () => {
  const prompts = require(promptsModulePath);

  assert.deepEqual(
    prompts.toValyrianChoices([
      {name: 'alloy', value: 'alloy'},
      {name: 'nova', value: 'nova'},
      {name: 'echo', value: 'echo'}
    ], 'nova').map((choice) => choice.value),
    ['nova', 'alloy', 'echo']
  );
});

test('utils/prompts deriva la selección inicial de choices checked para checkbox', () => {
  const prompts = require(promptsModulePath);

  const choices = [
    {name: 'done task', value: 'task-1', checked: true},
    {name: 'pending task', value: 'task-2', checked: false},
    {name: 'labeled note', value: 'note-1', checked: true}
  ];

  assert.deepEqual(
    prompts.initialSelectionFromChecked(choices).map((choice) => choice.value),
    ['task-1', 'note-1']
  );
});

test('utils/prompts deriva defaultValue nativo para checkbox desde choices checked', () => {
  const prompts = require(promptsModulePath);

  const choices = [
    {name: 'done task', value: 'task-1', checked: true},
    {name: 'pending task', value: 'task-2', checked: false},
    {name: 'labeled note', value: 'note-1', checked: true}
  ];

  assert.deepEqual(prompts.defaultValuesFromChecked(choices), ['task-1', 'note-1']);
});

test('utils/prompts rechaza defaults de checkbox que no existan entre choices', () => {
  const prompts = require(promptsModulePath);

  assert.throws(
    () => prompts.assertChoiceDefaults([{name: 'one', value: 1}], [2]),
    /defaultValue does not match any choice/
  );
});

test('utils/prompts normaliza número opcional sin aceptar NaN ni negativos', () => {
  const prompts = require(promptsModulePath);

  assert.deepEqual(
    [Number.NaN, Number.POSITIVE_INFINITY, -1, 'abc'].map((value) => prompts.normalizeOptionalInteger(value)),
    [null, null, null, null]
  );
  assert.equal(prompts.normalizeOptionalInteger(0), 0);
  assert.equal(prompts.normalizeOptionalInteger(4), 4);
});
