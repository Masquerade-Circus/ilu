import test from 'node:test';
import assert from 'node:assert/strict';
import {captureIluScenario} from './test-helpers/terminal-capture.ts';
import {captureCommand, assertCaptureArtifacts} from './test-helpers/terminal-capture-scenarios.ts';

// Integration requirement: tuiInteraction executes these steps against the live
// Node CLI in the captured PTY. Targets are visible text, never component IDs.
// expect uses the current PTY screen. remember/unchanged read private HOME data.
// Every expect is an assertion, not a hint for choosing a generic recording.
const cases = [
  {
    name: 'a11y shell closes active page overlay when switching tabs by keyboard shortcut',
    steps: [
      {click: 'Add task'}, {expect: {text: 'Task title'}},
      {key: 'CTRL_2'}, {expect: {text: 'Capture note', absent: 'Task title'}},
      {screenshot: 'result'}
    ]
  },
  {
    name: 'a11y overlay opening sets stable initial focus',
    steps: [
      {remember: ['todos', 'clocks']}, {click: 'Add task'},
      {type: 'Initial task focus'}, {expect: {text: 'Initial task focus'}},
      {click: 'Cancel'}, {key: 'CTRL_4'}, {click: 'Add clock'},
      {type: 'Initial clock focus'}, {expect: {text: 'Initial clock focus'}},
      {screenshot: 'result'}, {click: 'Cancel'}, {unchanged: ['todos', 'clocks']}
    ]
  },
  {
    name: 'a11y top nav groups apps and Sync as a global control',
    steps: [
      {expect: {sameRowOrdered: ['Todo', 'Notes', 'Board', 'Clocks', 'Translate', 'Speech', 'Sync'], absent: 'Tools'}},
      {key: 'CTRL_5'}, {expect: {text: 'Retry sync'}}, {screenshot: 'result'}
    ]
  },
  {
    name: 'a11y Board Space and Enter select without destructive card actions',
    steps: [
      {remember: ['boards']}, {key: 'CTRL_3'}, {click: 'Long'},
      {key: 'SPACE'}, {key: 'ENTER'},
      {expect: {text: 'Long', absent: 'Card title'}},
      {unchanged: ['boards']}, {screenshot: 'result'},
      {key: 'o'}, {expect: {overlayTexts: ['Edit', 'Move', 'Remove']}}, {key: 'ESCAPE'}
    ]
  },
  {
    name: 'a11y Board exposes keyboard shortcut for card and column details',
    steps: [
      {remember: ['boards']}, {key: 'CTRL_3'}, {click: 'Long'},
      {key: 'ENTER'}, {key: 'o'}, {expect: {overlayTexts: ['Edit', 'Move', 'Remove']}},
      {key: 'ESCAPE'}, {click: 'Backlog'}, {key: 'ENTER'}, {key: 'o'},
      {expect: {text: 'Remove column'}}, {screenshot: 'result'},
      {key: 'ESCAPE'}, {resize: {cols: 80, rows: 40}},
      {key: 'CTRL_K'}, {expect: {text: 'details'}},
      {key: 'ESCAPE'}, {unchanged: ['boards']}
    ]
  }
];

for (const entry of cases) {
  test(entry.name, async context => {
    const result = await captureIluScenario({
      testName: context.name,
      scenario: 'tuiInteraction',
      command: captureCommand,
      viewport: {cols: 80, rows: 24},
      input: {steps: entry.steps, finish: 'normal-exit'}
    });
    assert.equal(result.exitCode, 0);
    assertCaptureArtifacts({result, testName: context.name, checkpoints: ['result'], diagnostic: message => context.diagnostic(message)});
  });
}
