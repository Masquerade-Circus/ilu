import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {captureTranslationScenario} from '../tests/test-helpers/terminal-capture.ts';
import {assertCaptureArtifacts} from '../tests/test-helpers/terminal-capture-scenarios.ts';

const cli = path.resolve(import.meta.dirname, '..', 'bin', 'cli.js');

// Integration owner: this fail-closed entry installs HTTP isolation before
// launchTerminal can start the real CLI. Its missing export intentionally
// prevents falling back to an unguarded capture while integration is pending.
// translationCli intercepts HTTP only, in the real Node CLI
// process, fails closed on unmatched requests, and reads its private clipboard.
// It must not replace createTranslator, its provider, or global fetch.
test('google translate provider encapsula la llamada HTTP actual', async context => {
  const result = await captureTranslationScenario({
    testName: context.name,
    command: ['node', cli, 'babel', '--source', 'en', '--target', 'es', 'hello'],
    scenario: 'translationCli',
    input: {
      http: {status: 200, body: {sentences: [{trans: 'Hola'}], src: 'en'}},
      clipboardBefore: 'Previous synthetic clipboard'
    },
    viewport: {cols: 100, rows: 30}
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.currentScreen, /Hola/);
  assert.equal(result.clipboardAfter, 'Hola');
  assert.equal(result.requests.length, 1);
  const request = result.requests[0];
  const url = new URL(request.url);
  assert.equal(url.hostname, 'translate.google.com');
  assert.equal(url.pathname, '/translate_a/single');
  assert.equal(url.searchParams.get('sl'), 'en');
  assert.equal(url.searchParams.get('tl'), 'es');
  assert.equal(url.searchParams.get('q'), 'hello');
  assert.equal(request.method.toUpperCase(), 'GET');
  assert.match(request.headers['user-agent'], /AndroidTranslate/);
  assertCaptureArtifacts({result, checkpoints: ['translation-result'], testName: context.name, diagnostic: message => context.diagnostic(message)});
});

test('google translate provider reporta errores HTTP sin cerrar el proceso', async context => {
  const result = await captureTranslationScenario({
    testName: context.name,
    command: ['node', cli, 'ui'],
    scenario: 'translationHttpRecovery',
    input: {
      text: 'hello', source: 'en', target: 'es',
      http: [
        {status: 503, statusText: 'Service Unavailable'},
        {status: 200, body: {sentences: [{trans: 'Hola recuperada'}], src: 'en'}}
      ],
      clipboardBefore: 'Previous synthetic clipboard'
    },
    viewport: {cols: 100, rows: 30}
  });
  // The same live TUI must survive the failed request, permit a retry and copy
  // only its successful result. A fresh process would not prove recovery.
  assert.match(result.failureScreen, /503|unavailable|fail|error|could not/i);
  assert.equal(result.clipboardAfterFailure, 'Previous synthetic clipboard');
  assert.deepEqual(result.clipboardWritesAfterFailure, []);
  assert.match(result.recoveredScreen, /Hola recuperada/);
  assert.equal(result.clipboardAfter, 'Hola recuperada');
  assert.equal(result.requests.length, 2);
  assert.equal(result.exitCode, 0);
  assertCaptureArtifacts({result, checkpoints: ['translation-failed', 'translation-recovered'], testName: context.name, diagnostic: message => context.diagnostic(message)});
});

test('google translate provider usa global fetch por defecto', async context => {
  const result = await captureTranslationScenario({
    testName: context.name,
    command: ['node', cli, 'babel', '--source', 'en', '--target', 'fr', 'hello'],
    scenario: 'translationCli',
    input: {
      http: {status: 200, body: {sentences: [{trans: 'Bonjour'}], src: 'en'}},
      clipboardBefore: 'Previous synthetic clipboard'
    },
    viewport: {cols: 100, rows: 30}
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.currentScreen, /Bonjour/);
  assert.equal(result.clipboardAfter, 'Bonjour');
  assert.equal(result.requests.length, 1);
  assert.equal(new URL(result.requests[0].url).searchParams.get('tl'), 'fr');
  assertCaptureArtifacts({result, checkpoints: ['translation-result'], testName: context.name, diagnostic: message => context.diagnostic(message)});
});
