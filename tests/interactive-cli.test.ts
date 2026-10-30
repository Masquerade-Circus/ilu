import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {captureIluScenario} from './test-helpers/terminal-capture.ts';
import {assertCaptureArtifacts} from './test-helpers/terminal-capture-scenarios.ts';
const repoRoot = path.resolve(import.meta.dirname, '..');

test('node bin/cli.js todo --add-list falla limpio cuando recibe stdin por pipe', async context => {
  const result = await captureIluScenario({
    testName: context.name,
    command: ['sh', '-c', 'printf "%s\\n" "Inbox" "Pendientes" | node "$1" todo --add-list', 'ilu-non-tty', path.join(repoRoot, 'bin/cli.js')],
    scenario: 'cliExit',
    viewport: {cols: 120, rows: 24}
  });

  assert.ok(Number.isInteger(result.exitCode), 'the CLI must finish with an actual exit status');
  assert.notEqual(result.exitCode, 0);
  assert.match(result.currentScreen, /interactive terminal/i);
  assert.doesNotMatch(fs.readFileSync(result.outputPath, 'utf8'), /ExitPromptError/);
  assertCaptureArtifacts({result, checkpoints: ['cli-result'], testName: context.name, diagnostic: message => context.diagnostic(message)});
});

test('node bin/cli.js c --add falla limpio cuando recibe stdin por pipe', async context => {
  const result = await captureIluScenario({
    testName: context.name,
    command: ['sh', '-c', 'printf "%s\\n" "America/Mexico_City" "CDMX" | node "$1" c --add', 'ilu-non-tty-clock', path.join(repoRoot, 'bin/cli.js')],
    scenario: 'cliExit',
    viewport: {cols: 120, rows: 24}
  });

  assert.ok(Number.isInteger(result.exitCode), 'the CLI must finish with an actual exit status');
  assert.notEqual(result.exitCode, 0);
  assert.match(result.currentScreen, /interactive terminal/i);
  assert.doesNotMatch(fs.readFileSync(result.outputPath, 'utf8'), /ExitPromptError/);
  assertCaptureArtifacts({result, checkpoints: ['cli-result'], testName: context.name, diagnostic: message => context.diagnostic(message)});
});
