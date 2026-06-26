const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function withBlockedClipboardy(fn) {
  const originalLoad = Module._load;

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'clipboardy') {
      throw new Error('UI Babel actions must not load clipboardy');
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return fn();
  } finally {
    Module._load = originalLoad;
  }
}

test('Babel UI adapter rejects empty and too-long text without provider or clipboard calls', async () => {
  const {createBabelActions} = require('../ui/modules/babel/actions');
  const calls = [];
  const actions = createBabelActions({
    provider: async () => {
      calls.push(['provider']);
      return {sentences: [{trans: 'Nope'}], src: 'en'};
    },
    clipboard: {
      async write(value) {
        calls.push(['clipboard', value]);
      }
    }
  });

  const empty = await actions.translate({text: '   ', source: 'en', target: 'es'});
  const tooLong = await actions.translate({text: 'x'.repeat(5001), source: 'en', target: 'es'});

  assert.deepEqual(empty, {ok: false, error: 'Text to translate is required.'});
  assert.deepEqual(tooLong, {ok: false, error: 'Text must be 5000 characters or fewer.'});
  assert.deepEqual(calls, []);
});

test('Babel UI adapter returns translation and dictionary without copying automatically', async () => {
  const {createBabelActions} = require('../ui/modules/babel/actions');
  const calls = [];
  const actions = createBabelActions({
    provider: async request => {
      calls.push(['provider', request]);
      return {
        sentences: [{trans: 'Hola mundo', orig: 'hello world'}],
        dict: [{entry: [{word: 'Hola', reverse_translation: ['Hello', 'Hi']}]}],
        src: 'en'
      };
    },
    clipboard: {
      async write(value) {
        calls.push(['clipboard', value]);
      }
    }
  });

  const result = await actions.translate({text: 'hello world', source: 'en', target: 'es'});

  assert.deepEqual(result, {
    ok: true,
    translation: 'Hola mundo',
    source: 'en',
    target: 'es',
    dictionaryEntries: ['Hola — Hello, Hi']
  });
  assert.deepEqual(calls, [['provider', {text: 'hello world', source: 'en', target: 'es'}]]);
});

test('Babel UI actions do not load a process clipboard adapter', async () => {
  await withBlockedClipboardy(async () => {
    const {createBabelActions} = require('../ui/modules/babel/actions');
    const actions = createBabelActions({
      provider: async () => ({sentences: [{trans: 'Hola'}], src: 'en'})
    });

    assert.deepEqual(await actions.translate({text: 'hello', source: 'en', target: 'es'}), {
      ok: true,
      translation: 'Hola',
      source: 'en',
      target: 'es',
      dictionaryEntries: []
    });
  });
});

test('Babel UI adapter does not copy through an Ilu clipboard adapter', async () => {
  const {createBabelActions} = require('../ui/modules/babel/actions');
  const writes = [];
  const actions = createBabelActions({
    provider: async () => ({sentences: [{trans: 'Hola'}], src: 'en'}),
    clipboard: {
      async write(value) {
        writes.push(value);
      }
    }
  });
  assert.deepEqual(await actions.copyResult({translation: 'Hola mundo'}), {ok: false, error: 'Could not copy the translation.'});
  assert.deepEqual(writes, []);
});

test('Babel UI adapter redacts provider failures and missing translations', async () => {
  const {createBabelActions} = require('../ui/modules/babel/actions');
  const unsafe = createBabelActions({
    provider: async () => {
      throw new Error('provider token=abc failed at /home/person/project stack');
    },
    clipboard: {async write() {}}
  });
  const missing = createBabelActions({
    provider: async () => ({sentences: [], src: 'en'}),
    clipboard: {async write() {}}
  });

  assert.deepEqual(await unsafe.translate({text: 'hello', source: 'en', target: 'es'}), {ok: false, error: 'Could not translate the text.'});
  assert.deepEqual(await missing.translate({text: 'hello', source: 'en', target: 'es'}), {ok: false, error: 'No translation was returned.'});
});


test('Babel UI adapter converts default provider HTTP failures without exiting the process', async () => {
  const {createBabelActions} = require('../ui/modules/babel/actions');
  const logs = [];
  const actions = createBabelActions({
    fetchImpl: async () => ({
      status: 500,
      statusText: 'provider exploded',
      async json() {
        return {sentences: [{trans: 'Nope'}], src: 'en'};
      }
    }),
    log: {
      cross(message) {
        logs.push(message);
      }
    },
    clipboard: {async write() {}}
  });

  const result = await actions.translate({text: 'hello', source: 'en', target: 'es'});

  assert.deepEqual(result, {ok: false, error: 'Could not translate the text.'});
  assert.equal(logs.length, 1);
});
