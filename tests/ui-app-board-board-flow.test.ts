import test from 'node:test';
import assert from 'node:assert/strict';
import {captureIluScenario} from './test-helpers/terminal-capture.ts';
import {captureCommand, assertCaptureArtifacts} from './test-helpers/terminal-capture-scenarios.ts';

const boards = [
  {id: 1, title: 'Launch board', description: 'Ship', current: true, columns: [{id: 'backlog', title: 'Backlog', isDefault: true, cards: []}, {id: 'doing', title: 'Doing', cards: [{title: 'Stale card', description: 'Details'}]}, {id: 'done', title: 'Done', cards: []}]},
  {id: 2, title: 'Ops board', description: 'Ops details', current: false, columns: [{id: 'inbox', title: 'Inbox', isDefault: true, cards: []}]}
];
const cases = [
  ['Board muestra selector compacto de boards y permite cambiar board sin usar flechas laterales', boards, [
    {expect: {sameRow: ['Launch board', 'Ops board']}}, {click: 'Ops board'}, {expect: {text: 'Inbox', absent: 'Stale card'}},
    {key: 'RIGHT'}, {data: {domain: 'boards', currentTitle: 'Ops board'}}, {screenshot: 'result'}
  ]],
  ['Board selector cambia board con id numerico real sin convertirlo a string', boards, [
    {click: 'Ops board'}, {data: {domain: 'boards', currentId: 2, currentTitle: 'Ops board'}}, {expect: {text: 'Inbox'}}, {screenshot: 'result'}
  ]],
  ['Board selector con muchos boards largos se mantiene dentro de 80 columnas', Array.from({length: 8}, (_, index) => ({id: index + 1, title: `Board con nombre extremadamente largo ${index + 1}`, current: index === 0, columns: [{title: 'Backlog', cards: []}]})), [
    {expect: {text: 'Board con nombre extremadamente largo 1', withinViewport: true}}, {screenshot: 'result'}
  ]],
  ['Board action bar exposes Add board and removes legacy board manager action', boards, [
    {expect: {sameRowOrdered: ['Add card', 'Add column', 'Reset to default layout', 'Add board'], absent: 'Tools'}},
    {click: 'Add board'}, {type: 'Initial board focus'}, {expect: {text: 'Initial board focus'}}, {screenshot: 'result'}, {click: 'Cancel'}
  ]],
  ['Board selector click changes board and double click opens board details', boards, [
    {click: 'Ops board'}, {expect: {text: 'Inbox', absent: 'Ops details'}},
    {doubleClick: 'Ops board'}, {expect: {texts: ['Ops details', 'Rename', 'Delete board', 'Close']}}, {screenshot: 'result'}, {key: 'ESCAPE'}
  ]],
  ['Board selector renders null-id boards without dispatching unsafe board actions', [{id: null, title: 'Imported board', current: true, columns: [{title: 'Backlog', cards: []}]}, boards[1]], [
    {remember: ['boards']}, {click: 'Imported board'}, {unchanged: ['boards']},
    {click: 'Ops board'}, {data: {domain: 'boards', currentId: 2}}, {expect: {text: 'Inbox'}}, {screenshot: 'result'}
  ]],
  ['Board current board CRUD changes reset stale card and column focus without board manager', boards, [
    {click: 'Stale card'}, {key: 'ENTER'}, {click: 'Add board'}, {type: 'Product board'}, {click: 'Save'},
    {data: {domain: 'boards', currentTitle: 'Product board'}},
    {key: 'o'}, {expect: {absent: 'Stale card'}}, {key: 'ESCAPE'},
    {click: 'Add card'}, {type: 'New-board card'}, {click: 'Save'},
    {data: {domain: 'boards', board: 'Product board', columnIndex: 1, card: 'New-board card'}},
    {doubleClick: 'Product board'}, {click: 'Delete board'}, {click: 'Delete board', area: 'overlay'},
    {data: {domain: 'boards', absentBoard: 'Product board'}},
    {expect: {absent: 'New-board card'}}, {screenshot: 'result'}
  ]],
  ['Board reset default columns is blocked with cards and confirmed on empty boards', boards, [
    {remember: ['boards']}, {click: 'Reset to default layout'}, {expect: {error: true}}, {unchanged: ['boards']}, {key: 'ESCAPE'},
    {click: 'Ops board'}, {click: 'Reset to default layout'}, {expect: {confirmation: true}},
    {data: {domain: 'boards', board: 'Ops board', columnTitles: ['Inbox']}},
    {click: 'Reset columns'}, {data: {domain: 'boards', board: 'Ops board', columnTitles: ['Backlog', 'Ready', 'In Progress', 'Done']}}, {screenshot: 'result'}
  ]],
  ['Board WIP limit validates invalid input before model calls and accepts zero as no limit', boards, [
    {remember: ['boards']}, {click: 'Backlog'}, {key: 'o'}, {click: 'WIP'},
    {fill: {label: 'WIP limit', text: '-1'}}, {click: 'Save'}, {expect: {invalid: true}}, {unchanged: ['boards']},
    {fill: {label: 'WIP limit', text: '0'}}, {click: 'Save'}, {data: {domain: 'boards', column: 'Backlog', noWipLimit: true}}, {screenshot: 'result'}
  ]],
  ['Board set default column and blocked remove use safe visible copy', boards, [
    {click: 'Doing'}, {key: 'o'}, {click: 'Default'}, {data: {domain: 'boards', defaultColumn: 'Doing'}},
    {remember: ['boards']}, {click: 'Doing'}, {key: 'o'}, {click: 'Remove column'}, {expect: {error: true}},
    {unchanged: ['boards']}, {screenshot: 'result'}, {key: 'ESCAPE'}
  ]],
  ['Board blocks removing an empty default column before model calls', boards, [
    {remember: ['boards']}, {click: 'Backlog'}, {key: 'o'}, {click: 'Remove column'},
    {expect: {error: true}}, {unchanged: ['boards']}, {screenshot: 'result'}, {key: 'ESCAPE'}
  ]],
  ['Board column header LEFT and RIGHT reorder columns and keep header focus', boards, [
    {click: 'Doing'}, {key: 'LEFT'}, {data: {domain: 'boards', columnTitles: ['Doing', 'Backlog', 'Done']}},
    {key: 'RIGHT'}, {data: {domain: 'boards', columnTitles: ['Backlog', 'Doing', 'Done']}},
    {key: 'o'}, {expect: {text: 'Doing', texts: ['Rename', 'WIP']}}, {screenshot: 'result'}, {key: 'ESCAPE'}
  ]]
] as const;

for (const [name, seedBoards, steps] of cases) {
  test(name, async context => {
    const result = await captureIluScenario({testName: context.name, scenario: 'tuiInteraction', command: captureCommand, viewport: {cols: 80, rows: 24}, input: {seed: {boards: seedBoards, preserveIds: true}, steps: [{key: 'CTRL_3'}, ...steps], finish: 'normal-exit'}});
    assert.equal(result.exitCode, 0);
    assertCaptureArtifacts({result, testName: context.name, checkpoints: ['result'], diagnostic: message => context.diagnostic(message)});
  });
}
