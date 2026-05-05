const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..', '..');
const backendModulePath = path.join(repoRoot, 'sync', 'git-cli-backend.js');
const coreBackendModulePath = path.join(repoRoot, 'sync-core', 'backends', 'git-cli.js');
const coreContractsModulePath = path.join(repoRoot, 'sync-core', 'contracts.js');

function loadModuleWithExecStub(modulePath, execStub) {
  const originalLoad = Module._load;

  try {
    delete require.cache[require.resolve(modulePath)];
  } catch (error) {
    // ignore cache misses before first require
  }

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'node:child_process') {
      return {execFileSync: execStub};
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch (error) {
      // ignore cache misses after failed require
    }
  }
}

function loadBackendWithExecStub(execStub) {
  return loadModuleWithExecStub(backendModulePath, execStub);
}

function loadCoreBackendWithExecStub(execStub) {
  return loadModuleWithExecStub(coreBackendModulePath, execStub);
}

test('git backend classifies common git failures', () => {
  const backend = loadBackendWithExecStub(() => '');

  assert.equal(backend.classifyGitError(new Error('Could not resolve host github.com')).kind, 'network');
  assert.equal(backend.classifyGitError(new Error('Authentication failed')).kind, 'auth');
  assert.equal(backend.classifyGitError(new Error('CONFLICT (content): Merge conflict in notes.json')).kind, 'conflict');
  assert.equal(backend.classifyGitError(new Error('fatal: not a git repository')).kind, 'config');
});

test('sync core exports generic git error classification without depending on sync wrapper', () => {
  delete require.cache[require.resolve(coreContractsModulePath)];
  const {classifyGitError} = require(coreContractsModulePath);

  assert.equal(classifyGitError(new Error('Could not resolve host github.com')).kind, 'network');
  assert.equal(classifyGitError(new Error('Authentication failed')).kind, 'auth');
  assert.equal(classifyGitError(new Error('CONFLICT (content): Merge conflict in notes.json')).kind, 'conflict');
  assert.equal(classifyGitError(new Error('fatal: not a git repository')).kind, 'config');
});

test('core git backend applies ignorePatterns without consumer compatibility aliases', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-ignore-'));
  const backend = loadCoreBackendWithExecStub(() => '');

  try {
    backend.createGitCliBackend({repoPath: tempRepo, ignorePatterns: ['.sync/', 'note.txt']}).ensureReady();
    const gitignore = fs.readFileSync(path.join(tempRepo, '.gitignore'), 'utf8');

    assert.match(gitignore, /^\.sync\/$/m);
    assert.match(gitignore, /^note\.txt$/m);
    assert.doesNotMatch(gitignore, /^\.config\/$/m);
  } finally {
    fs.rmSync(tempRepo, {recursive: true, force: true});
  }
});


test('core git backend syncs the source root while excluding ignored patterns', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-root-'));
  const sourceRoot = path.join(tempRoot, 'source');
  const repoPath = path.join(tempRoot, 'repo');
  const backend = loadCoreBackendWithExecStub(() => '');

  fs.mkdirSync(path.join(sourceRoot, '.config'), {recursive: true});
  fs.writeFileSync(path.join(sourceRoot, 'todos.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, '.config', 'sync-config.json'), '{}', 'utf8');

  try {
    backend.createGitCliBackend({repoPath}).syncWorkingTree({
      sourceRoot,
      ignorePatterns: ['.config/**']
    });

    assert.equal(fs.existsSync(path.join(repoPath, 'todos.json')), true);
    assert.equal(fs.existsSync(path.join(repoPath, '.config', 'sync-config.json')), false);
  } finally {
    fs.rmSync(tempRoot, {recursive: true, force: true});
  }
});

test('core git backend also applies constructor ignorePatterns during syncWorkingTree', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-root-'));
  const sourceRoot = path.join(tempRoot, 'source');
  const repoPath = path.join(tempRoot, 'repo');
  const backend = loadCoreBackendWithExecStub(() => '');

  fs.mkdirSync(path.join(sourceRoot, '.config'), {recursive: true});
  fs.writeFileSync(path.join(sourceRoot, 'todos.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(sourceRoot, '.config', 'sync-state.json'), '{}', 'utf8');

  try {
    backend.createGitCliBackend({
      repoPath,
      ignorePatterns: ['.config/sync-state.json']
    }).syncWorkingTree({sourceRoot});

    assert.equal(fs.existsSync(path.join(repoPath, 'todos.json')), true);
    assert.equal(fs.existsSync(path.join(repoPath, '.config', 'sync-state.json')), false);
  } finally {
    fs.rmSync(tempRoot, {recursive: true, force: true});
  }
});

test('core git backend removes stale non-ignored files from repo snapshot', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-root-'));
  const sourceRoot = path.join(tempRoot, 'source');
  const repoPath = path.join(tempRoot, 'repo');
  const backend = loadCoreBackendWithExecStub(() => '');

  fs.mkdirSync(sourceRoot, {recursive: true});
  fs.mkdirSync(repoPath, {recursive: true});
  fs.writeFileSync(path.join(repoPath, 'stale.json'), '{}', 'utf8');

  try {
    backend.createGitCliBackend({repoPath}).syncWorkingTree({sourceRoot, ignorePatterns: ['.config/**']});
    assert.equal(fs.existsSync(path.join(repoPath, 'stale.json')), false);
  } finally {
    fs.rmSync(tempRoot, {recursive: true, force: true});
  }
});

test('core git backend preserves stale ignored files from repo snapshot', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-root-'));
  const sourceRoot = path.join(tempRoot, 'source');
  const repoPath = path.join(tempRoot, 'repo');
  const backend = loadCoreBackendWithExecStub(() => '');

  fs.mkdirSync(sourceRoot, {recursive: true});
  fs.mkdirSync(path.join(repoPath, '.config'), {recursive: true});
  fs.writeFileSync(path.join(repoPath, '.config', 'sync-state.json'), '{}', 'utf8');

  try {
    backend.createGitCliBackend({repoPath}).syncWorkingTree({sourceRoot, ignorePatterns: ['.config/**']});
    assert.equal(fs.existsSync(path.join(repoPath, '.config', 'sync-state.json')), true);
  } finally {
    fs.rmSync(tempRoot, {recursive: true, force: true});
  }
});

test('core git backend inspectBootstrap detects local data from folder snapshot while honoring ignore patterns', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-root-'));
  const sourceRoot = path.join(tempRoot, 'source');
  const repoPath = path.join(tempRoot, 'repo');
  const backend = loadCoreBackendWithExecStub(() => '');

  fs.mkdirSync(path.join(sourceRoot, '.config'), {recursive: true});
  fs.writeFileSync(path.join(sourceRoot, '.config', 'sync-config.json'), '{}', 'utf8');

  try {
    let ignoredOnly = backend.createGitCliBackend({repoPath, remoteUrl: 'origin'}).inspectBootstrap({
      sourceRoot,
      ignorePatterns: ['.config/**']
    });

    fs.writeFileSync(path.join(sourceRoot, 'notes.json'), '[]', 'utf8');

    let withData = backend.createGitCliBackend({repoPath, remoteUrl: 'origin'}).inspectBootstrap({
      sourceRoot,
      ignorePatterns: ['.config/**']
    });

    assert.equal(ignoredOnly.localHasData, false);
    assert.equal(withData.localHasData, true);
  } finally {
    fs.rmSync(tempRoot, {recursive: true, force: true});
  }
});

test('core git backend syncWorkingTree is safe when sourceRoot equals repoPath', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-root-'));
  const backend = loadCoreBackendWithExecStub(() => '');

  fs.writeFileSync(path.join(tempRoot, 'todos.json'), '[]', 'utf8');
  fs.mkdirSync(path.join(tempRoot, '.config'), {recursive: true});
  fs.writeFileSync(path.join(tempRoot, '.config', 'sync-state.json'), '{}', 'utf8');

  try {
    backend.createGitCliBackend({repoPath: tempRoot}).syncWorkingTree({
      sourceRoot: tempRoot,
      ignorePatterns: ['.config/**']
    });

    assert.equal(fs.existsSync(path.join(tempRoot, 'todos.json')), true);
    assert.equal(fs.existsSync(path.join(tempRoot, '.config', 'sync-state.json')), true);
  } finally {
    fs.rmSync(tempRoot, {recursive: true, force: true});
  }
});

test('sync wrapper preserves current default ignore entry for ilu consumer', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-ignore-'));
  const backend = loadBackendWithExecStub(() => '');

  try {
    backend.createGitCliBackend({repoPath: tempRepo}).ensureReady();
    const gitignore = fs.readFileSync(path.join(tempRepo, '.gitignore'), 'utf8');

    assert.match(gitignore, /^\.config\/\*\*$/m);
    assert.doesNotMatch(gitignore, /^note\.txt$/m);
    assert.doesNotMatch(gitignore, /^\.sync\/$/m);
  } finally {
    fs.rmSync(tempRepo, {recursive: true, force: true});
  }
});

test('sync wrapper merges default .config/ ignore with extra ignorePatterns from consumer', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-ignore-'));
  const backend = loadBackendWithExecStub(() => '');

  try {
    backend.createGitCliBackend({repoPath: tempRepo, ignorePatterns: ['.sync/', 'note.txt']}).ensureReady();
    const gitignore = fs.readFileSync(path.join(tempRepo, '.gitignore'), 'utf8');

    assert.match(gitignore, /^\.config\/\*\*$/m);
    assert.match(gitignore, /^\.sync\/\*\*$/m);
    assert.match(gitignore, /^note\.txt$/m);
  } finally {
    fs.rmSync(tempRepo, {recursive: true, force: true});
  }
});

test('sync wrapper ignores legacy ignoredEntries compatibility input', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-ignore-'));
  const backend = loadBackendWithExecStub(() => '');

  try {
    backend.createGitCliBackend({repoPath: tempRepo, ignoredEntries: ['.sync/', 'note.txt']}).ensureReady();
    const gitignore = fs.readFileSync(path.join(tempRepo, '.gitignore'), 'utf8');

    assert.match(gitignore, /^\.config\/\*\*$/m);
    assert.doesNotMatch(gitignore, /^\.sync\/\*\*$/m);
    assert.doesNotMatch(gitignore, /^note\.txt$/m);
  } finally {
    fs.rmSync(tempRepo, {recursive: true, force: true});
  }
});

test('sync wrapper normalizes directory ignore patterns before delegating to core', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-ignore-'));
  const backend = loadBackendWithExecStub(() => '');

  try {
    backend.createGitCliBackend({repoPath: tempRepo, ignorePatterns: ['.cache/']}).ensureReady();
    const gitignore = fs.readFileSync(path.join(tempRepo, '.gitignore'), 'utf8');

    assert.match(gitignore, /^\.config\/\*\*$/m);
    assert.match(gitignore, /^\.cache\/\*\*$/m);
    assert.doesNotMatch(gitignore, /^\.cache\/$/m);
  } finally {
    fs.rmSync(tempRepo, {recursive: true, force: true});
  }
});
