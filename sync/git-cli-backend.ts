import * as __cjsImport27 from '../sync-core/backends/git-cli.ts';
const { createGitCliBackend: createCoreGitCliBackend, classifyGitError } = __cjsImport27;
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

export { createGitCliBackend, classifyGitError };
export default {
    createGitCliBackend,
    classifyGitError
};
