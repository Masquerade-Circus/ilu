const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

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

function withTempHome(run) {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-home-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tempHome;

  return Promise.resolve()
    .then(() => run(tempHome))
    .finally(() => {
      process.env.HOME = originalHome;
      fs.rmSync(tempHome, {recursive: true, force: true});
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
    assert.equal(/\.sync\//.test(tracked), false);
  });

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
  });

  remote.cleanup();
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
  });

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
  });

  remote.cleanup();
});
