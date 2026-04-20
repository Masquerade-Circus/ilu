const test = require('node:test');
const assert = require('node:assert/strict');

const openWithEditor = require('./open-with-editor');

test('open-with-editor lanza el editor con el archivo y espera a que cierre', async () => {
  const events = {};
  const calls = [];

  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    return {
      once(eventName, handler) {
        events[eventName] = handler;
        return this;
      }
    };
  };

  const pending = openWithEditor('/tmp/note.txt', {app: 'code', spawnImpl});
  events.close(0);

  await pending;

  assert.deepEqual(calls, [{
    command: 'code',
    args: ['/tmp/note.txt'],
    options: {stdio: 'inherit'}
  }]);
});

test('open-with-editor rechaza si el editor termina con código distinto de cero', async () => {
  const events = {};

  const spawnImpl = () => ({
    once(eventName, handler) {
      events[eventName] = handler;
      return this;
    }
  });

  const pending = openWithEditor('/tmp/note.txt', {app: 'code', spawnImpl});
  events.close(1);

  await assert.rejects(pending, /code 1/);
});

test('open-with-editor usa open -W -a en macOS para apps del sistema', async () => {
  const events = {};
  const calls = [];

  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    return {
      once(eventName, handler) {
        events[eventName] = handler;
        return this;
      }
    };
  };

  const pending = openWithEditor('/tmp/note.txt', {
    app: 'textedit',
    platform: 'darwin',
    spawnImpl
  });

  events.close(0);
  await pending;

  assert.deepEqual(calls, [{
    command: 'open',
    args: ['-W', '-a', 'textedit', '/tmp/note.txt'],
    options: {stdio: 'inherit'}
  }]);
});
