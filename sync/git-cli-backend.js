let {createGitCliBackend: createCoreGitCliBackend, classifyGitError} = require('../sync-core/backends/git-cli');

function normalizeLegacyIgnorePattern(pattern) {
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

function createGitCliBackend(options = {}) {
    let ignorePatterns = [
        '.config/',
        ...(options.ignorePatterns || [])
    ].map(normalizeLegacyIgnorePattern).filter(Boolean);

    return createCoreGitCliBackend({
        ...options
        ,ignorePatterns
    });
}

module.exports = {
    createGitCliBackend,
    classifyGitError
};
