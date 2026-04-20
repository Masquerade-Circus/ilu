const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {spawnSync} = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

test('node index.js tl --add falla limpio cuando recibe stdin por pipe', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-non-tty-'));

  try {
    const result = spawnSync(process.execPath, ['index.js', 'tl', '--add'], {
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

test('node index.js c --remove falla limpio cuando recibe stdin por pipe', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-non-tty-clock-remove-'));

  try {
    fs.mkdirSync(path.join(tempHome, '.ilu'), {recursive: true});
    fs.writeFileSync(
      path.join(tempHome, '.ilu', 'clocks.json'),
      JSON.stringify([{name: 'CDMX', timezone: 'America/Mexico_City'}], null, 2),
      'utf8'
    );

    const result = spawnSync(process.execPath, ['index.js', 'c', '--remove'], {
      cwd: repoRoot,
      env: {...process.env, HOME: tempHome},
      input: ' \\n',
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
