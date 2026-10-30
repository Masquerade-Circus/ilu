import test from 'node:test';
import assert from 'node:assert/strict';
import {captureIluScenario} from './test-helpers/terminal-capture.ts';
import {captureCommand, assertCaptureArtifacts} from './test-helpers/terminal-capture-scenarios.ts';

// tuiInteraction is a required physical-driver capability, not implemented by
// this author. fill targets a visible label. data inspects persisted business
// values in the capture HOME. No action adapter or binding table is replaced.
const cases = [
  ['Board delegates Editor Enter and List press keys to Valyrian defaults', [
    {remember: ['boards']}, {key: 'CTRL_3'}, {click: 'Long'}, {key: 'SPACE'}, {key: 'ENTER'},
    {expect: {absent: 'Edit card'}}, {unchanged: ['boards']},
    {key: 'o'}, {click: 'Edit', area: 'overlay'}, {fill: {label: 'Description', text: 'Alpha'}},
    {key: 'ENTER'}, {type: 'Beta'}, {expect: {separateRows: ['Alpha', 'Beta'], text: 'Cancel'}},
    {screenshot: 'result'}, {click: 'Cancel'}, {unchanged: ['boards']}
  ]],
  ['Board WIP overlay rejects non-numeric input before calling the action', [
    {remember: ['boards']}, {key: 'CTRL_3'}, {click: 'Backlog'}, {key: 'o'}, {click: 'WIP'},
    {fill: {label: 'WIP limit', text: 'abc'}}, {click: 'Save'},
    {expect: {invalid: true, text: 'Cancel'}}, {unchanged: ['boards']}, {screenshot: 'result'}, {click: 'Cancel'}
  ]],
  ['Board WIP overlay rejects empty Enter submit before calling the action', [
    {remember: ['boards']}, {key: 'CTRL_3'}, {click: 'Backlog'}, {key: 'o'}, {click: 'WIP'},
    {fill: {label: 'WIP limit', text: ''}}, {key: 'ENTER'},
    {expect: {invalid: true, text: 'Cancel'}}, {unchanged: ['boards']}, {screenshot: 'result'}, {click: 'Cancel'}
  ]],
  ['Board WIP overlay handles invalid Enter submit without throwing', [
    {remember: ['boards']}, {key: 'CTRL_3'}, {click: 'Backlog'}, {key: 'o'}, {click: 'WIP'},
    {fill: {label: 'WIP limit', text: 'abc'}}, {key: 'ENTER'},
    {expect: {invalid: true}}, {unchanged: ['boards']}, {screenshot: 'result'},
    {fill: {label: 'WIP limit', text: '2'}}, {click: 'Save'},
    {data: {domain: 'boards', column: 'Backlog', wipLimit: 2}}
  ]],
  ['Board WIP overlay submits finite NumberInput values with zero as no limit', [
    {key: 'CTRL_3'}, {click: 'Backlog'}, {key: 'o'}, {click: 'WIP'},
    {fill: {label: 'WIP limit', text: '0'}}, {click: 'Save'},
    {data: {domain: 'boards', column: 'Backlog', noWipLimit: true}}, {screenshot: 'result'}
  ]]
] as const;

for (const [name, steps] of cases) {
  test(name, async context => {
    const result = await captureIluScenario({testName: context.name, scenario: 'tuiInteraction', command: captureCommand, viewport: {cols: 80, rows: 24}, input: {steps, finish: 'normal-exit'}});
    assert.equal(result.exitCode, 0);
    assertCaptureArtifacts({result, testName: context.name, checkpoints: ['result'], diagnostic: message => context.diagnostic(message)});
  });
}
