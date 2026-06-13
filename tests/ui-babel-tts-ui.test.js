const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
process.env.TSX_TSCONFIG_PATH = path.join(repoRoot, 'tsconfig.ui.json');
require('tsx/cjs');

const uiModulePath = path.join(repoRoot, 'ui', 'app.tsx');

function stripAnsi(output) {
  return output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function visibleLines(output) {
  return stripAnsi(output).split(/\r?\n/);
}

function clickVisibleText(session, text, occurrence = 0) {
  const lines = visibleLines(session.output());
  let seen = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(text);

    if (column < 0) {
      continue;
    }

    if (seen === occurrence) {
      session.clickAt(column + 1, index + 1);
      return;
    }

    seen += 1;
  }

  assert.fail(`expected visible text target "${text}" in:\n${lines.join('\n')}`);
}

function baseSnapshot(overrides = {}) {
  return {
    todo: {title: 'Today', items: [], remaining: 0},
    notes: {title: 'Notes list', items: [], remaining: 0},
    board: {title: 'Board view', columns: [], totalCards: 0},
    clocks: {items: [], remaining: 0},
    ...overrides
  };
}

function createSyncActions() {
  return {
    status: () => ({ok: true, label: 'Synced', details: ['Status: Synced']}),
    retry: () => ({ok: true, label: 'Synced', details: ['Status: Synced']}),
    enable: () => ({ok: true, label: 'Synced', details: ['Status: Synced']}),
    disable: () => ({ok: true, label: 'Sync off', details: ['Status: Sync off']}),
    init: () => ({ok: true, label: 'Synced', details: ['Status: Synced']})
  };
}

test('Translate app opens from top nav and renders approved copy', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions()});

  session.click('tab-translate');

  const output = session.output();
  const lines = visibleLines(output);
  const navLine = lines.find(line => /Todo/.test(line) && /Notes/.test(line) && /Board/.test(line) && /Clocks/.test(line));

  assert.equal(session.state().activeTab, 'Translate');
  assert.ok(navLine, 'expected top nav');
  assert.match(navLine, /Translate/);
  assert.match(navLine, /Speech/);
  assert.match(output, /Translate/);
  assert.match(output, /Text to translate/);
  assert.match(output, /From/);
  assert.match(output, /To/);
  assert.match(output, /Copy result/);
  assert.match(output, /Dictionary/);
  assert.match(output, /No dictionary entries found\./);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});



test('Translate utility renders actions in the bottom action area', async () => {
  const Ui = require(uiModulePath);
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions()});

  try {
    session.click('tab-translate');

    const lines = visibleLines(session.output());
    const actionRow = lines.findIndex(line => /Translate/.test(line) && /Copy result/.test(line));

    assert.equal(actionRow, 22, `Translate actions must render in the fixed action area:
${lines.join('\n')}`);
    assert.equal(lines.slice(2, 22).some(line => /Copy result/.test(line)), false, `Translate panel body must stay for inputs, status, errors, and results:
${lines.join('\n')}`);
    assert.equal(lines.filter(line => line.length > 80).length, 0);
  } finally {
    session.destroy();
  }
});

test('Translate utility clears stale translation when inputs change or translation fails', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const babelActions = {
    async translate(values) {
      calls.push(['translate', values]);
      return {ok: false, error: 'Could not translate the text.'};
    },
    async copyResult(values) {
      calls.push(['copy', values]);
      return values.translation.trim().length > 0
        ? {ok: true, message: 'Copied.'}
        : {ok: false, error: 'Could not copy the translation.'};
    }
  };
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    snapshot: baseSnapshot(),
    state: {
      utilities: {
        babel: {
          text: 'old text',
          source: 'en',
          target: 'es',
          translation: 'Old translation',
          dictionaryEntries: ['Old — Entry']
        }
      }
    },
    syncActions: createSyncActions(),
    babelActions
  });

  session.click('tab-translate');
  assert.match(session.output(), /Old translation/);
  assert.match(session.output(), /Old — Entry/);

  session.focus('translate-text');
  session.dispatchText(' updated');

  assert.equal(session.state().utilities.babel.translation, '');
  assert.deepEqual(session.state().utilities.babel.dictionaryEntries, []);
  assert.doesNotMatch(session.output(), /Old translation/);
  assert.doesNotMatch(session.output(), /Old — Entry/);

  session.click('translate-start');
  await new Promise(resolve => setImmediate(resolve));
  session.click('translate-copy');
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls[0], ['translate', {text: 'old text updated', source: 'en', target: 'es'}]);
  assert.deepEqual(calls[1], ['copy', {translation: ''}]);
  assert.equal(session.state().utilities.babel.translation, '');
  assert.deepEqual(session.state().utilities.babel.dictionaryEntries, []);
  assert.doesNotMatch(session.output(), /Old translation/);
  session.destroy();
});


test('Translate utility ignores stale in-flight translation after input changes', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  let resolveTranslation;
  const translationPromise = new Promise(resolve => {
    resolveTranslation = resolve;
  });
  const babelActions = {
    async translate(values) {
      calls.push(['translate', values]);
      return translationPromise;
    },
    async copyResult(values) {
      calls.push(['copy', values]);
      return values.translation.trim().length > 0
        ? {ok: true, message: 'Copied.'}
        : {ok: false, error: 'Could not copy the translation.'};
    }
  };
  const session = await Ui.createHeadlessSession({
    cols: 80,
    rows: 24,
    snapshot: baseSnapshot(),
    state: {
      utilities: {
        babel: {
          text: 'first text',
          source: 'en',
          target: 'es'
        }
      }
    },
    syncActions: createSyncActions(),
    babelActions
  });

  session.click('tab-translate');
  session.click('translate-start');
  assert.deepEqual(calls[0], ['translate', {text: 'first text', source: 'en', target: 'es'}]);

  session.focus('translate-text');
  session.dispatchText(' changed');
  assert.equal(session.state().utilities.babel.translation, '');

  resolveTranslation({ok: true, translation: 'Primera traducción', dictionaryEntries: ['Primera — First']});
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(session.state().utilities.babel.text, 'first text changed');
  assert.equal(session.state().utilities.babel.translation, '');
  assert.deepEqual(session.state().utilities.babel.dictionaryEntries, []);
  assert.doesNotMatch(session.output(), /Primera traducción/);
  assert.doesNotMatch(session.output(), /Primera — First/);

  session.click('translate-copy');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[1], ['copy', {translation: ''}]);
  assert.doesNotMatch(session.output(), /Copied\./);
  session.destroy();
});

test('Translate utility performs translation, displays dictionary, and copies through injected adapter', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const babelActions = {
    async translate(values) {
      calls.push(['translate', values]);
      return {ok: true, translation: 'Hola mundo', source: 'en', target: 'es', dictionaryEntries: ['Hola — Hello']};
    },
    async copyResult(values) {
      calls.push(['copy', values]);
      return {ok: true, message: 'Copied.'};
    }
  };
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(), babelActions});

  session.click('tab-translate');
  session.focus('translate-text');
  session.dispatchText('hello world');
  session.click('translate-start');
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls[0], ['translate', {text: 'hello world', source: 'auto', target: 'en'}]);
  assert.match(session.output(), /Translation/);
  assert.match(session.output(), /Hola mundo/);
  assert.match(session.output(), /Dictionary/);
  assert.match(session.output(), /Hola — Hello/);

  session.click('translate-copy');
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls[1], ['copy', {translation: 'Hola mundo'}]);
  assert.match(session.output(), /Copied\./);
  session.destroy();
});

test('TTS utility handles missing credentials without API-key input and uses approved copy', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const ttsActions = {
    voices: ['alloy', 'nova'],
    getDefaultVoice: () => 'alloy',
    async createAudio(values) {
      calls.push(['createAudio', values]);
      return {ok: false, error: 'Set up Text to Speech before creating audio.'};
    },
    async setDefaultVoice(values) {
      calls.push(['setDefaultVoice', values]);
      return {ok: true, voice: values.voice};
    }
  };
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(), ttsActions});

  session.click('tab-speech');

  assert.equal(session.state().activeTab, 'Speech');
  assert.match(session.output(), /Text to Speech/);
  assert.match(session.output(), /Input file/);
  assert.match(session.output(), /Output file/);
  assert.match(session.output(), /Voice/);
  assert.match(session.output(), /Create audio/);
  assert.match(session.output(), /Start conversion/);
  assert.match(session.output(), /Choose voice/);
  assert.doesNotMatch(session.output(), /API key|OpenAI API key|password|secret/i);

  session.click('tts-start');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(calls.length, 1);
  assert.match(session.output(), /Set up Text to Speech before creating audio\./);
  session.destroy();
});




test('TTS utility renders actions in the bottom action area', async () => {
  const Ui = require(uiModulePath);
  const ttsActions = {
    voices: ['alloy', 'nova'],
    getDefaultVoice: () => 'alloy',
    async createAudio() {
      return {ok: true, outputFile: './tmp/unused.mp3', message: 'Audio ready.'};
    },
    async setDefaultVoice(values) {
      return {ok: true, voice: values.voice};
    }
  };
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(), ttsActions});

  try {
    session.click('tab-speech');

    const lines = visibleLines(session.output());
    const actionRow = lines.findIndex(line => /Start conversion/.test(line) && /Choose voice/.test(line));

    assert.equal(actionRow, 22, `TTS actions must render in the fixed action area:
${lines.join('\n')}`);
    assert.equal(lines.slice(2, 22).some(line => /Start conversion|Choose voice/.test(line)), false, `TTS panel body must stay for inputs, status, errors, and voice state:
${lines.join('\n')}`);
    assert.equal(lines.filter(line => line.length > 80).length, 0);
  } finally {
    session.destroy();
  }
});

test('TTS voice overlay pins Cancel to the overlay bottom', async () => {
  const Ui = require(uiModulePath);
  const ttsActions = {
    voices: ['alloy', 'nova'],
    getDefaultVoice: () => 'alloy',
    async createAudio() {
      return {ok: true, outputFile: './tmp/unused.mp3', message: 'Audio ready.'};
    },
    async setDefaultVoice(values) {
      return {ok: true, voice: values.voice};
    }
  };
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(), ttsActions});

  session.click('tab-speech');
  session.click('tts-choose-voice');

  const lines = visibleLines(session.output());
  const actionRow = lines.findIndex(line => /Cancel/.test(line));

  assert.notEqual(actionRow, -1, `expected TTS voice cancel action:\n${lines.join('\n')}`);
  assert.equal(actionRow, 20, `TTS voice Cancel must render on the last internal overlay row:\n${lines.join('\n')}`);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});


test('TTS voice overlay keeps Cancel visible with the default voice set', async () => {
  const Ui = require(uiModulePath);
  const expectedVoices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];
  const ttsActions = {
    getDefaultVoice: () => 'alloy',
    async createAudio() {
      return {ok: true, outputFile: './tmp/unused.mp3', message: 'Audio ready.'};
    },
    async setDefaultVoice(values) {
      return {ok: true, voice: values.voice};
    }
  };
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(), ttsActions});

  session.click('tab-speech');
  session.click('tts-choose-voice');

  const lines = visibleLines(session.output());
  const actionRow = lines.findIndex(line => /Cancel/.test(line));

  assert.deepEqual(session.state().utilities.tts.voices, expectedVoices);
  for (const voice of expectedVoices) {
    assert.match(session.output(), new RegExp(String.raw`\b${voice}\b`), `expected visible default TTS voice ${voice}:
${lines.join('\n')}`);
  }
  assert.notEqual(actionRow, -1, `expected TTS voice cancel action with default voices:
${lines.join('\n')}`);
  assert.equal(actionRow, 20, `TTS voice Cancel must stay on the last internal overlay row with default voices:
${lines.join('\n')}`);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});

test('TTS voice overlay render does not refresh or rewrite voice state', () => {
  const {renderTerminal, Screen} = require('@valyrianjs/terminal');
  const {createUtilityOverlay} = require('../ui/components/UtilityHost.tsx');
  const state = {
    activeOverlay: 'tts-voice',
    sync: {label: 'Not set up', details: ['Status: Not set up'], error: '', operation: null, statusLoaded: false, initForm: {remoteUrl: '', branch: 'main', confirmed: false, error: ''}},
    babel: {text: '', source: 'auto', target: 'en', translation: '', dictionaryEntries: [], error: '', message: '', operation: null, inputVersion: 0},
    tts: {inputFile: '', outputFile: '', voice: 'alloy', voices: ['alloy'], error: '', message: '', operation: null}
  };
  const ttsActions = {
    voices: ['nova'],
    getDefaultVoice() {
      throw new Error('render must not request default TTS voice');
    },
    async createAudio() {
      return {ok: true, outputFile: './tmp/unused.mp3', message: 'Audio ready.'};
    },
    async setDefaultVoice(values) {
      return {ok: true, voice: values.voice};
    }
  };
  const syncActions = createSyncActions();
  const babelActions = {translate: async () => ({ok: false, error: 'no'}), copyResult: async () => ({ok: false, error: 'no'})};

  const output = renderTerminal(Screen({}, [createUtilityOverlay(state, syncActions, babelActions, ttsActions, {width: 80, rows: 24})]), {cols: 80, rows: 24});

  assert.match(output, /Choose voice/);
  assert.deepEqual(state.tts.voices, ['alloy']);
  assert.equal(state.tts.voice, 'alloy');
});


test('TTS utility can choose default voice and display audio progress/result through injected adapter', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const ttsActions = {
    voices: ['alloy', 'nova'],
    getDefaultVoice: () => 'alloy',
    async createAudio(values) {
      calls.push(['createAudio', {inputFile: values.inputFile, outputFile: values.outputFile, voice: values.voice}]);
      values.onProgress('Creating audio...');
      return {ok: true, outputFile: values.outputFile, message: 'Audio ready.'};
    },
    async setDefaultVoice(values) {
      calls.push(['setDefaultVoice', values]);
      return {ok: true, voice: values.voice};
    }
  };
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(), ttsActions});

  session.click('tab-speech');
  session.click('tts-choose-voice');
  assert.equal(session.state().utilities.activeOverlay, 'tts-voice');
  assert.match(session.output(), /Choose voice/);
  clickVisibleText(session, 'nova');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[0], ['setDefaultVoice', {voice: 'nova'}]);

  session.focus('tts-input-file');
  session.dispatchText('./tmp/ui-tts-actions/ready.txt');
  session.focus('tts-output-file');
  session.dispatchText('./tmp/ui-tts-actions/ready.mp3');
  session.click('tts-start');
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls[1], ['createAudio', {inputFile: './tmp/ui-tts-actions/ready.txt', outputFile: './tmp/ui-tts-actions/ready.mp3', voice: 'nova'}]);
  assert.match(session.output(), /Audio ready\./);
  session.destroy();
});


test('TTS utility initializes from persisted default voice before creating audio', async () => {
  const Ui = require(uiModulePath);
  const calls = [];
  const ttsActions = {
    voices: ['alloy', 'nova'],
    getDefaultVoice: () => 'nova',
    async createAudio(values) {
      calls.push(['createAudio', {inputFile: values.inputFile, outputFile: values.outputFile, voice: values.voice}]);
      return {ok: true, outputFile: values.outputFile, message: 'Audio ready.'};
    },
    async setDefaultVoice(values) {
      calls.push(['setDefaultVoice', values]);
      return {ok: true, voice: values.voice};
    }
  };
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(), ttsActions});

  session.click('tab-speech');

  assert.match(session.output(), /nova/);

  session.focus('tts-input-file');
  session.dispatchText('./tmp/ui-tts-actions/ready.txt');
  session.focus('tts-output-file');
  session.dispatchText('./tmp/ui-tts-actions/default-voice.mp3');
  session.click('tts-start');
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls[0], ['createAudio', {inputFile: './tmp/ui-tts-actions/ready.txt', outputFile: './tmp/ui-tts-actions/default-voice.mp3', voice: 'nova'}]);
  session.destroy();
});
