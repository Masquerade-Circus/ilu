const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

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
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /--details \[position\]|--edit \[position\]|--remove \[position\]/);
  assert.match(`${result.stdout}${result.stderr}`, /--details\s+Show details/i);
  assert.match(`${result.stdout}${result.stderr}`, /--edit\s+Edit the selected task interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--remove\s+Remove selected tasks interactively/i);
});

test('node bin/cli.js note --help muestra contrato interactivo simplificado', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), 'note', '--help');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Manage Notes for the current active list/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /--details \[position\]|--edit \[position\]|--remove \[position\]/);
  assert.match(`${result.stdout}${result.stderr}`, /--details\s+Show details/i);
  assert.match(`${result.stdout}${result.stderr}`, /--edit\s+Edit the selected note interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--remove\s+Remove selected notes interactively/i);
});

test('node bin/cli.js todo-list --help muestra contrato interactivo simplificado', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), 'todo-list', '--help');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Manage Todo lists/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /--details <position>|--edit <position>|--use <position>|--remove \[position\]/);
  assert.match(`${result.stdout}${result.stderr}`, /--details\s+Show details of the selected list interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--edit\s+Edit the selected list interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--use\s+Use the selected list interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--remove\s+Remove selected lists interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--current\s+Show the details of the current list/i);
});

test('node bin/cli.js note-list --help muestra contrato interactivo simplificado', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), 'note-list', '--help');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Manage Note Lists/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /--details <position>|--edit <position>|--use <position>|--remove \[position\]/);
  assert.match(`${result.stdout}${result.stderr}`, /--details\s+Show details of the selected list interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--edit\s+Edit the selected list interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--use\s+Use the selected list interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--remove\s+Remove selected lists interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--current\s+Show the details of the current list/i);
});

test('node bin/cli.js board --help muestra ayuda base del recurso scrumban', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), 'board', '--help');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Manage cards for the current board/);
  assert.match(`${result.stdout}${result.stderr}`, /--show\s+Show the current board as an adaptive ASCII view/i);
  assert.match(`${result.stdout}${result.stderr}`, /--add\s+Add a new card to the default column/i);
  assert.match(`${result.stdout}${result.stderr}`, /--details\s+Show details of the selected card interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--edit\s+Edit the selected card interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--move\s+Move the selected card interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--priority\s+Reorder cards within a selected column\s+interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--remove\s+Remove selected cards interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--columns\s+Manage columns for the current board/i);
});

test('README documenta board v2 con columna default y columnas custom', () => {
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');

  assert.match(readme, /--add` — add a new card to the default column/i);
  assert.match(readme, /--priority` — reorder cards within a selected column with keyboard controls/i);
  assert.match(readme, /--columns` — manage columns for the current board, including the default column/i);
  assert.match(readme, /a new board can start with custom columns and a selected default column for new cards/i);
});

test('README alinea board-list --show con el contrato público actual', () => {
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');

  assert.match(readme, /--show` — show all boards/i);
  assert.doesNotMatch(readme, /--show` — show all boards and prompt for the next action/i);
});

test('node bin/cli.js board-list --help muestra ayuda base de boards', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), 'board-list', '--help');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Manage scrumban boards/i);
  assert.match(`${result.stdout}${result.stderr}`, /--show\s+Show all boards/i);
  assert.match(`${result.stdout}${result.stderr}`, /--add\s+Add new board/i);
  assert.match(`${result.stdout}${result.stderr}`, /--details\s+Show details of the selected board interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--edit\s+Edit the selected board interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--use\s+Use the selected board interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--current\s+Show the details of the current board/i);
  assert.match(`${result.stdout}${result.stderr}`, /--remove\s+Remove selected boards interactively/i);
});

test('node bin/cli.js clock --help muestra ayuda del subcomando', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), 'clock', '--help');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Manage saved clocks/i);
  assert.match(`${result.stdout}${result.stderr}`, /-a, --add/);
  assert.match(`${result.stdout}${result.stderr}`, /-r, --remove/);
});
