const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const tmpDir = path.join(repoRoot, 'tmp', 'ui-tts-actions');

function ensureFixture(name, content = 'Hello from a fixture.') {
  fs.mkdirSync(tmpDir, {recursive: true});
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

test('TTS UI adapter rejects missing credentials before service, OpenAI, or ffmpeg calls', async () => {
  const {createTtsActions} = require('../ui/modules/tts/actions');
  const calls = [];
  const inputFile = ensureFixture('missing-credentials.txt');
  const actions = createTtsActions({
    readStoredApiKey: () => '',
    service: {
      async action() {
        calls.push(['service']);
        return {outputFile: path.join(tmpDir, 'out.mp3')};
      }
    }
  });

  const result = await actions.createAudio({inputFile, outputFile: path.join(tmpDir, 'out.mp3'), voice: 'alloy'});

  assert.deepEqual(result, {ok: false, error: 'Set up Text to Speech before creating audio.'});
  assert.deepEqual(calls, []);
});

test('TTS UI adapter validates input extension, existence, output path, and voice before conversion', async () => {
  const {createTtsActions} = require('../ui/modules/tts/actions');
  const calls = [];
  const goodFile = ensureFixture('input.md');
  const badFile = ensureFixture('input.pdf');
  const actions = createTtsActions({
    readStoredApiKey: () => 'configured-test-key',
    service: {
      async action(args) {
        calls.push(['service', args]);
        return {outputFile: args.outputFile};
      }
    }
  });

  assert.deepEqual(await actions.createAudio({inputFile: badFile, outputFile: path.join(tmpDir, 'bad.mp3'), voice: 'alloy'}), {ok: false, error: 'Choose a .txt or .md file.'});
  assert.deepEqual(await actions.createAudio({inputFile: path.join(tmpDir, 'missing.txt'), outputFile: path.join(tmpDir, 'missing.mp3'), voice: 'alloy'}), {ok: false, error: 'Choose a .txt or .md file.'});
  assert.deepEqual(await actions.createAudio({inputFile: goodFile, outputFile: '   ', voice: 'alloy'}), {ok: false, error: 'Output file is required.'});
  assert.deepEqual(await actions.createAudio({inputFile: goodFile, outputFile: path.join(tmpDir, 'out.mp3'), voice: 'badvoice'}), {ok: false, error: 'Choose a supported voice.'});
  assert.deepEqual(calls, []);
});

test('TTS UI adapter creates audio through injected service and reports progress safely', async () => {
  const {createTtsActions} = require('../ui/modules/tts/actions');
  const inputFile = ensureFixture('ready.txt');
  const outputFile = path.join(tmpDir, 'ready.mp3');
  const progress = [];
  const calls = [];
  const actions = createTtsActions({
    readStoredApiKey: () => 'configured-test-key',
    service: {
      async action(args) {
        calls.push(['service', args]);
        return {outputFile: args.outputFile};
      }
    }
  });

  const result = await actions.createAudio({inputFile, outputFile, voice: 'nova', onProgress: message => progress.push(message)});

  assert.deepEqual(result, {ok: true, outputFile, message: 'Audio ready.'});
  assert.deepEqual(progress, ['Preparing file...', 'Creating audio...', 'Audio ready.']);
  assert.deepEqual(calls, [['service', {inputFile, outputFile, voice: 'nova'}]]);
});

test('TTS UI adapter redacts conversion failures and persists supported voices only', async () => {
  const {createTtsActions} = require('../ui/modules/tts/actions');
  const inputFile = ensureFixture('failure.txt');
  const outputFile = path.join(tmpDir, 'failure.mp3');
  const saved = [];
  const actions = createTtsActions({
    readStoredApiKey: () => 'configured-test-key',
    service: {
      async action() {
        throw new Error('OpenAI failed at /home/user/.config/key token=abc stack');
      },
      async voiceAction(args, options) {
        saved.push(options.voice || args.voice);
        return {voice: options.voice || args.voice};
      }
    }
  });

  assert.deepEqual(await actions.createAudio({inputFile, outputFile, voice: 'alloy'}), {ok: false, error: 'Could not create audio.'});
  assert.deepEqual(await actions.setDefaultVoice({voice: 'badvoice'}), {ok: false, error: 'Choose a supported voice.'});
  assert.deepEqual(await actions.setDefaultVoice({voice: 'nova'}), {ok: true, voice: 'nova'});
  assert.deepEqual(saved, ['nova']);
});
