const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTestHome} = require('../support/home-sandbox');

const repoRoot = path.resolve(__dirname, '..');
const ttsModulePath = path.join(repoRoot, 'tts');

function createFakeOpenAi(seenPayloads) {
  return function createOpenAI({apiKey}) {
    seenPayloads.push({apiKey});
    return {
      audio: {
        speech: {
          async create(payload) {
            seenPayloads.push(payload);
            return {
              async arrayBuffer() {
                return Buffer.from(`[${payload.input}]`);
              }
            };
          }
        }
      }
    };
  };
}

function createFakeMerge(calls, options = {}) {
  return async function mergeChunkFiles({chunkFiles, outputFile, ffmpegPath}) {
    calls.push({chunkFiles: [...chunkFiles], outputFile, ffmpegPath});

    if (options.failWith) {
      throw options.failWith;
    }

    const merged = Buffer.concat(chunkFiles.map(file => fs.readFileSync(file)));
    fs.writeFileSync(outputFile, merged);
    return {outputFile};
  };
}

const withTestHome = setTestHome;

test('tts test helper restaura HOME original después del override temporal', () => {
  const originalHome = process.env.HOME;
  const restoreHome = withTestHome('/tmp/ilu-test-home');

  assert.equal(process.env.HOME, '/tmp/ilu-test-home');

  restoreHome();

  assert.equal(process.env.HOME, originalHome);
});

test('tts convierte markdown a audio, pide API key faltante y la guarda en tts-config.json usando alloy por default', async () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-tts-'));
  const restoreHome = withTestHome(tempHome);
  const inputFile = path.join(tempHome, 'chapter.md');
  const outputFile = path.join(tempHome, 'chapter.mp3');
  fs.writeFileSync(inputFile, '# Hola\n\nMundo', 'utf8');

  const promptCalls = [];
  const openAiCalls = [];
  const prompts = {
    async prompt(questions) {
      promptCalls.push(questions);
      return {apiKey: 'sk-test-key'};
    }
  };

  try {
    const {createTtsService} = require(ttsModulePath);
    const service = createTtsService({
      prompt: prompts.prompt,
      mergeChunkFiles: createFakeMerge([]),
      createOpenAI({apiKey}) {
        openAiCalls.push({apiKey});
        return {
          audio: {
            speech: {
              async create(payload) {
                openAiCalls.push(payload);
                return {
                  async arrayBuffer() {
                    return Buffer.from('FAKE_MP3');
                  }
                };
              }
            }
          }
        };
      }
    });

    await service.action({inputFile, outputFile}, {});

    assert.equal(promptCalls.length, 1);
    assert.deepEqual(openAiCalls, [
      {apiKey: 'sk-test-key'},
      {model: 'gpt-4o-mini-tts', voice: 'alloy', input: '# Hola\n\nMundo'}
    ]);
    assert.equal(fs.readFileSync(outputFile, 'utf8'), 'FAKE_MP3');
    assert.equal(
      fs.readFileSync(path.join(tempHome, '.ilu', '.config', 'tts-config.json'), 'utf8'),
      JSON.stringify({apiKey: 'sk-test-key'}, null, 2)
    );
  } finally {
    restoreHome();
    fs.rmSync(tempHome, {recursive: true, force: true});
    delete require.cache[require.resolve(ttsModulePath)];
  }
});

test('tts reutiliza API key y voz guardadas en .config/tts-config.json y no pide prompt', async () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-tts-stored-'));
  const restoreHome = withTestHome(tempHome);
  const inputFile = path.join(tempHome, 'chapter.txt');
  const outputFile = path.join(tempHome, 'chapter.wav');
  const configFile = path.join(tempHome, '.ilu', '.config', 'tts-config.json');
  fs.mkdirSync(path.dirname(configFile), {recursive: true});
  fs.writeFileSync(configFile, JSON.stringify({apiKey: 'sk-saved', voice: 'nova'}, null, 2), 'utf8');
  fs.writeFileSync(inputFile, 'Hola mundo', 'utf8');

  let promptCalls = 0;
  const seenPayloads = [];

  try {
    const {createTtsService} = require(ttsModulePath);
    const service = createTtsService({
      prompt: async () => {
        promptCalls += 1;
        return {apiKey: 'sk-other'};
      },
      mergeChunkFiles: createFakeMerge([]),
      createOpenAI({apiKey}) {
        seenPayloads.push({apiKey});
        return {
          audio: {
            speech: {
              async create(payload) {
                seenPayloads.push(payload);
                return {
                  async arrayBuffer() {
                    return Buffer.from('AUDIO');
                  }
                };
              }
            }
          }
        };
      }
    });

    await service.action({inputFile, outputFile}, {});

    assert.equal(promptCalls, 0);
    assert.deepEqual(seenPayloads, [
      {apiKey: 'sk-saved'},
      {model: 'gpt-4o-mini-tts', voice: 'nova', input: 'Hola mundo'}
    ]);
    assert.equal(fs.readFileSync(outputFile, 'utf8'), 'AUDIO');
  } finally {
    restoreHome();
    fs.rmSync(tempHome, {recursive: true, force: true});
    delete require.cache[require.resolve(ttsModulePath)];
  }
});

test('tts rechaza inputs que no sean .txt o .md', async () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-tts-invalid-'));
  const restoreHome = withTestHome(tempHome);
  const inputFile = path.join(tempHome, 'chapter.json');
  const outputFile = path.join(tempHome, 'chapter.mp3');
  fs.writeFileSync(inputFile, '{"hello": true}', 'utf8');

  try {
    const {createTtsService} = require(ttsModulePath);
    const service = createTtsService({
      prompt: async () => ({apiKey: 'sk-test'}),
      createOpenAI() {
        throw new Error('OpenAI should not be called for invalid extensions');
      }
    });

    await assert.rejects(
      service.action({inputFile, outputFile}, {}),
      /Only \.txt and \.md input files are supported/i
    );
  } finally {
    restoreHome();
    fs.rmSync(tempHome, {recursive: true, force: true});
    delete require.cache[require.resolve(ttsModulePath)];
  }
});

test('tts voice sin argumento usa prompt select compatible, muestra voces soportadas y persiste la elección', async () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-tts-voice-select-'));
  const restoreHome = withTestHome(tempHome);
  const promptCalls = [];

  try {
    const {createTtsService, SUPPORTED_VOICES} = require(ttsModulePath);
    const service = createTtsService({
      prompt: async questions => {
        promptCalls.push(questions);
        return {voice: 'sage'};
      }
    });

    const result = await service.voiceAction({}, {});

    assert.deepEqual(result, {voice: 'sage'});
    assert.equal(promptCalls.length, 1);
    assert.deepEqual(promptCalls[0], [{
      type: 'select',
      name: 'voice',
      message: 'Select a default TTS voice',
      choices: SUPPORTED_VOICES.map(value => ({name: value, value})),
      default: 'alloy'
    }]);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(tempHome, '.ilu', '.config', 'tts-config.json'), 'utf8')),
      {voice: 'sage'}
    );
  } finally {
    restoreHome();
    fs.rmSync(tempHome, {recursive: true, force: true});
    delete require.cache[require.resolve(ttsModulePath)];
  }
});

test('tts ignora config legacy y sync-config, cae a alloy y pide API key nueva', async () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-tts-no-legacy-'));
  const restoreHome = withTestHome(tempHome);
  const inputFile = path.join(tempHome, 'chapter.md');
  const outputFile = path.join(tempHome, 'chapter.mp3');
  const legacyConfigFile = path.join(tempHome, '.ilu', '.sync', 'config.json');
  const currentSyncConfigFile = path.join(tempHome, '.ilu', '.config', 'sync-config.json');

  fs.mkdirSync(path.dirname(legacyConfigFile), {recursive: true});
  fs.mkdirSync(path.dirname(currentSyncConfigFile), {recursive: true});
  fs.writeFileSync(inputFile, '# Hola', 'utf8');
  fs.writeFileSync(legacyConfigFile, JSON.stringify({tts: {apiKey: 'sk-legacy', voice: 'nova'}}, null, 2), 'utf8');
  fs.writeFileSync(currentSyncConfigFile, JSON.stringify({enabled: true, remoteUrl: '/tmp/remote.git'}), 'utf8');

  const promptCalls = [];
  const openAiCalls = [];

  try {
    const {createTtsService} = require(ttsModulePath);
    const service = createTtsService({
      async prompt(questions) {
        promptCalls.push(questions);
        return {apiKey: 'sk-fresh'};
      },
      mergeChunkFiles: createFakeMerge([]),
      createOpenAI({apiKey}) {
        openAiCalls.push({apiKey});
        return {
          audio: {
            speech: {
              async create(payload) {
                openAiCalls.push(payload);
                return {
                  async arrayBuffer() {
                    return Buffer.from('LEGACY_FREE');
                  }
                };
              }
            }
          }
        };
      }
    });

    await service.action({inputFile, outputFile}, {});

    assert.equal(promptCalls.length, 1);
    assert.deepEqual(openAiCalls, [
      {apiKey: 'sk-fresh'},
      {model: 'gpt-4o-mini-tts', voice: 'alloy', input: '# Hola'}
    ]);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(tempHome, '.ilu', '.config', 'tts-config.json'), 'utf8')),
      {apiKey: 'sk-fresh'}
    );
  } finally {
    restoreHome();
    fs.rmSync(tempHome, {recursive: true, force: true});
    delete require.cache[require.resolve(ttsModulePath)];
  }
});

test('tts expone límite default de chunk en 50000 caracteres', () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const {DEFAULT_MAX_CHUNK_LENGTH} = require(ttsModulePath);

  assert.equal(DEFAULT_MAX_CHUNK_LENGTH, 50000);
});

test('tts con texto corto hace un solo request, genera chunk numerado y mergea al final', async () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-tts-short-'));
  const restoreHome = withTestHome(tempHome);
  const inputFile = path.join(tempHome, 'chapter.txt');
  const outputFile = path.join(tempHome, 'chapter.mp3');
  const seenPayloads = [];
  const mergeCalls = [];

  fs.writeFileSync(inputFile, 'Hola breve', 'utf8');

  try {
    const {createTtsService, getChunkDirForOutput} = require(ttsModulePath);
    const service = createTtsService({
      prompt: async () => ({apiKey: 'sk-test-key'}),
      createOpenAI: createFakeOpenAi(seenPayloads),
      mergeChunkFiles: createFakeMerge(mergeCalls),
      maxChunkLength: 50
    });

    await service.action({inputFile, outputFile}, {});

    const chunkDir = getChunkDirForOutput(outputFile);

    assert.deepEqual(seenPayloads, [
      {apiKey: 'sk-test-key'},
      {model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Hola breve'}
    ]);
    assert.equal(mergeCalls.length, 1);
    assert.deepEqual(
      mergeCalls[0].chunkFiles.map(file => path.basename(file)),
      ['chapter-0001.mp3']
    );
    assert.equal(fs.readFileSync(outputFile, 'utf8'), '[Hola breve]');
    assert.equal(fs.existsSync(chunkDir), false);
  } finally {
    restoreHome();
    fs.rmSync(tempHome, {recursive: true, force: true});
    delete require.cache[require.resolve(ttsModulePath)];
  }
});

test('tts usa temp dir adyacente y nombres numerados estables para chunks', () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const {getChunkDirForOutput, getChunkFilePath} = require(ttsModulePath);
  const outputFile = '/tmp/audio/final-book.mp3';

  assert.equal(
    getChunkDirForOutput(outputFile),
    '/tmp/audio/.final-book.mp3.parts'
  );
  assert.equal(
    getChunkFilePath(outputFile, 0),
    '/tmp/audio/.final-book.mp3.parts/final-book-0001.mp3'
  );
  assert.equal(
    getChunkFilePath(outputFile, 11),
    '/tmp/audio/.final-book.mp3.parts/final-book-0012.mp3'
  );
});

test('tts construye concat input de ffmpeg en orden determinista', () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const {buildFfmpegConcatInput} = require(ttsModulePath);

  assert.equal(
    buildFfmpegConcatInput([
      '/tmp/.chapter.mp3.parts/chapter-0001.mp3',
      "/tmp/.chapter.mp3.parts/chapter-0002's.mp3"
    ]),
    "file '/tmp/.chapter.mp3.parts/chapter-0001.mp3'\nfile '/tmp/.chapter.mp3.parts/chapter-0002'\\''s.mp3'\n"
  );
});

test('tts usa rutas absolutas en concat.txt cuando mergea una sola parte con output relativo', () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-tts-merge-relative-'));
  const originalCwd = process.cwd();

  try {
    process.chdir(tempHome);

    const {mergeChunkFiles, getChunkFilePath} = require(ttsModulePath);
    const outputFile = 'ilu.mp3';
    const chunkFile = getChunkFilePath(outputFile, 0);
    const expectedConcatInput = `file '${path.resolve(chunkFile)}'\n`;
    let seenConcatInput = null;

    fs.mkdirSync(path.dirname(chunkFile), {recursive: true});
    fs.writeFileSync(chunkFile, 'FAKE_MP3', 'utf8');

    mergeChunkFiles({
      chunkFiles: [chunkFile],
      outputFile,
      ffmpegPath: '/fake/ffmpeg',
      spawnSync(command, args) {
        assert.equal(command, '/fake/ffmpeg');
        seenConcatInput = fs.readFileSync(args[6], 'utf8');
        return {status: 0, stdout: '', stderr: ''};
      }
    });

    assert.equal(seenConcatInput, expectedConcatInput);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempHome, {recursive: true, force: true});
    delete require.cache[require.resolve(ttsModulePath)];
  }
});

test('tts con varios párrafos largos hace múltiples requests en orden, mergea después y borra chunks numerados', async () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-tts-paragraphs-'));
  const restoreHome = withTestHome(tempHome);
  const inputFile = path.join(tempHome, 'chapter.txt');
  const outputFile = path.join(tempHome, 'chapter.mp3');
  const seenPayloads = [];
  const mergeCalls = [];
  const input = ['Primer párrafo largo.', 'Segundo párrafo largo.', 'Tercer párrafo largo.'].join('\n\n');

  fs.writeFileSync(inputFile, input, 'utf8');

  try {
    const {createTtsService, getChunkDirForOutput} = require(ttsModulePath);
    const service = createTtsService({
      prompt: async () => ({apiKey: 'sk-test-key'}),
      createOpenAI: createFakeOpenAi(seenPayloads),
      mergeChunkFiles: createFakeMerge(mergeCalls),
      maxChunkLength: 25
    });

    await service.action({inputFile, outputFile}, {});

    const chunkDir = getChunkDirForOutput(outputFile);

    assert.deepEqual(seenPayloads, [
      {apiKey: 'sk-test-key'},
      {model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Primer párrafo largo.'},
      {model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Segundo párrafo largo.'},
      {model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Tercer párrafo largo.'}
    ]);
    assert.equal(
      fs.readFileSync(outputFile, 'utf8'),
      '[Primer párrafo largo.][Segundo párrafo largo.][Tercer párrafo largo.]'
    );
    assert.equal(mergeCalls.length, 1);
    assert.deepEqual(
      mergeCalls[0].chunkFiles.map(file => path.basename(file)),
      ['chapter-0001.mp3', 'chapter-0002.mp3', 'chapter-0003.mp3']
    );
    assert.equal(fs.existsSync(chunkDir), false);
  } finally {
    restoreHome();
    fs.rmSync(tempHome, {recursive: true, force: true});
    delete require.cache[require.resolve(ttsModulePath)];
  }
});

test('tts preserva carpeta temporal y chunks si el merge falla', async () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-tts-merge-fail-'));
  const restoreHome = withTestHome(tempHome);
  const inputFile = path.join(tempHome, 'chapter.txt');
  const outputFile = path.join(tempHome, 'chapter.mp3');

  fs.writeFileSync(inputFile, ['Uno.', 'Dos.'].join('\n\n'), 'utf8');

  try {
    const {createTtsService, getChunkDirForOutput} = require(ttsModulePath);
    const chunkDir = getChunkDirForOutput(outputFile);
    const service = createTtsService({
      prompt: async () => ({apiKey: 'sk-test-key'}),
      createOpenAI: createFakeOpenAi([]),
      mergeChunkFiles: createFakeMerge([], {failWith: new Error('merge failed')}),
      maxChunkLength: 5
    });

    await assert.rejects(service.action({inputFile, outputFile}, {}), /merge failed/i);

    assert.equal(fs.existsSync(chunkDir), true);
    assert.deepEqual(
      fs.readdirSync(chunkDir).filter(name => /^chapter-\d{4}\.mp3$/.test(name)),
      ['chapter-0001.mp3', 'chapter-0002.mp3']
    );
    assert.equal(fs.existsSync(outputFile), false);
  } finally {
    restoreHome();
    fs.rmSync(tempHome, {recursive: true, force: true});
    delete require.cache[require.resolve(ttsModulePath)];
  }
});

test('tts divide un párrafo demasiado largo por oraciones antes de cortar por longitud', async () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-tts-sentences-'));
  const restoreHome = withTestHome(tempHome);
  const inputFile = path.join(tempHome, 'chapter.txt');
  const outputFile = path.join(tempHome, 'chapter.mp3');
  const seenPayloads = [];
  const input = 'Primera oración. Segunda oración. Tercera oración.';

  fs.writeFileSync(inputFile, input, 'utf8');

  try {
    const {createTtsService} = require(ttsModulePath);
    const service = createTtsService({
      prompt: async () => ({apiKey: 'sk-test-key'}),
      createOpenAI: createFakeOpenAi(seenPayloads),
      mergeChunkFiles: createFakeMerge([]),
      maxChunkLength: 20
    });

    await service.action({inputFile, outputFile}, {});

    assert.deepEqual(seenPayloads, [
      {apiKey: 'sk-test-key'},
      {model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Primera oración.'},
      {model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Segunda oración.'},
      {model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Tercera oración.'}
    ]);
    assert.equal(
      fs.readFileSync(outputFile, 'utf8'),
      '[Primera oración.][Segunda oración.][Tercera oración.]'
    );
  } finally {
    restoreHome();
    fs.rmSync(tempHome, {recursive: true, force: true});
    delete require.cache[require.resolve(ttsModulePath)];
  }
});

test('tts usa fallback por longitud cuando una oración todavía excede el límite', async () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-tts-length-'));
  const restoreHome = withTestHome(tempHome);
  const inputFile = path.join(tempHome, 'chapter.txt');
  const outputFile = path.join(tempHome, 'chapter.mp3');
  const seenPayloads = [];

  fs.writeFileSync(inputFile, 'abcdefghij', 'utf8');

  try {
    const {createTtsService} = require(ttsModulePath);
    const service = createTtsService({
      prompt: async () => ({apiKey: 'sk-test-key'}),
      createOpenAI: createFakeOpenAi(seenPayloads),
      mergeChunkFiles: createFakeMerge([]),
      maxChunkLength: 4
    });

    await service.action({inputFile, outputFile}, {});

    assert.deepEqual(seenPayloads, [
      {apiKey: 'sk-test-key'},
      {model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'abcd'},
      {model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'efgh'},
      {model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'ij'}
    ]);
    assert.equal(fs.readFileSync(outputFile, 'utf8'), '[abcd][efgh][ij]');
  } finally {
    restoreHome();
    fs.rmSync(tempHome, {recursive: true, force: true});
    delete require.cache[require.resolve(ttsModulePath)];
  }
});

test('tts reintenta con el mismo comando, omite chunks existentes y continúa desde el siguiente faltante', async () => {
  delete require.cache[require.resolve(ttsModulePath)];

  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-tts-resume-'));
  const restoreHome = withTestHome(tempHome);
  const inputDir = path.join(tempHome, "dir with space and 'quote'");
  const outputDir = path.join(tempHome, 'out dir');
  const inputFile = path.join(inputDir, 'chapter copy.txt');
  const outputFile = path.join(outputDir, 'chapter mix.mp3');
  const seenPayloads = [];
  const mergeCalls = [];
  const input = ['Primer párrafo largo.', 'Segundo párrafo largo.', 'Tercer párrafo largo.'].join('\n\n');

  fs.mkdirSync(inputDir, {recursive: true});
  fs.mkdirSync(outputDir, {recursive: true});
  fs.writeFileSync(inputFile, input, 'utf8');

  try {
    const {createTtsService, getChunkDirForOutput, getChunkFilePath} = require(ttsModulePath);
    const chunkDir = getChunkDirForOutput(outputFile);
    fs.mkdirSync(chunkDir, {recursive: true});

    let attempt = 0;
    const service = createTtsService({
      prompt: async () => ({apiKey: 'sk-test-key'}),
      mergeChunkFiles: createFakeMerge(mergeCalls),
      createOpenAI({apiKey}) {
        seenPayloads.push({apiKey});
        return {
          audio: {
            speech: {
              async create(payload) {
                seenPayloads.push(payload);

                if (attempt === 0 && payload.input === 'Tercer párrafo largo.') {
                  throw new Error('simulated interruption');
                }

                return {
                  async arrayBuffer() {
                    return Buffer.from(`[${payload.input}]`);
                  }
                };
              }
            }
          }
        };
      },
      maxChunkLength: 25
    });

    await assert.rejects(
      service.action({inputFile, outputFile}, {}),
      error => {
        assert.match(error.message, /simulated interruption/i);
        assert.match(
          error.message,
          /Retry with: ilu tts '\/.*\/dir with space and '\"'\"'quote'\"'\"'\/chapter copy\.txt' '\/.*\/out dir\/chapter mix\.mp3'/
        );
        return true;
      }
    );

    assert.equal(fs.readFileSync(getChunkFilePath(outputFile, 0), 'utf8'), '[Primer párrafo largo.]');
    assert.equal(fs.readFileSync(getChunkFilePath(outputFile, 1), 'utf8'), '[Segundo párrafo largo.]');
    assert.equal(fs.existsSync(getChunkFilePath(outputFile, 2)), false);
    assert.equal(fs.existsSync(outputFile), false);
    assert.equal(mergeCalls.length, 0);

    attempt = 1;
    seenPayloads.length = 0;

    await service.action({inputFile, outputFile}, {});

    assert.deepEqual(seenPayloads, [
      {apiKey: 'sk-test-key'},
      {model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Tercer párrafo largo.'}
    ]);
    assert.equal(mergeCalls.length, 1);
    assert.equal(fs.readFileSync(outputFile, 'utf8'), '[Primer párrafo largo.][Segundo párrafo largo.][Tercer párrafo largo.]');
    assert.equal(fs.existsSync(chunkDir), false);
  } finally {
    restoreHome();
    fs.rmSync(tempHome, {recursive: true, force: true});
    delete require.cache[require.resolve(ttsModulePath)];
  }
});
