let {createSyncRuntimeFromResolvedOptions} = require('./engine');

function defaultBuildCommitMessage(context = {}) {
    return `sync(${context.domain || 'data'}): ${context.action || 'save'} local data snapshot`;
}

function normalizeIgnorePatterns(ignorePatterns) {
    if (!Array.isArray(ignorePatterns)) {
        return [];
    }

    return ignorePatterns
        .filter(entry => typeof entry === 'string')
        .map(entry => entry.trim())
        .filter(Boolean);
}

function normalizeConfig(config = {}) {
    return {
        enabled: config.enabled === true,
        remoteUrl: config.remoteUrl || null,
        branch: config.branch || 'main',
        autoSync: config.autoSync !== false,
        autoPull: config.autoPull !== false,
        autoPush: config.autoPush !== false
    };
}

function createSyncRuntimeAdvanced(options = {}) {
    if (!options.config || typeof options.config !== 'object') {
        throw new Error('Sync advanced runtime requires config');
    }

    if (!options.sourceRoot || typeof options.sourceRoot !== 'string') {
        throw new Error('Sync advanced runtime requires sourceRoot');
    }

    if (!options.stateStore || typeof options.stateStore.loadState !== 'function' || typeof options.stateStore.saveState !== 'function') {
        throw new Error('Sync advanced runtime requires an explicit stateStore with loadState() and saveState()');
    }

    if (!options.backend || typeof options.backend.ensureReady !== 'function') {
        throw new Error('Sync advanced runtime requires an explicit backend');
    }

    return createSyncRuntimeFromResolvedOptions({
        config: normalizeConfig(options.config),
        sourceRoot: options.sourceRoot,
        ignorePatterns: normalizeIgnorePatterns(options.ignorePatterns),
        buildCommitMessage: typeof options.buildCommitMessage === 'function'
            ? options.buildCommitMessage
            : defaultBuildCommitMessage,
        stateStore: options.stateStore,
        backend: options.backend
    });
}

module.exports = {
    createSyncRuntimeAdvanced
};
