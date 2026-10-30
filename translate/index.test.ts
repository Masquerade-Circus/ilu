import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {captureTranslationScenario} from '../tests/test-helpers/terminal-capture.ts';
import {assertCaptureArtifacts} from '../tests/test-helpers/terminal-capture-scenarios.ts';

const cli = path.resolve(import.meta.dirname, '..', 'bin', 'cli.js');

test('createTranslator usa el proveedor inyectado y evita red real al traducir', async context => {
  const result = await captureTranslationScenario({
    testName: context.name,
    command: ['node', cli, 'babel', '--source', 'en', '--target', 'es', 'hello', 'world'],
    scenario: 'translationCli',
    input: {
      http: {status: 200, body: {
        sentences: [{trans: 'Hola ', orig: 'hello '}, {trans: 'mundo', orig: 'world'}],
        dict: [{entry: [{word: 'Hola', reverse_translation: ['Hello']}]}], src: 'en'
      }},
      clipboardBefore: 'Previous synthetic clipboard'
    },
    viewport: {cols: 100, rows: 30}
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.requests.length, 1);
  const url = new URL(result.requests[0].url);
  assert.equal(url.searchParams.get('q'), 'hello world');
  assert.equal(url.searchParams.get('sl'), 'en');
  assert.equal(url.searchParams.get('tl'), 'es');
  assert.equal(result.clipboardAfter, 'Hola mundo');
  assert.deepEqual(result.clipboardWrites, ['Hola mundo']);
  assert.match(result.currentScreen, /EN\s*>\s*ES/);
  assert.match(result.currentScreen, /Hola mundo/);
  assert.match(result.currentScreen, /Hola[^\n]*Hello/);
  assertCaptureArtifacts({result, checkpoints: ['translation-result'], testName: context.name, diagnostic: message => context.diagnostic(message)});
});

test('createTranslator avisa cuando el proveedor no regresa una traducción', async context => {
  const result = await captureTranslationScenario({
    testName: context.name,
    command: ['node', cli, 'babel', '--source', 'en', '--target', 'es', 'missing'],
    scenario: 'translationCli',
    input: {http: {status: 200, body: {sentences: [], src: 'en'}}, clipboardBefore: 'Keep synthetic clipboard'},
    viewport: {cols: 100, rows: 30}
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.requests.length, 1);
  assert.match(result.currentScreen, /no translation|not found/i);
  assert.equal(result.clipboardAfter, 'Keep synthetic clipboard');
  assert.deepEqual(result.clipboardWrites, []);
  assertCaptureArtifacts({result, checkpoints: ['translation-result'], testName: context.name, diagnostic: message => context.diagnostic(message)});
});

test('createTranslator valida texto antes de llamar al proveedor', async context => {
  // One original case covered both invalid inputs. Keep both in one recording,
  // with a real CLI invocation and an inspectable checkpoint for each rejection.
  const result = await captureTranslationScenario({
    testName: context.name,
    scenario: 'translationValidation',
    input: {
      commands: [
        ['node', cli, 'babel', '--source', 'en', '--target', 'es', 'x'.repeat(5001)],
        ['node', cli, 'babel', '--source', 'en', '--target', 'es', '   ']
      ],
      clipboardBefore: 'Keep synthetic clipboard'
    },
    viewport: {cols: 100, rows: 30}
  });
  assert.equal(result.invocations.length, 2);
  for (const invocation of result.invocations) {
    assert.notEqual(invocation.exitCode, 0);
    assert.equal(invocation.clipboardAfter, 'Keep synthetic clipboard');
    assert.deepEqual(invocation.clipboardWrites, []);
  }
  assert.match(result.invocations[0].currentScreen, /5000/);
  assert.match(result.invocations[1].currentScreen, /text.*required|required.*text/i);
  assert.equal(result.requests.length, 0);
  assertCaptureArtifacts({result, checkpoints: ['translation-too-long', 'translation-missing'], testName: context.name, diagnostic: message => context.diagnostic(message)});
});

test('CLI translation does not copy malformed or empty provider results', async context => {
  const bodies = [null, {}, {sentences: null}, {sentences: [null]}, {sentences: [{trans: 23}]}, {sentences: [{trans: '   '}]}];
  const result = await captureTranslationScenario({
    testName: context.name,
    command: ['node', cli, 'babel', '--source', 'en', '--target', 'es', 'Example'],
    scenario: 'translationMalformedResults',
    input: {bodies, clipboardBefore: 'Keep synthetic clipboard'},
    viewport: {cols: 100, rows: 30}
  });
  assert.equal(result.invocations.length, bodies.length);
  assert.equal(result.requests.length, bodies.length);
  for (const [index, invocation] of result.invocations.entries()) {
    assert.equal(invocation.clipboardAfter, 'Keep synthetic clipboard', `response ${index + 1}`);
    assert.deepEqual(invocation.clipboardWrites, [], `response ${index + 1} must not copy`);
    assert.ok(invocation.exitCode !== 0 || /no translation|not found|error|fail/i.test(invocation.currentScreen), `response ${index + 1} must expose failure`);
  }
  assertCaptureArtifacts({result, checkpoints: bodies.map((_, index) => `translation-invalid-${index + 1}`), testName: context.name, diagnostic: message => context.diagnostic(message)});
});
