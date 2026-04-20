const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const inquirerCompatModulePath = path.join(__dirname, 'inquirer.js');

function loadInquirerCompatWithStub(inquirerStub) {
  const originalLoad = Module._load;

  delete require.cache[require.resolve(inquirerCompatModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'inquirer') {
      return inquirerStub;
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    return require(inquirerCompatModulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(inquirerCompatModulePath)];
  }
}

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

test('utils/inquirer expone prompt aunque el paquete lo entregue bajo default', () => {
  const inquirerCompat = loadInquirerCompatWithStub(require('inquirer'));

  assert.equal(typeof inquirerCompat.prompt, 'function');
});

test('utils/inquirer falla limpio cuando stdin no es TTY', async () => {
  let promptCalls = 0;
  const inquirerCompat = loadInquirerCompatWithStub({
    prompt() {
      promptCalls += 1;
      return Promise.resolve({});
    }
  });

  await withProcessStubs(async ({stderrWrites, exitCalls, setIsTTY}) => {
    setIsTTY(false);

    await assert.rejects(
      inquirerCompat.prompt([{type: 'input', name: 'title'}]),
      /process\.exit:1/
    );

    assert.equal(promptCalls, 0);
    assert.deepEqual(exitCalls, [1]);
    assert.match(stderrWrites.join(''), /interactive terminal/i);
  });
});

test('utils/inquirer traduce ExitPromptError a salida limpia con código no-cero', async () => {
  const inquirerCompat = loadInquirerCompatWithStub({
    prompt() {
      return Promise.reject(Object.assign(new Error('User force closed the prompt'), {
        name: 'ExitPromptError'
      }));
    }
  });

  await withProcessStubs(async ({stderrWrites, exitCalls, setIsTTY}) => {
    setIsTTY(true);

    await assert.rejects(
      inquirerCompat.prompt([{type: 'input', name: 'title'}]),
      /process\.exit:1/
    );

    assert.deepEqual(exitCalls, [1]);
    assert.doesNotMatch(stderrWrites.join(''), /ExitPromptError/);
    assert.match(stderrWrites.join(''), /cancel|closed/i);
  });
});
