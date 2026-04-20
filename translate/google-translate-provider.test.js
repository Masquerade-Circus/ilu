const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const providerModulePath = path.join(__dirname, 'google-translate-provider.js');

function loadProviderModule() {
  delete require.cache[require.resolve(providerModulePath)];
  return require(providerModulePath);
}

test('google translate provider encapsula la llamada HTTP actual', async () => {
  const { createGoogleTranslateProvider } = loadProviderModule();
  const requests = [];

  const provider = createGoogleTranslateProvider({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        status: 200,
        async json() {
          return { sentences: [{ trans: 'Hola' }], src: 'en' };
        }
      };
    }
  });

  const result = await provider({ text: 'hello', source: 'en', target: 'es' });

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /translate\.google\.com\/translate_a\/single/);
  assert.match(requests[0].url, /sl=en/);
  assert.match(requests[0].url, /tl=es/);
  assert.match(requests[0].url, /q=hello/);
  assert.equal(requests[0].options.method, 'get');
  assert.match(requests[0].options.headers['User-Agent'], /AndroidTranslate/);
  assert.deepEqual(result, { sentences: [{ trans: 'Hola' }], src: 'en' });
});

test('google translate provider reporta errores HTTP con log y exit inyectables', async () => {
  const { createGoogleTranslateProvider } = loadProviderModule();
  const loggedErrors = [];
  const exits = [];

  const provider = createGoogleTranslateProvider({
    fetchImpl: async () => ({
      status: 503,
      statusText: 'Service Unavailable'
    }),
    log: {
      cross(message, color) {
        loggedErrors.push({ message, color });
      }
    },
    exit(code) {
      exits.push(code);
      throw new Error(`exit:${code}`);
    }
  });

  await assert.rejects(
    () => provider({ text: 'hello', source: 'en', target: 'es' }),
    /exit:1/
  );

  assert.equal(loggedErrors.length, 1);
  assert.equal(loggedErrors[0].color, 'red');
  assert.deepEqual(exits, [1]);
});

test('google translate provider usa global fetch por defecto', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      status: 200,
      async json() {
        return { sentences: [{ trans: 'Bonjour' }], src: 'en' };
      }
    };
  };

  try {
    const { createGoogleTranslateProvider } = loadProviderModule();
    const provider = createGoogleTranslateProvider();

    const result = await provider({ text: 'hello', source: 'en', target: 'fr' });

    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /tl=fr/);
    assert.deepEqual(result, { sentences: [{ trans: 'Bonjour' }], src: 'en' });
  } finally {
    global.fetch = originalFetch;
    delete require.cache[require.resolve(providerModulePath)];
  }
});
