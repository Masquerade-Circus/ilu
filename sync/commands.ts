import fs from 'node:fs';
import localPaths from '../utils/local-paths.ts';
import configStore from '../utils/config-store.ts';
import sync from './index.ts';
import * as __cjsImport25 from './remote-validation.ts';
const { validateSyncBranch, validateSyncRemoteUrl } = __cjsImport25;
const defaultDependencies = {fs, localPaths, configStore, sync};
let dependencies = defaultDependencies;

type CommandDependencies = typeof defaultDependencies;
type SyncConfig = Record<string, unknown> & {sync?: Record<string, unknown>};
type InitOptions = {
    remote?: string;
    branch?: string;
};

function configureCommandDependencies(overrides: Partial<CommandDependencies> = {}) {
    let previous = dependencies;
    dependencies = {...dependencies, ...overrides};

    return () => {
        dependencies = previous;
    };
}

function resetCommandDependencies() {
    dependencies = defaultDependencies;
}

function saveConfig(config: SyncConfig) {
    return dependencies.configStore.saveSyncConfig(config.sync || {}, {fs: dependencies.fs, paths: dependencies.localPaths});
}

async function init(_args: string[] = [], options: InitOptions = {}) {
    let remoteUrl = validateSyncRemoteUrl(options.remote);
    let hasBranchOption = Object.prototype.hasOwnProperty.call(options, 'branch');
    let branch = hasBranchOption ? validateSyncBranch(options.branch) : 'main';

    let backend = dependencies.sync.createBootstrapBackend({branch, remoteUrl});
    let bootstrapContext = dependencies.sync.getBootstrapContext();

    let bootstrap = typeof backend.inspectBootstrap === 'function'
        ? backend.inspectBootstrap(bootstrapContext)
        : {localHasData: false, remoteHasHistory: false};

    if (bootstrap.localHasData && bootstrap.remoteHasHistory) {
        throw new Error('Initialization stopped to avoid overwriting data');
    }

    let config = saveConfig({
        sync: {
            enabled: true,
            remoteUrl,
            branch,
            autoSync: true,
            autoPull: true,
            autoPush: true
        }
    });

    let initialState = dependencies.sync.initializeSyncState({
        enabled: true,
        status: bootstrap.localHasData || bootstrap.remoteHasHistory ? 'pending_remote' : 'healthy'
    });

    if (!bootstrap.localHasData && bootstrap.remoteHasHistory) {
        backend.ensureReady();
        backend.fetch();
        backend.adoptRemote();
        dependencies.sync.initializeSyncState({...initialState, status: 'healthy', hasPendingRemote: false});
    }

    if (bootstrap.localHasData && !bootstrap.remoteHasHistory) {
        let bootstrapConfig = dependencies.sync.getSyncConfig();
        let runtime = dependencies.sync.createSyncRuntimeAdvanced({
            config: {
                ...bootstrapConfig,
                enabled: true,
                remoteUrl,
                branch
            },
            sourceRoot: bootstrapContext.sourceRoot,
            ignorePatterns: bootstrapContext.ignorePatterns,
            backend
        });
        await runtime.retry({reason: 'init'});
    }

    return config;
}

async function status() {
    let currentStatus = dependencies.sync.createSyncRuntime().getSyncStatus();
    console.log(`Sync: ${currentStatus.status}`);
    if (currentStatus.hasPendingRemote) {
        console.log('Pending remote sync: yes');
    }
    if (currentStatus.lastErrorKind) {
        console.log(`Last error: ${currentStatus.lastErrorKind}`);
    }
    return currentStatus;
}

async function retry() {
    let runtime = dependencies.sync.createSyncRuntime();
    await runtime.retry({reason: 'manual'});
    return runtime.getSyncStatus();
}

async function enable() {
    let config = dependencies.sync.getSyncConfig();
    saveConfig({sync: {...config, enabled: true}});
    let runtime = dependencies.sync.createSyncRuntime();
    if (typeof runtime.enable === 'function') {
        await runtime.enable();
    }
    return runtime.getSyncStatus();
}

async function disable() {
    let config = dependencies.sync.getSyncConfig();
    saveConfig({sync: {...config, enabled: false}});
    let runtime = dependencies.sync.createSyncRuntime();
    if (typeof runtime.disable === 'function') {
        await runtime.disable();
    }
    return runtime.getSyncStatus();
}

export { init, status, retry, enable, disable, configureCommandDependencies, resetCommandDependencies };
export default {
    init,
    status,
    retry,
    enable,
    disable,
    configureCommandDependencies,
    resetCommandDependencies
};
