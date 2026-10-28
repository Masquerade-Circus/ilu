import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { withTempHome } from '../support/home-sandbox.ts';
import { createBabelActions } from '../ui/modules/babel/actions.ts';
import { FakeStdin, FakeStdout, findNodeById, exerciseEditorHeight } from './test-helpers/ui-app.ts';
import fs from 'node:fs';
import { createTtsService } from '../tts/index.ts';
import { createTtsActions } from '../ui/modules/tts/actions.ts';
import {captureCommand, assertCaptureArtifacts} from './test-helpers/terminal-capture-scenarios.ts';
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..');
import 'tsx/cjs';
const uiModulePath = path.join(repoRoot, 'ui', 'app.tsx');

test('physical capture Translate editor preserves real inputs and actions across growth and shrink without provider calls', async context => {
  const {captureIluScenario} = await import('./test-helpers/terminal-capture.ts');
  const result = await captureIluScenario({scenario: 'translateEditor', command: captureCommand, viewport: {cols: 80, rows: 24}});
  assert.equal(result.exitCode, 0);
  assertCaptureArtifacts({result, checkpoints: ['translate-1', 'translate-2', 'translate-3'], diagnostic: message => context.diagnostic(message)});
});

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

function baseSnapshot(overrides: any = {}) {
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

test('Translate editor uses available height across resize and keeps language fields and actions usable', async () => {
  await withTempHome(async () => {
    const Ui = await import('../ui/app.tsx');
    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    stdout.columns = 100;
    const session = await Ui.mountInteractiveSession({stdin, stdout, state: {activeTab: 'Translate'}, snapshot: baseSnapshot()});

    try {
      await exerciseEditorHeight({
        session, stdin, stdout,
        editorId: 'translate-text',
        followingControl: /Language codes/,
        requiredText: [/From/, /To/, /Dictionary/, /Copy result/]
      });
      assert.equal(session.focus('translate-from'), true);
      session.dispatchKey('CTRL_A');
      stdin.send('\x1b[200~en\x1b[201~');
      assert.equal(session.focus('translate-to'), true);
      session.dispatchKey('CTRL_A');
      stdin.send('\x1b[200~es\x1b[201~');
      assert.match(session.output(), /From.*en/);
      assert.match(session.output(), /To.*es/);
      session.focus('translate-text');
      session.dispatchKey('END');
      stdin.send('!');
      assert.match(session.output(), /EditorRow-64!/, 'editing must still work after shrinking');
      session.dispatchKey('CTRL_1');
      session.dispatchKey('CTRL_6');
      session.focus('translate-text');
      for (let line = 0; line < 64; line += 1) {
        session.dispatchKey('DOWN');
      }
      assert.match(session.output(), /EditorRow-64!/, 'navigation must preserve the resized editor draft');
    } finally {
      await session.destroy();
    }
  });
});

test('Translate app opens from top nav and renders approved copy', async () => {
  const Ui = await import('../ui/app.tsx');
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
  assert.doesNotMatch(output, /no (?:dictionary )?(?:entries|results).*found/i);
  assert.equal(lines.filter(line => line.length > 80).length, 0);
  session.destroy();
});



test('Translate utility renders actions in the bottom action area', async () => {
  const Ui = await import('../ui/app.tsx');
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
  const Ui = await import('../ui/app.tsx');
  const calls = [];
  const babelActions = {
    async translate(values) {
      calls.push(['translate', values]);
      return {ok: false, error: 'Could not translate the text.'};
    },
    async copyResult(values) {
      calls.push(['legacy-copy', values]);
      return {ok: false, error: 'legacy copy must not be called'};
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
  assert.equal(calls.length, 1);
  assert.equal(session.state().utilities.babel.translation, '');
  assert.deepEqual(session.state().utilities.babel.dictionaryEntries, []);
  assert.doesNotMatch(session.output(), /Old translation/);
  session.destroy();
});

test('Translate utility validates required fields before calling the action', async () => {
  const Ui = await import('../ui/app.tsx');
  const calls = [];
  const babelActions = {
    async translate(values) {
      calls.push(['translate', values]);
      return {ok: true, translation: 'unused'};
    },
    async copyResult(values) {
      calls.push(['legacy-copy', values]);
      return {ok: false, error: 'legacy copy must not be called'};
    }
  };
  const session = await Ui.createHeadlessSession({cols: 80, rows: 24, snapshot: baseSnapshot(), syncActions: createSyncActions(), babelActions});

  session.click('tab-translate');
  session.click('translate-start');
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(calls, []);
  assert.match(session.output(), /Text to translate is required\./);
  session.destroy();
});


test('Translate utility ignores stale in-flight translation after input changes', async () => {
  const Ui = await import('../ui/app.tsx');
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
      calls.push(['legacy-copy', values]);
      return {ok: false, error: 'legacy copy must not be called'};
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
  assert.equal(calls.length, 1);
  assert.doesNotMatch(session.output(), /Copied\./);
  session.destroy();
});

test('Translate utility performs translation, displays dictionary, and copies through Valyrian clipboard', async () => {
  const Ui = await import('../ui/app.tsx');
  const calls = [];
  const babelActions = {
    async translate(values) {
      calls.push(['translate', values]);
      return {ok: true, translation: 'Hola mundo', source: 'en', target: 'es', dictionaryEntries: ['Hola — Hello']};
    },
    async copyResult(values) {
      calls.push(['legacy-copy', values]);
      return {ok: false, error: 'legacy copy must not be called'};
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

  assert.equal(calls.length, 1);
  assert.equal(session.clipboard(), 'Hola mundo');
  assert.match(session.output(), /Copied\./);
  session.destroy();
});

test('TTS utility handles missing credentials without API-key input and uses approved copy', async () => {
  const Ui = await import('../ui/app.tsx');
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

  assert.equal(calls.length, 0);
  assert.match(session.output(), /Input file is required\./);
  session.destroy();
});




test('TTS utility renders actions in the bottom action area', async () => {
  const Ui = await import('../ui/app.tsx');
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
  const Ui = await import('../ui/app.tsx');
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
  const Ui = await import('../ui/app.tsx');
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

test('TTS voice overlay render does not refresh or rewrite voice state', async () => {
  const { renderTerminal, Screen } = await import('@valyrianjs/terminal');
  const { createTtsVoiceOverlay } = await import('../ui/modules/tts/MainView.tsx');
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

  const output = renderTerminal(Screen({}, [createTtsVoiceOverlay(state, ttsActions, {width: 80, rows: 24})]), {cols: 80, rows: 24});

  assert.match(output, /Choose voice/);
  assert.deepEqual(state.tts.voices, ['alloy']);
  assert.equal(state.tts.voice, 'alloy');
});


test('TTS utility can choose default voice and display audio progress/result through injected adapter', async () => {
  const Ui = await import('../ui/app.tsx');
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
  const Ui = await import('../ui/app.tsx');
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

test('Translate TUI rejects missing segments without enabling copy', async () => {
  await withTempHome(async () => {
    const Ui = await import('../ui/app.tsx');
    const session = await Ui.createHeadlessSession({
      snapshot: baseSnapshot(),
      state: {activeTab: 'Translate', utilities: {babel: {text: 'Example'}}},
      babelActions: createBabelActions({provider: async () => ({sentences: [{trans: 23}]})})
    });
    try {
      session.click('translate-start');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(session.state().utilities.babel.translation, '');
      assert.ok(session.state().utilities.babel.error.length > 0);
      session.click('translate-copy');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(session.clipboard(), '');
    } finally {
      await session.destroy();
    }
  });
});

test('Translate TUI displays and copies every provider segment in order', async () => {
  await withTempHome(async () => {
    const Ui = await import('../ui/app.tsx');
    const session = await Ui.createHeadlessSession({
      snapshot: baseSnapshot(),
      state: {activeTab: 'Translate', utilities: {babel: {text: 'First. Second.'}}},
      babelActions: createBabelActions({provider: async () => ({sentences: [{trans: 'Primero. '}, {trans: 'Segundo.'}], src: 'en'})})
    });
    try {
      session.click('translate-start');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(session.state().utilities.babel.translation, 'Primero. Segundo.', JSON.stringify(session.state().utilities.babel) + '\n' + session.output());
      assert.ok(stripAnsi(session.output()).includes('Primero. Segundo.'));
      session.click('translate-copy');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(session.clipboard(), 'Primero. Segundo.');
    } finally {
      await session.destroy();
    }
  });
});

function setTranslationDraft({session, text}) {
  assert.equal(session.focus('translate-text'), true);
  session.dispatchKey('CTRL_A');
  session.dispatchKey('BACKSPACE');
  session.dispatchText(text);
}

async function submitTranslation({session, text}) {
  setTranslationDraft({session, text});
  session.click('translate-start');
  await new Promise(resolve => setImmediate(resolve));
}

test('terminal integration Translate history excludes drafts, invalid, failed and obsolete requests', async () => {
  await withTempHome(async () => {
    const Ui = await import('../ui/app.tsx');
    let finishObsolete;
    const obsolete = new Promise(resolve => { finishObsolete = resolve; });
    const requested = [];
    const session = await Ui.createHeadlessSession({
      snapshot: baseSnapshot(), state: {activeTab: 'Translate'},
      babelActions: createBabelActions({provider: async ({text}) => {
        requested.push(text);
        if (text === 'Failed text') {
          throw new Error('Controlled provider failure');
        }
        if (text === 'Obsolete text') {
          return obsolete;
        }
        if (text === 'Missing result') {
          return {sentences: []};
        }
        return {sentences: [{trans: 'Translated text'}]};
      }})
    });
    try {
      await submitTranslation({session, text: 'Successful text'});
      await submitTranslation({session, text: ''});
      await submitTranslation({session, text: 'Failed text'});
      await submitTranslation({session, text: 'Missing result'});
      await submitTranslation({session, text: 'Obsolete text'});
      setTranslationDraft({session, text: 'Unsubmitted draft'});
      finishObsolete({sentences: [{trans: 'Obsolete result'}]});
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(requested, ['Successful text', 'Failed text', 'Missing result', 'Obsolete text']);
      assert.equal(session.state().utilities.babel.translation, '', 'obsolete completion must not replace the draft result');

      session.dispatchKey('ALT_UP');
      assert.equal(session.state().utilities.babel.text, 'Successful text');
      assert.match(session.output(), /Successful text/);
      session.dispatchKey('ALT_UP');
      assert.equal(session.state().utilities.babel.text, 'Successful text', 'excluded requests must not be available as older history');
      session.dispatchKey('ALT_DOWN');
      assert.equal(session.state().utilities.babel.text, 'Unsubmitted draft', 'history must restore the current draft');
    } finally {
      finishObsolete({sentences: []});
      await session.destroy();
    }
  });
});

test('terminal integration Translate history restores multiline text and the draft across tabs', async () => {
  await withTempHome(async () => {
    const Ui = await import('../ui/app.tsx');
    const requested = [];
    const session = await Ui.createHeadlessSession({
      snapshot: baseSnapshot(), state: {activeTab: 'Translate'},
      babelActions: createBabelActions({provider: async ({text}) => {
        requested.push(text);
        return {sentences: [{trans: 'Translation'}]};
      }})
    });
    try {
      await submitTranslation({session, text: 'First source\nSecond line'});
      await submitTranslation({session, text: 'Latest source'});
      session.dispatchKey('CTRL_1');
      session.dispatchKey('CTRL_6');
      setTranslationDraft({session, text: 'Draft xy'});
      session.dispatchKey('LEFT');
      session.dispatchKey('ALT_UP');
      assert.equal(session.state().utilities.babel.text, 'Latest source');
      session.dispatchKey('ALT_UP');
      assert.equal(session.state().utilities.babel.text, 'First source\nSecond line');
      assert.match(session.output(), /First source/);
      assert.match(session.output(), /Second line/);
      session.dispatchKey('ALT_DOWN');
      assert.equal(session.state().utilities.babel.text, 'Latest source');
      session.dispatchKey('ALT_DOWN');
      assert.equal(session.state().utilities.babel.text, 'Draft xy');
      session.dispatchText('!');
      assert.equal(session.state().utilities.babel.text, 'Draft x!y', 'restoring the draft must restore its cursor');
      session.dispatchKey('ALT_UP');
      session.dispatchKey('ALT_UP');
      session.click('translate-start');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(requested.at(-1), 'First source\nSecond line', 'recovered history must be usable as the next translation input');
    } finally {
      await session.destroy();
    }
  });
});

test('terminal integration Translate history retains only ten distinct recent successful texts', async () => {
  await withTempHome(async () => {
    const Ui = await import('../ui/app.tsx');
    const session = await Ui.createHeadlessSession({
      snapshot: baseSnapshot(), state: {activeTab: 'Translate'},
      babelActions: createBabelActions({provider: async () => ({sentences: [{trans: 'Translation'}]})})
    });
    try {
      for (let index = 1; index <= 12; index += 1) {
        await submitTranslation({session, text: `Successful-${index}`});
      }
      await submitTranslation({session, text: 'Successful-12'});
      setTranslationDraft({session, text: 'Working draft'});
      const recalled = [];
      for (let index = 0; index < 12; index += 1) {
        session.dispatchKey('ALT_UP');
        recalled.push(session.state().utilities.babel.text);
      }
      assert.equal(recalled[0], 'Successful-12');
      assert.equal(new Set(recalled.slice(0, 10)).size, 10, 'duplicates must not consume history slots');
      assert.deepEqual(new Set(recalled), new Set(Array.from({length: 10}, (_, index) => `Successful-${index + 3}`)));
      assert.equal(recalled[10], recalled[9], 'older texts must be evicted at the retention limit');
      await submitTranslation({session, text: 'Successful-3'});
      setTranslationDraft({session, text: 'Another draft'});
      session.dispatchKey('ALT_UP');
      assert.equal(session.state().utilities.babel.text, 'Successful-3', 'reusing an older text must make it the most recent');
      session.dispatchKey('ALT_UP');
      assert.equal(session.state().utilities.babel.text, 'Successful-12');
    } finally {
      await session.destroy();
    }
  });
});

test('terminal integration Translate history stays in memory and disappears in a new session', async () => {
  await withTempHome(async home => {
    const Ui = await import('../ui/app.tsx');
    const options = {
      snapshot: baseSnapshot(), state: {activeTab: 'Translate'},
      babelActions: createBabelActions({provider: async () => ({sentences: [{trans: 'Translation'}]})})
    };
    const session = await Ui.createHeadlessSession(options);
    try {
      const before = fs.readdirSync(home, {recursive: true}).filter(entry => fs.statSync(path.join(home, String(entry))).isFile())
        .map(entry => [String(entry), fs.readFileSync(path.join(home, String(entry)), 'utf8')]);
      await submitTranslation({session, text: 'Session-only synthetic source'});
      setTranslationDraft({session, text: 'Draft'});
      session.dispatchKey('ALT_UP');
      assert.equal(session.state().utilities.babel.text, 'Session-only synthetic source');
      const after = fs.readdirSync(home, {recursive: true}).filter(entry => fs.statSync(path.join(home, String(entry))).isFile())
        .map(entry => [String(entry), fs.readFileSync(path.join(home, String(entry)), 'utf8')]);
      assert.deepEqual(after, before, 'translation history must not write to disk');
    } finally {
      await session.destroy();
    }
    const reopened = await Ui.createHeadlessSession(options);
    try {
      setTranslationDraft({session: reopened, text: 'New session draft'});
      reopened.dispatchKey('ALT_UP');
      assert.equal(reopened.state().utilities.babel.text, 'New session draft', 'a new session must not inherit prior history');
    } finally {
      await reopened.destroy();
    }
  });
});

test('Translate TUI communicates unavailable copy and pending translation at the controls', async () => {
  await withTempHome(async () => {
    const Ui = await import('../ui/app.tsx');
    let finish;
    let requests = 0;
    const response = new Promise(resolve => { finish = resolve; });
    const session = await Ui.mountInteractiveSession({
      stdin: new FakeStdin(), stdout: new FakeStdout(), snapshot: baseSnapshot(),
      state: {activeTab: 'Translate', utilities: {babel: {text: 'Example'}}},
      babelActions: createBabelActions({provider: async () => { requests += 1; return response; }})
    });
    try {
      const copy = findNodeById(session.tree(), 'translate-copy');
      assert.ok(copy === null || [copy.props.state].flat().includes('disabled'), 'copy without a result must communicate unavailability');
      session.click('translate-start');
      const start = findNodeById(session.tree(), 'translate-start');
      assert.ok([start?.props.state].flat().some(state => state === 'disabled' || state === 'loading'));
      session.click('translate-start');
      assert.equal(requests, 1);
      finish({sentences: [{trans: 'Ejemplo'}], src: 'en'});
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(stripAnsi(session.output()).includes('Ejemplo'));
      const readyCopy = findNodeById(session.tree(), 'translate-copy');
      assert.ok(![readyCopy?.props.state].flat().includes('disabled'));
    } finally {
      finish({sentences: []});
      await session.destroy();
    }
  });
});

test('Translate first-use guidance distinguishes unqueried and no dictionary results', async () => {
  await withTempHome(async () => {
    const Ui = await import('../ui/app.tsx');
    let requests = 0;
    const session = await Ui.createHeadlessSession({
      snapshot: baseSnapshot(), state: {activeTab: 'Translate'},
      babelActions: createBabelActions({provider: async () => { requests += 1; return {sentences: [{trans: 'Ejemplo'}], dict: []}; }})
    });
    try {
      const initial = stripAnsi(session.output());
      assert.match(initial, /5[,.]?000/);
      assert.match(initial, /\b(?:en|es|fr)\b/);
      assert.doesNotMatch(initial, /no (?:dictionary )?(?:entries|results).*found/i);
      session.focus('translate-text');
      session.dispatchText('Example');
      session.click('translate-start');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(requests, 1);
      assert.match(stripAnsi(session.output()), /(?:no|without|not available)[^\n]*(?:dictionary|entries)|dictionary[^\n]*(?:no|empty)/i);
    } finally {
      await session.destroy();
    }
  });
});

test('Speech TUI marks pending actions unavailable and restores retry after SDK failure', async () => {
  await withTempHome(async home => {
    const Ui = await import('../ui/app.tsx');
    const inputFile = path.join(home, 'input.txt');
    const outputFile = path.join(home, 'output.mp3');
    const configFile = path.join(home, '.ilu', '.config', 'tts-config.json');
    fs.mkdirSync(path.dirname(configFile), {recursive: true});
    fs.writeFileSync(configFile, JSON.stringify({apiKey: 'synthetic-test-key', voice: 'alloy'}));
    fs.writeFileSync(inputFile, 'Synthetic audio text');
    let fail;
    let requests = 0;
    const pending = new Promise((_resolve, reject) => { fail = reject; });
    const service = createTtsService({createOpenAI: () => ({audio: {speech: {async create() {
      requests += 1;
      await pending;
      throw new Error('Controlled failure');
    }}}})});
    const session = await Ui.mountInteractiveSession({
      stdin: new FakeStdin(), stdout: new FakeStdout(), snapshot: baseSnapshot(),
      state: {activeTab: 'Speech', utilities: {tts: {inputFile, outputFile}}},
      ttsActions: createTtsActions({service})
    });
    try {
      session.click('tts-start');
      await new Promise(resolve => setImmediate(resolve));
      for (const id of ['tts-start', 'tts-choose-voice']) {
        const control = findNodeById(session.tree(), id);
        assert.ok(control === null || [control.props.state].flat().some(state => state === 'disabled' || state === 'loading'), id);
        session.click(id);
      }
      assert.equal(requests, 1);
      assert.equal(session.focus('tts-voice-list'), false);
      assert.equal(fs.existsSync(outputFile), false);
      fail(new Error('Controlled SDK failure'));
      await new Promise(resolve => setImmediate(resolve));
      const retry = findNodeById(session.tree(), 'tts-start');
      assert.ok(retry);
      assert.ok(![retry.props.state].flat().includes('disabled'));
      session.click('tts-start');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(requests, 2);
      assert.equal(fs.existsSync(outputFile), false);
    } finally {
      fail(new Error('Controlled SDK cleanup'));
      await session.destroy();
    }
  });
});
