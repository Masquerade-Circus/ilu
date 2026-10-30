import test from 'node:test';
import assert from 'node:assert/strict';
import {captureIluScenario} from './test-helpers/terminal-capture.ts';
import {captureCommand, assertCaptureArtifacts} from './test-helpers/terminal-capture-scenarios.ts';

// syncBoundary controls only the external Git transport, never syncActions,
// createTuiSyncClient or application state. Every remote is capture-owned. SSH
// acceptance uses a controlled transport, with unmatched network denied.
const cases = [
  ['terminal integration Sync LogView preserves readable ordered details with its default renderer', [
    {key: 'CTRL_5'},
    {expect: {orderedStatusDetails: ['status', 'pending-remote'], minimumVisibleDetails: 2, lastDetail: 'pending-remote', absent: '[object Object]'}},
    {screenshot: 'result'}
  ]],
  ['Sync app opens from top nav and shows detailed status', [
    {click: 'Sync', area: 'nav'}, {expect: {texts: ['Status:', 'Retry sync', 'Enable sync', 'Disable sync', 'Set up sync'], sameRowOrdered: ['Todo', 'Notes', 'Board', 'Clocks'], withinViewport: true}}, {screenshot: 'result'}
  ]],
  ['Sync app renders action controls in the bottom action area', [
    {key: 'CTRL_5'}, {expect: {pageBottomActions: ['Retry sync', 'Enable sync', 'Disable sync', 'Set up sync'], withinViewport: true}}, {screenshot: 'result'}
  ]],
  ['Sync retry updates visible status through the utility command path', [
    {key: 'CTRL_5'}, {click: 'Retry sync'}, {expect: {syncStatus: 'synced', absent: ['CANARY_SECRET', 'stack']}},
    {remoteData: {matchesLocal: true}}, {screenshot: 'result'}
  ]],
  ['Sync setup overlay pins setup actions to the overlay bottom', [
    {key: 'CTRL_5'}, {click: 'Set up sync'}, {expect: {overlayBottomActions: ['Confirm setup', 'Set up sync', 'Cancel'], withinViewport: true}}, {screenshot: 'result'}, {key: 'ESCAPE'}
  ]],
  ['Ctrl+C exits when Help is above Sync setup overlay', [
    {key: 'CTRL_5'}, {click: 'Set up sync'}, {key: 'CTRL_K'},
    {expect: {text: 'Sync help'}}, {screenshot: 'result'}, {key: 'CTRL_C'}, {expectExit: 0}
  ]],
  ['Sync init form requires explicit confirmation and keeps test remote under repo tmp', [
    {remember: ['sync-config']}, {key: 'CTRL_5'}, {click: 'Set up sync'}, {click: 'Set up sync', area: 'overlay'},
    {expect: {invalid: true}}, {unchanged: ['sync-config']},
    {fill: {label: 'Remote URL', valueFrom: 'privateRemote'}},
    {click: 'Set up sync', area: 'overlay'}, {expect: {invalid: true}}, {unchanged: ['sync-config']},
    {click: 'Confirm setup'}, {click: 'Set up sync', area: 'overlay'},
    {expect: {syncStatus: 'synced', absent: 'Remote URL'}},
    {data: {domain: 'sync-config', enabled: true, branch: 'main', remoteUnderPrivateWorkspace: true}}, {screenshot: 'result'}
  ], 'unconfigured'],
  ['Sync init blocks embedded credentials before calling the action', [
    {remember: ['sync-config']}, {key: 'CTRL_5'}, {click: 'Set up sync'},
    {fill: {label: 'Remote URL', text: 'https://user:CANARY_SECRET@example.test/repo.git'}},
    {click: 'Confirm setup'}, {click: 'Set up sync', area: 'overlay'},
    {expect: {invalid: true, absent: 'CANARY_SECRET'}}, {remoteOperations: {init: 0}},
    {unchanged: ['sync-config']}, {screenshot: 'result'}, {key: 'ESCAPE'}
  ], 'unconfigured'],
  ['Sync init blocks SSH password before calling the action', [
    {remember: ['sync-config']}, {key: 'CTRL_5'}, {click: 'Set up sync'},
    {fill: {label: 'Remote URL', text: 'ssh://git:CANARY_SECRET@example.test/repo.git'}},
    {click: 'Confirm setup'}, {click: 'Set up sync', area: 'overlay'},
    {expect: {invalid: true, absent: 'CANARY_SECRET'}}, {remoteOperations: {init: 0}},
    {unchanged: ['sync-config']}, {screenshot: 'result'}, {key: 'ESCAPE'}
  ], 'unconfigured'],
  ['Sync init form allows SSH remotes with a normal user', [
    {syncBoundary: {fixture: 'controlled-ssh-remote', denyOtherConnections: true}},
    {key: 'CTRL_5'}, {click: 'Set up sync'}, {fill: {label: 'Remote URL', text: 'ssh://git@example.test/repo.git'}},
    {click: 'Confirm setup'}, {click: 'Set up sync', area: 'overlay'},
    {expect: {syncStatus: 'synced', absent: 'Remote URL'}},
    {data: {domain: 'sync-config', remoteUrl: 'ssh://git@example.test/repo.git', branch: 'main', enabled: true}}, {screenshot: 'result'}
  ], 'unconfigured'],
  ['Esc keeps Sync app open when no secondary overlay is active', [
    {key: 'CTRL_5'}, {key: 'ESCAPE'}, {expect: {text: 'Retry sync'}}, {screenshot: 'result'}
  ]],
  ['Sync enable and disable update status through visible utility controls', [
    {key: 'CTRL_5'}, {click: 'Enable sync'}, {data: {domain: 'sync-config', enabled: true}},
    {click: 'Disable sync'}, {data: {domain: 'sync-config', enabled: false}},
    {expect: {syncStatus: 'off'}}, {screenshot: 'result'}
  ], 'disabled'],
  ['Sync utility prevents duplicate operation while a command is pending', [
    {syncBoundary: {defer: 'retry', as: 'retry'}}, {key: 'CTRL_5'}, {click: 'Retry sync'}, {click: 'Retry sync'},
    {remoteOperations: {retry: 1}}, {expect: {pending: true}}, {screenshot: 'result'},
    {releaseSyncBoundary: 'retry'}, {expect: {syncStatus: 'synced', pending: false}}, {remoteData: {matchesLocal: true}}
  ]],
  ['Sync retry can replace the initial status load when status is still pending', [
    {syncBoundary: {defer: 'initial-status', as: 'status', staleStatus: 'pending'}},
    {key: 'CTRL_5'}, {click: 'Retry sync'}, {expect: {syncStatus: 'synced'}},
    {releaseSyncBoundary: 'status'}, {expect: {syncStatus: 'synced', pending: false}}, {screenshot: 'result'}
  ]]
] as const;

for (const [name, steps, fixture] of cases) {
  test(name, async context => {
    const result = await captureIluScenario({testName: context.name, scenario: 'tuiInteraction', command: captureCommand, viewport: {cols: 80, rows: 24}, input: {startupSync: {fixture: fixture ?? 'local-pending-private-remote', autoPull: false}, steps, externalIsolation: 'deny-unmatched', finish: 'normal-exit'}});
    assert.equal(result.exitCode, 0);
    assertCaptureArtifacts({result, testName: context.name, checkpoints: ['result'], diagnostic: message => context.diagnostic(message)});
  });
}
