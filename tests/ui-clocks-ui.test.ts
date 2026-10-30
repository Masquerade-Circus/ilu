import test from 'node:test';
import assert from 'node:assert/strict';
import {captureIluScenario} from './test-helpers/terminal-capture.ts';
import {captureCommand, assertCaptureArtifacts} from './test-helpers/terminal-capture-scenarios.ts';

const clocks = [{name: 'UTC', timezone: 'Etc/UTC'}, {name: 'Mexico City', timezone: 'America/Mexico_City'}];
// Seed is real private JSON storage, never a substituted read snapshot. A
// storage failure uses filesystem permissions or a real revision conflict.
const cases = [
  ['Clocks UI exposes approved empty state and direct action bar controls', [], [
    {expect: {empty: true, sameRow: ['Add clock', 'Move up', 'Move down', 'Remove'], absent: ['adapter', 'snapshot', 'runtime', 'Reorder clocks']}}, {screenshot: 'result'}
  ]],
  ['Clocks tall terminal shows more clocks while preserving management controls', Array.from({length: 30}, (_, index) => ({name: `Clock-${index + 1}-end`, timezone: 'Etc/UTC'})), [
    {rememberVisibleCount: {pattern: 'Clock-\\d+-end.*Etc/UTC', as: 'short'}}, {resize: {cols: 100, rows: 40}},
    {expect: {moreVisibleThan: {name: 'short', pattern: 'Clock-\\d+-end.*Etc/UTC'}}},
    {click: 'Add clock'}, {expect: {text: 'Cancel'}}, {click: 'Cancel'}, {screenshot: 'result'}
  ]],
  ['Clocks concurrent TUI writers preserve every accepted addition in legacy JSON storage', [{name: 'Legacy clock', timezone: 'Etc/UTC'}], [
    {concurrentClockAdds: {sessions: 4, rounds: 8, nameTemplate: 'Writer {session} round {round}', timezone: 'Etc/UTC', synchronizeBeforeSave: true, assertEveryRound: {legacyArray: true, equalsAcceptedWrites: true, rejectedWritesShowError: true}, requireProgress: true, closeNormally: true}},
    {expect: {text: 'Legacy clock'}}, {screenshot: 'result'}
  ]],
  ['Clocks UI shows names and timezones in the page and names with seconds in the footer', clocks, [
    {expect: {texts: ['UTC', 'Etc/UTC', 'Mexico City', 'America/Mexico_City'], footerClockSeconds: ['UTC', 'Mexico City'], footerAbsent: ['Etc/UTC', 'America/Mexico_City']}}, {screenshot: 'result'}
  ]],
  ['Clocks footer keeps 80-column layout when clock names and seconds do not fit', ['One', 'Two', 'Three', 'Four'].map((word, index) => ({name: `Extremely Long Clock Name ${word}`, timezone: ['Etc/UTC', 'America/Mexico_City', 'Europe/Madrid', 'Asia/Tokyo'][index]})), [
    {expect: {withinViewport: true, footerActionsVisible: true}}, {screenshot: 'result'}
  ]],
  ['Clocks footer renders deterministic ANSI colors per visible clock', clocks, [
    {expect: {footerColors: {UTC: '#f87171', 'Mexico City': '#60a5fa'}}},
    {resize: {cols: 100, rows: 30}}, {resize: {cols: 80, rows: 24}},
    {expect: {footerColors: {UTC: '#f87171', 'Mexico City': '#60a5fa'}}}, {screenshot: 'result'}
  ]],
  ['Clocks footer refreshes automatically each second and stops after destroy', clocks, [
    {rememberFooter: 'before-tick'}, {waitForClockTick: {name: 'UTC', timeoutMs: 2500}},
    {expect: {footerChangedSince: 'before-tick'}}, {screenshot: 'result'},
    {exitNormally: true}, {expectNoOutputAfterExit: {durationMs: 1200}}
  ]],
  ['Clocks add workflow exposes required name and timezone search copy before save', clocks, [
    {remember: ['clocks']}, {click: 'Add clock'}, {click: 'Add clock', area: 'overlay', occurrence: -1},
    {expect: {texts: ['Clock name', 'Time zone', 'Search time zones'], invalid: true}}, {unchanged: ['clocks']}, {screenshot: 'result'}, {click: 'Cancel'}
  ]],
  ['Clocks add workflow requires a selected timezone before calling the action', clocks, [
    {remember: ['clocks']}, {click: 'Add clock'}, {type: 'Local'}, {click: 'Add clock', area: 'overlay', occurrence: -1},
    {expect: {invalid: true, text: 'Time zone'}}, {unchanged: ['clocks']}, {screenshot: 'result'}, {click: 'Cancel'}
  ]],
  ['Clocks list press opens clock details with per-clock actions', clocks, [
    {click: 'UTC', area: 'content'}, {key: 'ENTER'}, {expect: {texts: ['Clock details', 'Etc/UTC', 'Move up', 'Move down', 'Remove', 'Close']}}, {screenshot: 'result'}, {key: 'ESCAPE'}
  ]],
  ['Clocks remove overlay pins destructive action and cancel to the overlay bottom', clocks, [
    {click: 'Remove', area: 'actions'}, {expect: {overlayBottomActions: ['Remove clock', 'Cancel'], withinViewport: true}}, {screenshot: 'result'}, {click: 'Cancel'}
  ]],
  ['Clocks remove workflow requires explicit visible confirmation for the selected clock', clocks, [
    {remember: ['clocks']}, {click: 'Remove', area: 'actions'}, {expect: {text: 'UTC'}}, {unchanged: ['clocks']},
    {screenshot: 'result'}, {click: 'Remove clock'}, {data: {domain: 'clocks', names: ['Mexico City'], exactOrder: true}}
  ]],
  ['Clocks priority workflow moves the selected clock through direct action bar controls', clocks, [
    {click: 'Move down', area: 'actions'}, {data: {domain: 'clocks', names: ['Mexico City', 'UTC'], exactOrder: true}}, {screenshot: 'result'}
  ]],
  ['Clocks overlay closes visually when switching away from Clocks by keyboard shortcut', clocks, [
    {remember: ['clocks']}, {click: 'Add clock'}, {expect: {text: 'Clock name'}}, {key: 'CTRL_1'},
    {expect: {text: 'Capture task', absent: ['Clock name', 'Search time zones']}}, {unchanged: ['clocks']}, {screenshot: 'result'}
  ]],
  ['Clocks remove workflow shows safe errors without closing the confirmation', clocks, [
    {remember: ['clocks']}, {click: 'Remove', area: 'actions'}, {storageFault: {domain: 'clocks', kind: 'deny-write'}},
    {click: 'Remove clock'}, {expect: {text: 'UTC', error: true, absent: ['stack', 'CANARY_SECRET']}},
    {unchanged: ['clocks']}, {screenshot: 'result'}, {storageFault: {domain: 'clocks', kind: 'restore'}}, {click: 'Cancel'}
  ]],
  ['Clocks add and remove overlays use the full overlay surface without inset margins', clocks, [
    {click: 'Add clock'}, {expect: {overlayFullSurface: true, withinViewport: true}}, {click: 'Cancel'},
    {click: 'Remove', area: 'actions'}, {expect: {overlayFullSurface: true, withinViewport: true}}, {screenshot: 'result'}, {click: 'Cancel'}
  ]],
  ['Clocks remove overlay wraps long clock names and time zones without truncation inside 80 columns', [{name: `Clock ${'A'.repeat(110)}`, timezone: `America/${'B'.repeat(110)}`}], [
    {click: 'Remove', area: 'actions'}, {expect: {wrappedComplete: [`Clock ${'A'.repeat(110)}`, `America/${'B'.repeat(110)}`], withinViewport: true}}, {screenshot: 'result'}, {click: 'Cancel'}
  ]],
  ['Clocks remove workflow normalizes stale selection after removing the selected last position', clocks, [
    {click: 'Mexico City', area: 'content'}, {key: 'ESCAPE'}, {click: 'Remove', area: 'actions'},
    {expect: {text: 'Mexico City'}}, {click: 'Remove clock'},
    {data: {domain: 'clocks', names: ['UTC'], exactOrder: true}}, {click: 'Remove', area: 'actions'},
    {expect: {text: 'UTC', absent: 'Choose a clock first'}}, {screenshot: 'result'}, {click: 'Cancel'}
  ]]
] as const;

for (const [name, seedClocks, steps] of cases) {
  test(name, async context => {
    const result = await captureIluScenario({testName: context.name, scenario: 'tuiInteraction', command: captureCommand, viewport: {cols: 80, rows: 24}, input: {seed: {clocks: seedClocks}, steps: [{key: 'CTRL_4'}, ...steps], finish: 'normal-exit'}});
    assert.equal(result.exitCode, 0);
    assertCaptureArtifacts({result, testName: context.name, checkpoints: ['result'], diagnostic: message => context.diagnostic(message)});
  });
}
