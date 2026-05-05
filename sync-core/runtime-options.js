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

function validateFlatPublicOptions(options = {}) {
    let forbidden = [];

    if (Object.prototype.hasOwnProperty.call(options, 'adapter')) {
        forbidden.push('adapter');
    }

    if (Object.prototype.hasOwnProperty.call(options, 'stateStore')) {
        forbidden.push('stateStore');
    }

    if (Object.prototype.hasOwnProperty.call(options, 'backend')) {
        forbidden.push('backend');
    }

    if (forbidden.length > 0) {
        throw new Error(`Sync runtime flat options do not accept ${forbidden.join(' or ')}`);
    }
}

function validateNormalizedOptions(normalized, {validateRemoteUrl = true} = {}) {
    if (!normalized.sourceRoot || typeof normalized.sourceRoot !== 'string') {
        throw new Error('Sync runtime requires sourceRoot');
    }

    if (validateRemoteUrl && normalized.config.enabled === true && !normalized.config.remoteUrl) {
        throw new Error('Sync runtime requires remoteUrl when sync is enabled');
    }

}

function normalizeFlatOptions(options = {}) {
    validateFlatPublicOptions(options);

    return {
        config: normalizeConfig(options),
        sourceRoot: options.sourceRoot || null,
        ignorePatterns: normalizeIgnorePatterns(options.ignorePatterns),
        buildCommitMessage: typeof options.buildCommitMessage === 'function'
            ? options.buildCommitMessage
            : defaultBuildCommitMessage,
    };
}

function normalizeRuntimeOptions(options = {}) {
    let normalized = normalizeFlatOptions(options);

    validateNormalizedOptions(normalized, {
        validateRemoteUrl: true
    });
    return normalized;
}

module.exports = {
    defaultBuildCommitMessage,
    normalizeRuntimeOptions
};
