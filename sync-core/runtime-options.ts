type SyncMutationContext = {
    domain?: string;
    action?: string;
};

type SyncConfigInput = {
    enabled?: boolean;
    remoteUrl?: string | null;
    branch?: string | null;
    autoSync?: boolean;
    autoPull?: boolean;
    autoPush?: boolean;
};

type FlatSyncOptions = SyncConfigInput & {
    sourceRoot?: string | null;
    ignorePatterns?: unknown;
    buildCommitMessage?: (context: SyncMutationContext) => string;
    adapter?: unknown;
    stateStore?: unknown;
    backend?: unknown;
};

type NormalizedSyncOptions = {
    config: ReturnType<typeof normalizeConfig>;
    sourceRoot: string | null;
};

function defaultBuildCommitMessage(context: SyncMutationContext = {}) {
    return `sync(${context.domain || 'data'}): ${context.action || 'save'} local data snapshot`;
}

function normalizeIgnorePatterns(ignorePatterns: unknown) {
    if (!Array.isArray(ignorePatterns)) {
        return [];
    }

    return ignorePatterns
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function normalizeConfig(config: SyncConfigInput = {}) {
    return {
        enabled: config.enabled === true,
        remoteUrl: config.remoteUrl || null,
        branch: config.branch || 'main',
        autoSync: config.autoSync !== false,
        autoPull: config.autoPull !== false,
        autoPush: config.autoPush !== false
    };
}

function validateFlatPublicOptions(options: FlatSyncOptions = {}) {
    let forbidden: string[] = [];

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

function validateNormalizedOptions(
    normalized: NormalizedSyncOptions,
    {validateRemoteUrl = true}: {validateRemoteUrl?: boolean} = {}
) {
    if (!normalized.sourceRoot || typeof normalized.sourceRoot !== 'string') {
        throw new Error('Sync runtime requires sourceRoot');
    }

    if (validateRemoteUrl && normalized.config.enabled === true && !normalized.config.remoteUrl) {
        throw new Error('Sync runtime requires remoteUrl when sync is enabled');
    }

}

function normalizeFlatOptions(options: FlatSyncOptions = {}) {
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

function normalizeRuntimeOptions(options: FlatSyncOptions = {}) {
    let normalized = normalizeFlatOptions(options);

    validateNormalizedOptions(normalized, {
        validateRemoteUrl: true
    });
    return normalized;
}

export { defaultBuildCommitMessage, normalizeRuntimeOptions };
export default {
    defaultBuildCommitMessage,
    normalizeRuntimeOptions
};
