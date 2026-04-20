const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {spawnSync} = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const flowRunnerPath = path.join(repoRoot, 'tests', 'test-helpers', 'run-functional-flow.js');

function runFlow(flowName) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), `ilu-functional-${flowName}-`));

  try {
    const result = spawnSync(process.execPath, [flowRunnerPath, flowName], {
      cwd: repoRoot,
      env: {...process.env, HOME: tempHome},
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);

    return {
      tempHome,
      payload: JSON.parse(result.stdout)
    };
  } finally {
    fs.rmSync(tempHome, {recursive: true, force: true});
  }
}

test('flujo funcional base de todo agrega lista y tarea en HOME temporal', () => {
  const {tempHome, payload: result} = runFlow('todo');

  assert.equal(result.storageDir, path.join(tempHome, '.ilu'));
  assert.equal(result.dbFile, path.join(tempHome, '.ilu', 'todos.json'));
  assert.equal(result.dbFileExists, true);
  assert.deepEqual(result.currentList.tasks.map(task => task.title), ['Comprar pan']);
  assert.match(result.output, /1 Comprar pan/);
});

test('flujo funcional base de note agrega lista y nota en HOME temporal', () => {
  const {tempHome, payload: result} = runFlow('note');

  assert.equal(result.storageDir, path.join(tempHome, '.ilu'));
  assert.equal(result.dbFile, path.join(tempHome, '.ilu', 'notes.json'));
  assert.equal(result.dbFileExists, true);
  assert.deepEqual(result.currentList.notes.map(note => note.title), ['Idea rápida']);
  assert.equal(result.currentList.notes[0].content, 'Texto funcional');
  assert.match(result.output, /1 Idea rápida/);
});

test('flujo funcional base de clock agrega, muestra y elimina relojes en HOME temporal', () => {
  const {tempHome, payload: result} = runFlow('clock');

  assert.equal(result.storageDir, path.join(tempHome, '.ilu'));
  assert.equal(result.dbFile, path.join(tempHome, '.ilu', 'clocks.json'));
  assert.equal(result.dbFileExists, true);
  assert.deepEqual(
    result.savedClocksBeforeRemoveAll.map(clock => ({name: clock.name, timezone: clock.timezone})),
    [{name: 'CDMX', timezone: 'America/Mexico_City'}]
  );
  assert.deepEqual(result.savedClocksAfterRemoveAll, []);
  assert.deepEqual(result.removeSelection, [1]);
  assert.match(result.output, /CDMX/);
  assert.match(result.output, /America\/Mexico_City/);
  assert.match(result.output, /1 clock has been removed/i);
});
