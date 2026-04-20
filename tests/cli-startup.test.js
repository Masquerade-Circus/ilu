const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function runHelp(entrypoint) {
  return spawnSync(process.execPath, [entrypoint, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function runCli(entrypoint, ...args) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

test('node bin/cli.js --help arranca correctamente', () => {
  const result = runHelp(path.join(repoRoot, 'bin/cli.js'));

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Cli tools for productivity/);
});

test('node bin/cli.js --version imprime la versión del paquete', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), '--version');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), '1.0.4');
});

test('node bin/cli.js todo --help muestra ayuda del subcomando', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), 'todo', '--help');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Manage Todo tasks for the current active list/);
  assert.match(`${result.stdout}${result.stderr}`, /-a, --add/);
});

test('node bin/cli.js clock --help muestra ayuda del subcomando', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), 'clock', '--help');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Manage saved clocks/i);
  assert.match(`${result.stdout}${result.stderr}`, /-a, --add/);
  assert.match(`${result.stdout}${result.stderr}`, /-r, --remove/);
});
