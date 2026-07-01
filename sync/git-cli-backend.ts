import * as __cjsImport27 from '../sync-core/backends/git-cli.ts';
const { createGitCliBackend: createCoreGitCliBackend, classifyGitError } = __cjsImport27;
type GitCliBackendOptions = {
    repoPath?: string | null;
    branch?: string;
    remote?: string;
    remoteUrl?: string | null;
    ignorePatterns?: unknown;
};

function normalizeIgnorePattern(pattern: unknown) {
    if (typeof pattern !== 'string') {
        return null;
    }

    let normalized = pattern.trim();

    if (!normalized) {
        return null;
    }

    if (normalized.endsWith('/')) {
        return `${normalized}**`;
    }

    return normalized;
}

function createGitCliBackend(options: GitCliBackendOptions = {}) {
    let ignorePatterns = [
        '.config/',
        ...(Array.isArray(options.ignorePatterns) ? options.ignorePatterns : [])
    ].map(normalizeIgnorePattern).filter((pattern): pattern is string => typeof pattern === 'string');

    return createCoreGitCliBackend({
        ...options
        ,ignorePatterns
    });
}

export { createGitCliBackend, classifyGitError };
export default {
    createGitCliBackend,
    classifyGitError
};
