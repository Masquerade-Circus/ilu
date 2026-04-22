const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {withTempHome} = require('../support/home-sandbox');

const repoRoot = path.resolve(__dirname, '..');
const createTempGitRemote = require('./test-helpers/create-temp-git-remote');

function clearRuntimeCaches() {
  [
    path.join(repoRoot, 'sync', 'commands.js'),
    path.join(repoRoot, 'sync', 'index.js'),
    path.join(repoRoot, 'sync', 'engine.js'),
    path.join(repoRoot, 'sync', 'ilu-adapter.js'),
    path.join(repoRoot, 'sync', 'state-store.js'),
    path.join(repoRoot, 'sync', 'git-cli-backend.js'),
    path.join(repoRoot, 'sync', 'machine.js'),
    path.join(repoRoot, 'utils', 'local-paths.js'),
    path.join(repoRoot, 'utils', 'load-db.js'),
    path.join(repoRoot, 'utils', 'create-list-model.js'),
    path.join(repoRoot, 'todos', 'model.js')
  ].forEach(modulePath => {
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch (error) {
      // ignore cache misses
    }
  });
}

function loadFresh(modulePath) {
  clearRuntimeCaches();
  return require(modulePath);
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ilu test',
      GIT_AUTHOR_EMAIL: 'test@ilu.local',
      GIT_COMMITTER_NAME: 'ilu test',
      GIT_COMMITTER_EMAIL: 'test@ilu.local'
    },
    ...options
  }).trim();
}

function runCli(args, options = {}) {
  return require('node:child_process').spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options
  });
}

test('bootstrap local data to empty local bare remote', async () => {
  const remote = createTempGitRemote();

  await withTempHome(async tempHome => {
    const TodosModel = loadFresh(path.join(repoRoot, 'todos', 'model.js'));
    const SyncCommands = loadFresh(path.join(repoRoot, 'sync', 'commands.js'));
    const localPaths = loadFresh(path.join(repoRoot, 'utils', 'local-paths.js'));

    TodosModel.add({title: 'Inbox', description: ''});
    await SyncCommands.init([], {remote: remote.remotePath});

    const heads = git(['ls-remote', '--heads', remote.remotePath]);
    assert.match(heads, /main/);
    assert.equal(fs.existsSync(localPaths.syncConfigFilePath()), true);
    assert.equal(fs.existsSync(localPaths.syncStateFilePath()), true);
    assert.equal(fs.existsSync(path.join(tempHome, '.ilu', '.git')), true);
    const tracked = git(['-C', path.join(tempHome, '.ilu'), 'ls-files'], {cwd: repoRoot});
    assert.equal(/\.config\//.test(tracked), false);
  }, {prefix: 'ilu-sync-home-'});

  remote.cleanup();
});

test('bootstrap empty local storage from remote with history', async () => {
  const remote = createTempGitRemote({
    seedFiles: {
      'todos.json': JSON.stringify([{title: 'Seed', description: '', tasks: [], labels: [], current: true, index: 1}], null, 2)
    }
  });

  await withTempHome(async () => {
    const SyncCommands = loadFresh(path.join(repoRoot, 'sync', 'commands.js'));
    const localPaths = loadFresh(path.join(repoRoot, 'utils', 'local-paths.js'));

    await SyncCommands.init([], {remote: remote.remotePath});

    const todosFile = localPaths.dbFilePath('todos');
    assert.equal(fs.existsSync(todosFile), true);
    assert.match(fs.readFileSync(todosFile, 'utf8'), /Seed/);
  }, {prefix: 'ilu-sync-home-'});

  remote.cleanup();
});

test('cli sync init no deja bootstrap parcial cuando HOME inicia vacío y el remoto ya tiene historia', () => {
  const remote = createTempGitRemote({
    seedFiles: {
      'todos.json': JSON.stringify([{title: 'Seed', description: '', tasks: [], labels: [], current: true, index: 1}], null, 2),
      'notes.json': JSON.stringify([{title: 'Seed note', notes: [], labels: [], current: true, index: 1}], null, 2),
      'boards.json': JSON.stringify([{title: 'Seed board', description: '', current: true, index: 1, defaultColumnId: 'backlog', columns: [{id: 'backlog', title: 'Backlog', wipLimit: null, cards: [], index: 1}]}], null, 2),
      'clocks.json': JSON.stringify([{name: 'CDMX', timezone: 'America/Mexico_City'}], null, 2)
    }
  });

  return withTempHome(async tempHome => {
    const result = runCli(['bin/cli.js', 'sync', 'init', '--remote', remote.remotePath, '--branch', 'main'], {
      env: {...process.env, HOME: tempHome}
    });
    const iluRoot = path.join(tempHome, '.ilu');
    const localPaths = loadFresh(path.join(repoRoot, 'utils', 'local-paths.js'));

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(localPaths.dbFilePath('todos')), true);
    assert.equal(fs.existsSync(localPaths.dbFilePath('notes')), true);
    assert.equal(fs.existsSync(localPaths.dbFilePath('boards')), true);
    assert.equal(fs.existsSync(localPaths.dbFilePath('clocks')), true);
    assert.equal(fs.existsSync(localPaths.syncConfigFilePath()), true);
    assert.equal(fs.existsSync(localPaths.syncStateFilePath()), true);
    assert.match(fs.readFileSync(localPaths.dbFilePath('todos'), 'utf8'), /Seed/);
    assert.match(fs.readFileSync(localPaths.dbFilePath('notes'), 'utf8'), /Seed note/);
    assert.match(fs.readFileSync(localPaths.dbFilePath('boards'), 'utf8'), /Seed board/);
    assert.match(fs.readFileSync(localPaths.dbFilePath('clocks'), 'utf8'), /Mexico_City/);
    assert.equal(fs.existsSync(path.join(iluRoot, '.git')), true);
  }, {prefix: 'ilu-sync-home-'}).finally(() => {
    remote.cleanup();
  });
});

test('auto-sync after mutation pushes to local bare remote', async () => {
  const remote = createTempGitRemote();

  await withTempHome(async () => {
    const TodosModel = loadFresh(path.join(repoRoot, 'todos', 'model.js'));
    const SyncCommands = loadFresh(path.join(repoRoot, 'sync', 'commands.js'));

    await SyncCommands.init([], {remote: remote.remotePath});
    TodosModel.add({title: 'Inbox', description: ''});

    await new Promise(resolve => setTimeout(resolve, 250));
    const heads = git(['ls-remote', '--heads', remote.remotePath]);
    assert.match(heads, /main/);
  }, {prefix: 'ilu-sync-home-'});

  remote.cleanup();
});

test('remote unavailable does not remove local data', async () => {
  const remote = createTempGitRemote();

  await withTempHome(async () => {
    const TodosModel = loadFresh(path.join(repoRoot, 'todos', 'model.js'));
    const SyncCommands = loadFresh(path.join(repoRoot, 'sync', 'commands.js'));
    const localPaths = loadFresh(path.join(repoRoot, 'utils', 'local-paths.js'));
    const syncIndex = loadFresh(path.join(repoRoot, 'sync', 'index.js'));

    await SyncCommands.init([], {remote: remote.remotePath});
    fs.rmSync(remote.remotePath, {recursive: true, force: true});

    TodosModel.add({title: 'Inbox', description: ''});
    await new Promise(resolve => setTimeout(resolve, 250));

    assert.equal(fs.existsSync(localPaths.dbFilePath('todos')), true);
    assert.match(fs.readFileSync(localPaths.dbFilePath('todos'), 'utf8'), /Inbox/);
  }, {prefix: 'ilu-sync-home-'});

  remote.cleanup();
});
