let {createGitCliBackend: createCoreGitCliBackend, classifyGitError} = require('../sync-core/backends/git-cli');

function normalizeIgnorePattern(pattern: any) {
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

function createGitCliBackend(options: any = {}) {
    let ignorePatterns = [
        '.config/',
        ...(options.ignorePatterns || [])
    ].map(normalizeIgnorePattern).filter(Boolean);

    return createCoreGitCliBackend({
        ...options
        ,ignorePatterns
    });
}

module.exports = {
    createGitCliBackend,
    classifyGitError
};
