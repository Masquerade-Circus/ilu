const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const repoRoot = path.resolve(__dirname, '..');
const backendModulePath = path.join(repoRoot, 'sync', 'git-cli-backend.js');

function loadBackendWithExecStub(execStub) {
  const originalLoad = Module._load;

  delete require.cache[require.resolve(backendModulePath)];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'node:child_process') {
      return {execFileSync: execStub};
    }

    return originalLoad.apply(this, arguments);
  };

  try {
    return require(backendModulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(backendModulePath)];
  }
}

test('git backend classifies common git failures', () => {
  const backend = loadBackendWithExecStub(() => '');

  assert.equal(backend.classifyGitError(new Error('Could not resolve host github.com')).kind, 'network');
  assert.equal(backend.classifyGitError(new Error('Authentication failed')).kind, 'auth');
  assert.equal(backend.classifyGitError(new Error('CONFLICT (content): Merge conflict in notes.json')).kind, 'conflict');
  assert.equal(backend.classifyGitError(new Error('fatal: not a git repository')).kind, 'config');
});

test('git backend ensures only sync config is ignored in synced repo', () => {
  const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-ignore-'));
  const backend = loadBackendWithExecStub(() => '');

  try {
    backend.createGitCliBackend({repoPath: tempRepo}).ensureReady();
    const gitignore = fs.readFileSync(path.join(tempRepo, '.gitignore'), 'utf8');

    assert.match(gitignore, /^\.config\/$/m);
    assert.doesNotMatch(gitignore, /^note\.txt$/m);
    assert.doesNotMatch(gitignore, /^\.sync\/$/m);
  } finally {
    fs.rmSync(tempRepo, {recursive: true, force: true});
  }
});
