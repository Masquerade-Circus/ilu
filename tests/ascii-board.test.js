const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const renderBoard = require(path.join(repoRoot, 'scrumban', 'ascii-board.js'));

test('ascii board renderer prints headers, wip limits and aligned card rows', () => {
  const output = renderBoard({
    title: 'Product',
    columns: [
      {title: 'Backlog', wipLimit: null, cards: [{title: 'Spec API', position: 1}]},
      {title: 'Ready', wipLimit: 2, cards: [{title: 'Review copy', position: 1}]},
      {title: 'Done', wipLimit: null, cards: []}
    ]
  });

  assert.match(output, /Backlog/);
  assert.match(output, /Ready \(1\/2\)/);
  assert.match(output, /Done/);
  assert.match(output, /1 Spec API/);
  assert.match(output, /1 Review copy/);
  assert.ok(output.includes('|'));
});

test('ascii board renderer shows current card count alongside the WIP limit', () => {
  const output = renderBoard({
    title: 'Product',
    columns: [
      {title: 'Ready', wipLimit: 3, cards: [{title: 'Review copy', position: 1}]}
    ]
  });

  assert.match(output, /Ready \(1\/3\)/);
});
