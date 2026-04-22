const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

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

function createTempGitRemote({seedFiles = null, branch = 'main'} = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ilu-sync-remote-'));
  const remotePath = path.join(tempRoot, 'remote.git');

  git(['init', '--bare', '--initial-branch', branch, remotePath]);

  if (seedFiles) {
    const worktree = path.join(tempRoot, 'seed');
    fs.mkdirSync(worktree, {recursive: true});
    git(['init', '--initial-branch', branch], {cwd: worktree});
    git(['remote', 'add', 'origin', remotePath], {cwd: worktree});

    Object.entries(seedFiles).forEach(([fileName, content]) => {
      fs.writeFileSync(path.join(worktree, fileName), content, 'utf8');
    });

    git(['add', '.'], {cwd: worktree});
    git(['commit', '-m', 'seed remote'], {cwd: worktree});
    git(['push', 'origin', branch], {cwd: worktree});
  }

  return {
    tempRoot,
    remotePath,
    cleanup() {
      fs.rmSync(tempRoot, {recursive: true, force: true});
    }
  };
}

module.exports = createTempGitRemote;
