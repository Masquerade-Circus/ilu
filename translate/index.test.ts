import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const translatorModulePath = path.join(import.meta.dirname, 'index.ts');

function loadTranslatorModule() {
  delete require.cache[require.resolve(translatorModulePath)];
  return require(translatorModulePath);
}

test('createTranslator usa el proveedor inyectado y evita red real al traducir', async () => {
  const { createTranslator } = loadTranslatorModule();
  const clipboardWrites = [];
  const logs = [];
  let providerCalls = 0;

  const translator = createTranslator({
    provider: async ({ text, source, target }) => {
      providerCalls += 1;
      assert.deepEqual({ text, source, target }, {
        text: 'hello world',
        source: 'en',
        target: 'es'
      });

      return {
        sentences: [{ trans: 'Hola mundo', orig: 'hello world' }],
        dict: [{ entry: [{ word: 'Hola', reverse_translation: ['Hello'] }] }],
        src: 'en'
      };
    },
    clipboard: {
      async write(value) {
        clipboardWrites.push(value);
      }
    },
    log: Object.assign(
      (message) => logs.push({ type: 'log', message }),
      {
        warning(message) {
          logs.push({ type: 'warning', message });
        }
      }
    ),
    osLang: 'es'
  });

  await translator.action({ text: 'hello world' }, { source: 'en', target: 'es' });

  assert.equal(providerCalls, 1);
  assert.deepEqual(clipboardWrites, ['Hola mundo']);
  assert.equal(logs.length, 2);
  assert.match(logs[0].message, /EN > ES:/);
  assert.match(logs[0].message, /Hola mundo/);
  assert.match(logs[1].message, /Hola/);
});

test('createTranslator avisa cuando el proveedor no regresa una traducción', async () => {
  const { createTranslator } = loadTranslatorModule();
  const warnings = [];
  let clipboardWrites = 0;

  const translator = createTranslator({
    provider: async () => ({ sentences: [], src: 'en' }),
    clipboard: {
      async write() {
        clipboardWrites += 1;
      }
    },
    log: Object.assign(
      () => {},
      {
        warning(message) {
          warnings.push(message);
        }
      }
    ),
    osLang: 'es'
  });

  await translator.action({ text: 'missing' }, { source: 'en', target: 'es' });

  assert.deepEqual(warnings, ['No translation was found'.yellow]);
  assert.equal(clipboardWrites, 0);
});

test('createTranslator valida texto antes de llamar al proveedor', async () => {
  const { createTranslator } = loadTranslatorModule();
  let providerCalls = 0;
  const translator = createTranslator({
    provider: async () => {
      providerCalls += 1;
      return { sentences: [{ trans: 'x' }], src: 'en' };
    },
    clipboard: { async write() {} },
    log: Object.assign(() => {}, { warning() {} }),
    osLang: 'es'
  });

  await assert.rejects(
    () => translator.action({ text: ['x'.repeat(5001)] }, { source: 'en', target: 'es' }),
    /Maximum number of characters exceeded: 5000/
  );
  await assert.rejects(
    () => translator.action({ text: [] }, { source: 'en', target: 'es' }),
    /Text is required/
  );

  assert.equal(providerCalls, 0);
});
