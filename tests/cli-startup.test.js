const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
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
  assert.match(`${result.stdout}${result.stderr}`, /--lists\s+Show all todo lists/i);
  assert.match(`${result.stdout}${result.stderr}`, /--use-list\s+Use the selected todo list interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--add-list\s+Add a new todo list/i);
  assert.match(`${result.stdout}${result.stderr}`, /--edit-list\s+Edit the selected todo list interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--remove-list\s+Remove selected todo lists interactively/i);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /--current\b/i);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /--details \[position\]|--edit \[position\]|--remove \[position\]/);
  assert.match(`${result.stdout}${result.stderr}`, /--details\s+Show details/i);
  assert.match(`${result.stdout}${result.stderr}`, /--edit\s+Edit the selected task interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--remove\s+Remove selected tasks interactively/i);
});

test('node bin/cli.js note --help muestra contrato interactivo simplificado', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), 'note', '--help');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Manage Notes and note lists for the current active list/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /--details \[position\]|--edit \[position\]|--remove \[position\]/);
  assert.match(`${result.stdout}${result.stderr}`, /--details\s+Show details/i);
  assert.match(`${result.stdout}${result.stderr}`, /--edit\s+Edit the selected note interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--remove\s+Remove selected notes interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--lists\s+Show all note lists/i);
  assert.match(`${result.stdout}${result.stderr}`, /--use-list\s+Use the selected note list interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--add-list\s+Add a new note list/i);
  assert.match(`${result.stdout}${result.stderr}`, /--edit-list\s+Edit the selected note list interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--remove-list\s+Remove selected note lists interactively/i);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /--current\b/i);
});

test('tests/cli-startup.test.js conserva solo un representante por familia de comandos removidos', () => {
  const source = fs.readFileSync(__filename, 'utf8');
  const count = (parts) => {
    const pattern = new RegExp(parts.join(''), 'g');
    return (source.match(pattern) || []).length;
  };

  assert.equal(count(['todo', '-list --show']), 1);
  assert.equal(count(['t', 'l --show']), 0);
  assert.equal(count(['note', '-list --show']), 1);
  assert.equal(count(['n', 'l --show']), 0);
  assert.equal(count(['board', '-list --show']), 1);
});

test('node bin/cli.js todo-list --show falla porque el comando ya no existe', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), 'todo-list', '--show');

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /unknown command ['"]todo-list['"]/i);
});

test('node bin/cli.js note-list --show falla porque el comando ya no existe', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), 'note-list', '--show');

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /unknown command ['"]note-list['"]/i);
});

test('node bin/cli.js board --help muestra ayuda base del recurso scrumban', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), 'board', '--help');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Manage the current board and board collection/i);
  assert.match(`${result.stdout}${result.stderr}`, /--show\s+Show the current board as an adaptive ASCII view/i);
  assert.match(`${result.stdout}${result.stderr}`, /--add\s+Add a new card to the default column/i);
  assert.match(`${result.stdout}${result.stderr}`, /--details\s+Show details of the selected card interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--edit\s+Edit the selected card interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--move\s+Move the selected card interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--priority\s+Reorder cards within a selected column\s+interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--remove\s+Remove selected cards interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /--columns\s+Manage columns for the current board/i);
  assert.match(`${result.stdout}${result.stderr}`, /-l,\s*--list-boards\s+Show all boards/i);
  assert.match(`${result.stdout}${result.stderr}`, /-u,\s*--use-board\s+Use the selected board interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /-ab,\s*--add-board\s+Add new board/i);
  assert.match(`${result.stdout}${result.stderr}`, /-eb,\s*--edit-board\s+Edit the selected board interactively/i);
  assert.match(`${result.stdout}${result.stderr}`, /-rb,\s*--remove-board\s+Remove selected boards interactively/i);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /--create-board\b/i);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /--current\b/i);
});

test('node bin/cli.js board-list --show falla porque el comando ya no existe', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), 'board-list', '--show');

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /unknown command ['"]board-list['"]/i);
});

test('node bin/cli.js clock --help muestra ayuda del subcomando', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), 'clock', '--help');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Manage saved clocks/i);
  assert.match(`${result.stdout}${result.stderr}`, /-a, --add/);
  assert.match(`${result.stdout}${result.stderr}`, /-r, --remove/);
});
