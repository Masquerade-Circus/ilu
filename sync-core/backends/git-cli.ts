import fs from 'node:fs';
import path from 'node:path';
import * as __cjsImport37 from 'node:child_process';
const { execFileSync } = __cjsImport37;
import * as __cjsImport38 from '../contracts.ts';
const { classifyGitError } = __cjsImport38;
type IgnoreMatcher = (relativePath: string) => boolean;
type CollectFilesOptions = {
    isIgnored?: IgnoreMatcher;
    includeGitFiles?: boolean;
};
type GitCliBackendOptions = {
    repoPath?: string | null;
    branch?: string;
    remote?: string;
    remoteUrl?: string | null;
    ignorePatterns?: unknown;
};
type SyncWorkingTreeOptions = {
    sourceRoot: string;
    ignorePatterns?: unknown;
};
type CommitOptions = {
    entries?: string[];
};
type InspectBootstrapOptions = {
    sourceRoot: string;
    ignorePatterns?: unknown;
};

function normalizeIgnorePatterns(ignorePatterns: unknown = []) {
    if (!Array.isArray(ignorePatterns)) {
        return [];
    }

    return ignorePatterns
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function normalizeRelativePath(value: string) {
    return value.split(path.sep).join('/');
}

function createIgnoreMatcher(ignorePatterns: unknown = []) {
    let normalizedPatterns = normalizeIgnorePatterns(ignorePatterns)
        .map((pattern) => normalizeRelativePath(pattern));

    return function isIgnored(relativePath: string) {
        let normalizedPath = normalizeRelativePath(relativePath);

        return normalizedPatterns.some((pattern) => {
            if (pattern.endsWith('/**')) {
                let prefix = pattern.slice(0, -3);
                return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
            }

            let escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
            let regex = new RegExp(`^${escaped.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')}$`);
            return regex.test(normalizedPath);
        });
    };
}

function collectFiles(rootPath: string | null | undefined, {isIgnored = (_relativePath: string) => false, includeGitFiles = false}: CollectFilesOptions = {}) {
    let collected: string[] = [];

    if (!rootPath || !fs.existsSync(rootPath)) {
        return collected;
    }

    let basePath: string = rootPath;

    function walk(currentPath: string) {
        let entries = fs.readdirSync(currentPath, {withFileTypes: true});

        entries.forEach((entry) => {
            if (!includeGitFiles && entry.name === '.git') {
                return;
            }

            if (entry.isSymbolicLink()) {
                return;
            }

            let absolutePath = path.join(currentPath, entry.name);
            let relativePath = normalizeRelativePath(path.relative(basePath, absolutePath));

            if (isIgnored(relativePath)) {
                return;
            }

            if (entry.isDirectory()) {
                walk(absolutePath);
                return;
            }

            collected.push(relativePath);
        });
    }

    walk(rootPath);
    return collected;
}

function createGitCliBackend({repoPath, branch = 'main', remote = 'origin', remoteUrl = null, ignorePatterns = []}: GitCliBackendOptions = {}) {
    let normalizedIgnorePatterns = normalizeIgnorePatterns(ignorePatterns);

    function getRuntimeIgnorePatterns(ignorePatterns: unknown = []) {
        return normalizeIgnorePatterns([...normalizedIgnorePatterns, ...normalizeIgnorePatterns(ignorePatterns)]);
    }

    function ensureIgnoreFile() {
        if (normalizedIgnorePatterns.length === 0) {
            return;
        }

        if (!repoPath) {
            throw new Error('Missing repo path');
        }

        let ignoreFile = path.join(repoPath, '.gitignore');
        let lines: string[] = [];

        if (fs.existsSync(ignoreFile)) {
            lines = fs.readFileSync(ignoreFile, 'utf8').split(/\r?\n/).filter(Boolean);
        }

        normalizedIgnorePatterns.forEach((entry) => {
            if (!lines.includes(entry)) {
                lines.push(entry);
            }
        });

        fs.writeFileSync(ignoreFile, `${lines.join('\n')}\n`, 'utf8');
    }

    function run(args: string[], options: Parameters<typeof execFileSync>[2] = {}) {
        let cwd = repoPath && fs.existsSync(repoPath) ? repoPath : process.cwd();

        return String(execFileSync('git', args, {
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
        })).trim();
    }

    function ensureDir(filePath: string) {
        fs.mkdirSync(path.dirname(filePath), {recursive: true});
    }

    function isTracked(entry: string) {
        try {
            run(['ls-files', '--error-unmatch', '--', entry]);
            return true;
        } catch {
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
                } catch {
                    currentRemoteUrl = '';
                }

                if (!currentRemoteUrl) {
                    run(['remote', 'add', remote, remoteUrl]);
                } else if (currentRemoteUrl !== remoteUrl) {
                    run(['remote', 'set-url', remote, remoteUrl]);
                }
            }
        },
        syncWorkingTree({sourceRoot, ignorePatterns = []}: SyncWorkingTreeOptions) {
            if (!repoPath) {
                throw new Error('Missing repo path');
            }

            let isIgnored = createIgnoreMatcher(getRuntimeIgnorePatterns(ignorePatterns));
            let sourceFiles = collectFiles(sourceRoot, {isIgnored});
            let sourceRootPath = sourceRoot ? path.resolve(sourceRoot) : null;
            let repoRootPath = repoPath ? path.resolve(repoPath) : null;

            sourceFiles.forEach((entry) => {
                let sourceFile = path.join(sourceRoot, entry);
                let targetFile = path.join(repoPath, entry);

                if (fs.lstatSync(sourceFile).isSymbolicLink()) {
                    return;
                }

                ensureDir(targetFile);

                if (sourceRootPath === repoRootPath && path.resolve(sourceFile) === path.resolve(targetFile)) {
                    return;
                }

                fs.copyFileSync(sourceFile, targetFile);
            });

            collectFiles(repoPath, {isIgnored}).forEach((entry) => {
                if (entry === '.gitignore' || sourceFiles.includes(entry)) {
                    return;
                }

                fs.rmSync(path.join(repoPath, entry), {force: true});
            });
        },
        hasChanges() {
            return run(['status', '--porcelain']).length > 0;
        },
        commit(message: string, {entries = []}: CommitOptions = {}) {
            let trackedEntries = entries.length > 0 ? entries : ['.'];

            if (trackedEntries.length === 1 && trackedEntries[0] === '.') {
                run(['add', '--all', '--', '.']);
            } else {
                trackedEntries.forEach((entry) => {
                    if (!repoPath) {
                        throw new Error('Missing repo path');
                    }
                    if (fs.existsSync(path.join(repoPath, entry)) || isTracked(entry)) {
                        run(['add', '--all', '--', entry]);
                    }
                });
            }

            run(['commit', '-m', message]);
        },
        fetch() {
            run(['fetch', remote]);
        },
        adoptRemote() {
            run(['checkout', '-B', branch, `${remote}/${branch}`]);
        },
        inspectBootstrap({sourceRoot, ignorePatterns = []}: InspectBootstrapOptions) {
            let isIgnored = createIgnoreMatcher(getRuntimeIgnorePatterns(ignorePatterns));
            let localHasData = collectFiles(sourceRoot, {isIgnored}).length > 0;
            let remoteHasHistory = false;

            try {
                remoteHasHistory = run(['ls-remote', '--heads', remoteUrl || remote]).length > 0;
            } catch (error: unknown) {
                throw classifyGitError(error).error;
            }

            return {localHasData, remoteHasHistory};
        },
        integrate() {
            if (run(['ls-remote', '--heads', remote, branch]).length === 0) {
                return;
            }

            run(['pull', '--rebase', remote, branch]);
        },
        push() {
            run(['push', remote, branch]);
        },
        getStatus() {
            return run(['status', '--short', '--branch']);
        },
        classifyGitError
    };
}

export { createGitCliBackend, classifyGitError };
export default {
    createGitCliBackend,
    classifyGitError
};
