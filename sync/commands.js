let fs = require('node:fs');
let localPaths = require('../utils/local-paths');
let configStore = require('../utils/config-store');
let sync = require('./index');

function ensureSyncDir() {
    fs.mkdirSync(localPaths.syncDirPath(), {recursive: true});
}

function saveConfig(config) {
    return configStore.saveSyncConfig(config.sync || {}, {fs, paths: localPaths});
}

async function init(args, options = {}) {
    let remoteUrl = (options.remote || '').trim();
    let branch = (options.branch || 'main').trim() || 'main';

    if (!remoteUrl) {
        throw new Error('A remote URL is required for sync init');
    }

    let backend = sync.createBootstrapBackend({branch, remoteUrl});
    let bootstrapContext = sync.getBootstrapContext();

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

    let nextState = sync.initializeSyncState({
        enabled: true,
        status: bootstrap.localHasData || bootstrap.remoteHasHistory ? 'pending_remote' : 'healthy'
    });

    if (!bootstrap.localHasData && bootstrap.remoteHasHistory) {
        backend.ensureReady();
        backend.fetch();
        backend.adoptRemote();
        nextState = sync.initializeSyncState({...nextState, status: 'healthy', hasPendingRemote: false});
    }

    if (bootstrap.localHasData && !bootstrap.remoteHasHistory) {
        let bootstrapConfig = sync.getSyncConfig();
        let runtime = sync.createSyncRuntimeAdvanced({
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
    let currentStatus = sync.createSyncRuntime().getSyncStatus();
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
    let runtime = sync.createSyncRuntime();
    await runtime.retry({reason: 'manual'});
    return runtime.getSyncStatus();
}

async function enable() {
    let config = sync.getSyncConfig();
    saveConfig({sync: {...config, enabled: true}});
    let runtime = sync.createSyncRuntime();
    if (typeof runtime.enable === 'function') {
        await runtime.enable();
    }
    return runtime.getSyncStatus();
}

async function disable() {
    let config = sync.getSyncConfig();
    saveConfig({sync: {...config, enabled: false}});
    let runtime = sync.createSyncRuntime();
    if (typeof runtime.disable === 'function') {
        await runtime.disable();
    }
    return runtime.getSyncStatus();
}

module.exports = {
    init,
    status,
    retry,
    enable,
    disable
};
