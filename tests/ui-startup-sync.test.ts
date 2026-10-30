import test from 'node:test';
import assert from 'node:assert/strict';
import {captureIluScenario} from './test-helpers/terminal-capture.ts';
import {captureCommand, assertCaptureArtifacts} from './test-helpers/terminal-capture-scenarios.ts';

// Integration requirement: prepare private local/bare Git repos before launch.
// The offline fixture uses a missing repo under the private workspace, never a
// network address. Conflict uses divergent real commits, not a patched client.
// Remote counters are observations of the controlled Git boundary. They must
// never be synthesized from the case's expected values.
const cases = [
  {
    name: 'TUI bloquea la sesión y evita el snapshot inicial cuando startup sync detecta conflicto',
    startupSync: {fixture: 'divergent-local-remote', autoPull: true},
    steps: [{expect: {startupBlocked: true, absent: 'Available offline'}}, {unchanged: ['todos']}, {screenshot: 'result'}],
    nonzero: true
  },
  {
    name: 'TUI continúa local y muestra estado degradado cuando startup sync falla por red',
    startupSync: {fixture: 'unavailable-private-remote', autoPull: true, localTask: 'Available offline'},
    steps: [{expect: {text: 'Available offline', syncStatus: 'failed'}}, {remoteOperations: {startupPull: 1}}, {screenshot: 'result'}],
    nonzero: false
  },
  {
    name: 'TUI completa startup sync una vez antes de construir su snapshot inicial',
    startupSync: {fixture: 'remote-only-new-task', autoPull: true, remoteTask: 'Pulled before first frame'},
    steps: [{expect: {firstAppFrameContains: 'Pulled before first frame'}}, {remoteOperations: {startupPull: 1}}, {screenshot: 'result'}, {exitNormally: true}, {remoteOperations: {activeChildren: 0}}],
    nonzero: false
  },
  {
    name: 'TUI omite startup sync cuando la recepción remota está desactivada',
    startupSync: {fixture: 'remote-only-new-task', autoPull: false, localTask: 'Available offline', remoteTask: 'Must not pull'},
    steps: [{expect: {text: 'Available offline', absent: 'Must not pull'}}, {remoteOperations: {startupPull: 0}}, {screenshot: 'result'}],
    nonzero: false
  }
];

for (const entry of cases) {
  test(entry.name, async context => {
    const result = await captureIluScenario({testName: context.name, scenario: 'tuiInteraction', command: captureCommand, viewport: {cols: 80, rows: 24}, input: {startupSync: entry.startupSync, rememberBeforeLaunch: ['todos'], steps: entry.steps, finish: entry.nonzero ? 'wait-for-exit' : 'normal-exit'}});
    assert.equal(Number.isInteger(result.exitCode), true);
    if (entry.nonzero) {
      assert.notEqual(result.exitCode, 0);
    } else {
      assert.equal(result.exitCode, 0);
    }
    assertCaptureArtifacts({result, testName: context.name, checkpoints: ['result'], diagnostic: message => context.diagnostic(message)});
  });
}
