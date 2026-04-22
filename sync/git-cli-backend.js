let fs = require('node:fs');
let path = require('node:path');
let {execFileSync} = require('node:child_process');

function classifyGitError(error) {
    let message = `${error && error.message ? error.message : error}`.toLowerCase();

    if (message.includes('resolve host') || message.includes('could not read from remote repository') || message.includes('connection timed out') || message.includes('network')) {
        return {kind: 'network', error};
    }

    if (message.includes('authentication failed') || message.includes('permission denied') || message.includes('could not authenticate')) {
        return {kind: 'auth', error};
    }

    if (message.includes('conflict') || message.includes('non-fast-forward')) {
        return {kind: 'conflict', error};
    }

    if (message.includes('not a git repository') || message.includes('unknown revision') || message.includes('no such remote')) {
        return {kind: 'config', error};
    }

    return {kind: 'unknown', error};
}

function createGitCliBackend({repoPath, branch = 'main', remote = 'origin', remoteUrl = null} = {}) {
    function ensureIgnoreFile() {
        let ignoreFile = path.join(repoPath, '.gitignore');
        let lines = [];

        if (fs.existsSync(ignoreFile)) {
            lines = fs.readFileSync(ignoreFile, 'utf8').split(/\r?\n/).filter(Boolean);
        }

        ['.config/'].forEach(entry => {
            if (!lines.includes(entry)) {
                lines.push(entry);
            }
        });

        fs.writeFileSync(ignoreFile, `${lines.join('\n')}\n`, 'utf8');
    }

    function run(args, options = {}) {
        let cwd = repoPath && fs.existsSync(repoPath) ? repoPath : process.cwd();

        return execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
                GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'ilu sync',
                GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'sync@ilu.local',
                GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'ilu sync',
                GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'sync@ilu.local'
            },
            ...options
        }).trim();
    }

    function ensureDir(filePath) {
        fs.mkdirSync(path.dirname(filePath), {recursive: true});
    }

    function isTracked(entry) {
        try {
            run(['ls-files', '--error-unmatch', '--', entry]);
            return true;
        } catch (error) {
            return false;
        }
    }

    return {
        ensureReady() {
            if (!repoPath) {
                throw new Error('Missing repo path');
            }

            fs.mkdirSync(repoPath, {recursive: true});

            if (!fs.existsSync(path.join(repoPath, '.git'))) {
                run(['init', '-b', branch]);
            }

            ensureIgnoreFile();

            if (remoteUrl) {
                let currentRemoteUrl = '';

                try {
                    currentRemoteUrl = run(['remote', 'get-url', remote]);
                } catch (error) {
                    currentRemoteUrl = '';
                }

                if (!currentRemoteUrl) {
                    run(['remote', 'add', remote, remoteUrl]);
                } else if (currentRemoteUrl !== remoteUrl) {
                    run(['remote', 'set-url', remote, remoteUrl]);
                }
            }
        },
        syncWorkingTree({sourceRoot, entries}) {
            entries.forEach(entry => {
                let sourceFile = path.join(sourceRoot, entry);
                let targetFile = path.join(repoPath, entry);

                if (!fs.existsSync(sourceFile)) {
                    if (fs.existsSync(targetFile)) {
                        fs.rmSync(targetFile, {force: true});
                    }
                    return;
                }

                ensureDir(targetFile);
                fs.copyFileSync(sourceFile, targetFile);
            });
        },
        hasChanges() {
            return run(['status', '--porcelain']).length > 0;
        },
        commit(message, {entries = []} = {}) {
            let trackedEntries = entries.length > 0 ? entries : ['.'];

            if (trackedEntries.length === 1 && trackedEntries[0] === '.') {
                run(['add', '--all', '--', '.']);
            } else {
                trackedEntries.forEach(entry => {
                    if (fs.existsSync(path.join(repoPath, entry)) || isTracked(entry)) {
                        run(['add', '--all', '--', entry]);
                    }
                });
            }

            return run(['commit', '-m', message]);
        },
        fetch() {
            return run(['fetch', remote]);
        },
        adoptRemote() {
            return run(['checkout', '-B', branch, `${remote}/${branch}`]);
        },
        inspectBootstrap({sourceRoot, entries = []} = {}) {
            let localHasData = entries.some(entry => fs.existsSync(path.join(sourceRoot, entry)));
            let remoteHasHistory = false;

            try {
                remoteHasHistory = run(['ls-remote', '--heads', remoteUrl || remote]).length > 0;
            } catch (error) {
                throw classifyGitError(error).error;
            }

            return {localHasData, remoteHasHistory};
        },
        integrate() {
            if (run(['ls-remote', '--heads', remote, branch]).length === 0) {
                return '';
            }

            return run(['pull', '--rebase', remote, branch]);
        },
        push() {
            return run(['push', remote, branch]);
        },
        getStatus() {
            return run(['status', '--short', '--branch']);
        },
        classifyGitError
    };
}

module.exports = {
    createGitCliBackend,
    classifyGitError
};
