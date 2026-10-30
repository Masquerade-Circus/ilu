import test from 'node:test';
import assert from 'node:assert/strict';
import {captureIluScenario} from './test-helpers/terminal-capture.ts';
import {captureCommand, assertCaptureArtifacts} from './test-helpers/terminal-capture-scenarios.ts';

// Preserve the shield guarantees through ilu's real task modal. The driver
// remembers coordinates BEFORE opening the modal, then clicks that same cell
// under its painted surface. It must not resolve the hidden target by ID.
const cases = [
  ['Valyrian Overlay modal shield blocks click-through to covered background hitboxes', [
    {remember: ['todos']}, {locate: {text: 'Capture task', as: 'covered-task'}},
    {click: 'Add task'}, {type: 'Shield draft'}, {clickRemembered: 'covered-task'},
    {expect: {text: 'Shield draft'}}, {unchanged: ['todos']}, {screenshot: 'result'}, {click: 'Cancel'}
  ]],
  ['Valyrian Overlay trapFocus keeps sequential focus inside overlay and blocks direct focusAt on covered background', [
    {remember: ['todos']}, {locate: {text: 'Capture task', as: 'covered-task'}},
    {click: 'Add task'}, {type: 'Trapped draft'},
    {traverseModal: {cycles: 2, direction: 'forward', forbidBackground: true}},
    {traverseModal: {cycles: 2, direction: 'backward', forbidBackground: true}},
    {clickRemembered: 'covered-task'}, {expect: {text: 'Trapped draft'}},
    {unchanged: ['todos']}, {screenshot: 'result'}, {click: 'Cancel'},
    {click: 'Add task'}, {type: 'Modal remains usable'}, {click: 'Save'},
    {data: {domain: 'todos', title: 'Modal remains usable', count: 1}}
  ]],
  ['Valyrian Overlay modal shield blocks empty-area click-through while preserving modal controls', [
    {remember: ['todos']}, {locate: {text: 'Capture task', as: 'covered-task'}},
    {click: 'Add task'}, {type: 'Modal control works'}, {clickRemembered: 'covered-task'},
    {unchanged: ['todos']}, {screenshot: 'result'}, {click: 'Save'},
    {data: {domain: 'todos', title: 'Modal control works', count: 1}},
    {data: {domain: 'todos', title: 'Capture task', done: false}}
  ]]
] as const;

for (const [name, steps] of cases) {
  test(name, async context => {
    const result = await captureIluScenario({testName: context.name, scenario: 'tuiInteraction', command: captureCommand, viewport: {cols: 80, rows: 24}, input: {steps, finish: 'normal-exit'}});
    assert.equal(result.exitCode, 0);
    assertCaptureArtifacts({result, testName: context.name, checkpoints: ['result'], diagnostic: message => context.diagnostic(message)});
  });
}
