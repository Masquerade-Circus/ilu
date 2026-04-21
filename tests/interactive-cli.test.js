const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {spawnSync} = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function writeCollectionDb(tempHome, filename, collectionName, entry) {
  fs.mkdirSync(path.join(tempHome, '.ilu'), {recursive: true});
  fs.writeFileSync(
    path.join(tempHome, '.ilu', filename),
    JSON.stringify({
      collections: {
        [collectionName]: {
          data: [entry],
          index: 1,
          createdAt: '2026-04-20T00:00:00.000Z',
          modifiedAt: '2026-04-20T00:00:00.000Z'
        }
      },
      createdAt: '2026-04-20T00:00:00.000Z',
      modifiedAt: '2026-04-20T00:00:00.000Z'
    }),
    'utf8'
  );
}

test('node index.js todo --add-list falla limpio cuando recibe stdin por pipe', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-non-tty-'));

  try {
    const result = spawnSync(process.execPath, ['index.js', 'todo', '--add-list'], {
      cwd: repoRoot,
      env: {...process.env, HOME: tempHome},
      input: 'Inbox\nPendientes\n',
      encoding: 'utf8'
    });

    const output = `${result.stdout}${result.stderr}`;

    assert.notEqual(result.status, 0);
    assert.match(output, /interactive terminal/i);
    assert.doesNotMatch(output, /ExitPromptError/);
  } finally {
    fs.rmSync(tempHome, {recursive: true, force: true});
  }
});

test('node index.js c --add falla limpio cuando recibe stdin por pipe', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-non-tty-clock-'));

  try {
    const result = spawnSync(process.execPath, ['index.js', 'c', '--add'], {
      cwd: repoRoot,
      env: {...process.env, HOME: tempHome},
      input: 'America/Mexico_City\nCDMX\n',
      encoding: 'utf8'
    });

    const output = `${result.stdout}${result.stderr}`;

    assert.notEqual(result.status, 0);
    assert.match(output, /interactive terminal/i);
    assert.doesNotMatch(output, /ExitPromptError/);
  } finally {
    fs.rmSync(tempHome, {recursive: true, force: true});
  }
});
