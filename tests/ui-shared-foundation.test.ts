import test from 'node:test';
import assert from 'node:assert/strict';
import {captureIluScenario} from './test-helpers/terminal-capture.ts';
import {captureCommand, assertCaptureArtifacts} from './test-helpers/terminal-capture-scenarios.ts';

// Required driver semantics: all steps exercise the real captured CLI. Geometry
// and styles come from its current PTY, with PNG for inspection. External
// failures are injected only at an isolated provider boundary, fail closed.
const cases = [
  ['shared action-result helper rejects unsafe raw error details', [
    {provider: {kind: 'translation', response: {error: 'synthetic provider failure token=CANARY_SECRET at private-canary.ts'}}},
    {key: 'CTRL_6'}, {fill: {label: 'Text to translate', text: 'Safe text'}}, {click: 'Translate', area: 'actions'},
    {expect: {error: true, absent: ['CANARY_SECRET', 'private-canary.ts', 'stack']}},
    {provider: {kind: 'translation', response: {sentences: [{trans: 'Texto seguro'}]}}},
    {click: 'Translate', area: 'actions'}, {expect: {text: 'Texto seguro'}}, {screenshot: 'result'}
  ]],
  ['utility launcher actions are removed because utility apps live in top nav', [
    {expect: {sameRowOrdered: ['Todo', 'Notes', 'Board', 'Clocks', 'Translate', 'Speech', 'Sync'], absent: ['Tools', 'Choose a tool'], withinViewport: true}}, {screenshot: 'result'}
  ]],
  ['top nav leaves one visual row before the active panel', [
    {expect: {blankRowsAfter: {text: 'Todo', count: 1}, withinViewport: true}}, {screenshot: 'result'}
  ]],
  ['board action bar keeps board actions without utility launcher noise', [
    {key: 'CTRL_3'}, {expect: {sameRow: ['Add card', 'Add column'], absent: 'Tools', withinViewport: true}}, {screenshot: 'result'}
  ]],
  ['utility app surfaces use approved app wording without tool overlay copy', [
    {key: 'CTRL_5'}, {expect: {text: 'Set up sync'}}, {key: 'CTRL_6'}, {expect: {text: 'Text to translate'}},
    {key: 'CTRL_7'}, {expect: {text: 'Text to Speech', absent: ['Tools', 'Choose a tool']}}, {screenshot: 'result'}
  ]],
  ['utility secondary overlays close with Escape while Ctrl+C stays delegated to focused inputs', [
    {remember: ['sync-config']}, {key: 'CTRL_5'}, {click: 'Set up sync'}, {key: 'CTRL_C'},
    {expect: {text: 'Remote URL'}}, {screenshot: 'result'}, {key: 'ESCAPE'},
    {expect: {text: 'Retry sync', absent: 'Remote URL'}}, {unchanged: ['sync-config']}
  ]],
  ['Board, Todo details, and utility overlays fill the 80x24 surface without overdraw', [
    {key: 'CTRL_3'}, {click: 'Add card'}, {expect: {overlayMargin: 0.1, overlayFullSurface: true, withinViewport: true}},
    {key: 'ESCAPE'}, {key: 'CTRL_1'}, {click: 'Capture task'}, {key: 'o'},
    {expect: {overlayMargin: 0.1, overlayFullSurface: true, withinViewport: true}},
    {key: 'ESCAPE'}, {key: 'CTRL_5'}, {click: 'Set up sync'},
    {expect: {overlayMargin: 0.1, overlayFullSurface: true, withinViewport: true}}, {screenshot: 'result'}, {key: 'ESCAPE'}
  ]],
  ['Board overlays keep the base board panel mounted by default', [
    {key: 'CTRL_3'},
    {boardOverlayTour: {overlays: ['add-card', 'card-action-error', 'card-details', 'edit-card', 'move-card', 'priority-card', 'remove-card-confirm', 'column-details', 'add-column', 'rename-column', 'add-board', 'rename-board', 'remove-board-confirm', 'set-wip-limit', 'reset-columns-confirm'], openViaVisibleControls: true, expectUnderlyingBoard: true, cancelWithoutMutations: true}},
    {screenshot: 'result'}
  ]],
  ['Todo details overlay pins its action row to the internal bottom nav row', [
    {click: 'Capture task'}, {key: 'o'}, {expect: {overlayBottomActions: ['Edit task', 'Mark done', 'Remove task', 'Close'], withinViewport: true}}, {screenshot: 'result'}, {key: 'ESCAPE'}
  ]],
  ['Note details overlay pins its action row to the internal bottom nav row', [
    {key: 'CTRL_2'}, {click: 'Capture note'}, {key: 'ENTER'}, {expect: {overlayBottomActions: ['Edit note', 'Remove note', 'Close'], withinViewport: true}}, {screenshot: 'result'}, {key: 'ESCAPE'}
  ]],
  ['shared snapshot enrichment exposes list identities without calling mutators', [
    {remember: ['todos', 'notes', 'boards', 'clocks']},
    {expect: {text: 'Capture task'}}, {key: 'CTRL_2'}, {expect: {text: 'Capture note'}},
    {expect: {sameRow: ['Capture Notes', 'Archive Notes']}}, {key: 'CTRL_4'},
    {expect: {text: 'Etc/UTC'}}, {unchanged: ['todos', 'notes', 'boards', 'clocks']}, {screenshot: 'result'}
  ], {clocks: [{name: 'UTC', timezone: 'Etc/UTC'}]}],
  ['top nav exposes Translate and Speech as apps with Sync as a global control without Tools launcher copy', [
    {expect: {sameRowOrdered: ['Translate', 'Speech', 'Sync'], absent: ['Tools', 'Choose a tool']}},
    {click: 'Sync', area: 'nav'}, {expect: {text: 'Set up sync'}},
    {click: 'Translate', area: 'nav'}, {expect: {text: 'Text to translate'}},
    {click: 'Speech', area: 'nav'}, {expect: {text: 'Text to Speech'}}, {screenshot: 'result'}
  ]],
  ['Ctrl shortcuts can select the utility apps as top-level routes', [
    {key: 'CTRL_5'}, {expect: {text: 'Retry sync'}}, {key: 'CTRL_6'}, {expect: {text: 'Text to translate'}},
    {key: 'CTRL_7'}, {expect: {text: 'Text to Speech'}}, {screenshot: 'result'}
  ]],
  ['AppOverlay pins bottomNav to the internal bottom row with tall content', [
    {click: 'Capture task'}, {key: 'o'}, {expect: {overlayBottomActions: ['Edit task', 'Remove task', 'Close'], overlayFullSurface: true, withinViewport: true}},
    {scroll: {text: 'Row', direction: 'down', count: 30}},
    {expect: {overlayBottomActions: ['Edit task', 'Remove task', 'Close'], overlayFullSurface: true, withinViewport: true}}, {screenshot: 'result'}, {key: 'ESCAPE'}
  ]],
  ['shared overlay props keep the 10 percent margin contract and modal defaults', [
    {remember: ['todos']}, {locate: {text: 'Capture task', as: 'background'}}, {click: 'Add task'},
    {expect: {overlayMargin: 0.1, overlayFullSurface: true}}, {clickRemembered: 'background'},
    {traverseModal: {cycles: 2, direction: 'forward', forbidBackground: true}},
    {expect: {text: 'Task title'}}, {unchanged: ['todos']}, {screenshot: 'result'}, {click: 'Cancel'}
  ]],
  ['StateText applies semantic tone styles to ANSI output without depending on global text state lookup', [
    {key: 'CTRL_6'}, {expect: {semanticState: 'empty'}},
    {provider: {kind: 'translation', response: {deferred: 'translation'}}},
    {fill: {label: 'Text to translate', text: 'State text'}}, {click: 'Translate', area: 'actions'},
    {expect: {semanticState: 'loading'}}, {releaseProvider: {id: 'translation', error: 'Synthetic offline error'}},
    {expect: {semanticState: 'error'}}, {screenshot: 'result'}
  ]],
  ['utility app render paths do not start status or voice preparation side effects', [
    {remember: ['tts-config', 'sync-config']}, {key: 'CTRL_5'}, {resize: {cols: 100, rows: 30}},
    {resize: {cols: 80, rows: 24}}, {key: 'CTRL_7'}, {click: 'Choose voice'},
    {resize: {cols: 100, rows: 30}}, {resize: {cols: 80, rows: 24}},
    {expect: {text: 'Cancel'}}, {externalCalls: {translation: 0, speech: 0}},
    {unchanged: ['tts-config', 'sync-config']}, {screenshot: 'result'}, {key: 'ESCAPE'}
  ]]
] as const;

for (const [name, steps, seed] of cases) {
  test(name, async context => {
    const result = await captureIluScenario({testName: context.name, scenario: 'tuiInteraction', command: captureCommand, viewport: {cols: 80, rows: 24}, input: {seed: seed ?? {}, steps, externalIsolation: 'deny-unmatched', finish: 'normal-exit'}});
    assert.equal(result.exitCode, 0);
    assertCaptureArtifacts({result, testName: context.name, checkpoints: ['result'], diagnostic: message => context.diagnostic(message)});
  });
}
