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
