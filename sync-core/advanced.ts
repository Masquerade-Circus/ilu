import * as __cjsImport36 from './engine.ts';
const { createSyncRuntimeFromResolvedOptions } = __cjsImport36;
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
type SyncRuntimeAdvancedOptions = {
    config?: SyncConfigInput;
    sourceRoot?: string | null;
    ignorePatterns?: unknown;
    buildCommitMessage?: (context: SyncMutationContext) => string;
    stateStore?: ResolvedSyncRuntimeOptions['stateStore'];
    backend?: ResolvedSyncRuntimeOptions['backend'];
};
type ResolvedSyncRuntimeOptions = Parameters<typeof createSyncRuntimeFromResolvedOptions>[0];

function hasMethod<T extends string>(value: unknown, methodName: T): value is Record<T, (...args: never[]) => unknown> {
    return value !== null
        && typeof value === 'object'
        && typeof (value as Record<string, unknown>)[methodName] === 'function';
}

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

function createSyncRuntimeAdvanced(options: SyncRuntimeAdvancedOptions = {}) {
    if (!options.config || typeof options.config !== 'object') {
        throw new Error('Sync advanced runtime requires config');
    }

    if (!options.sourceRoot || typeof options.sourceRoot !== 'string') {
        throw new Error('Sync advanced runtime requires sourceRoot');
    }

    if (!hasMethod(options.stateStore, 'loadState') || !hasMethod(options.stateStore, 'saveState')) {
        throw new Error('Sync advanced runtime requires an explicit stateStore with loadState() and saveState()');
    }

    if (!hasMethod(options.backend, 'ensureReady')) {
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

export { createSyncRuntimeAdvanced };
export default {
    createSyncRuntimeAdvanced
};
