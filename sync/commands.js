let fs = require('node:fs');
let localPaths = require('../utils/local-paths');
let configStore = require('../utils/config-store');
let {createSyncRuntime} = require('./index');
let adapter = require('./ilu-adapter');
let stateStore = require('./state-store');
let {createGitCliBackend} = require('./git-cli-backend');

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

    let backend = createGitCliBackend({
        repoPath: adapter.getSourceRoot(),
        branch,
        remote: 'origin',
        remoteUrl
    });

    let bootstrap = typeof backend.inspectBootstrap === 'function'
        ? backend.inspectBootstrap({
            sourceRoot: adapter.getSourceRoot(),
            entries: adapter.listTrackedEntries()
        })
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

    let nextState = stateStore.saveState({
        ...stateStore.defaultState(),
        enabled: true,
        status: bootstrap.localHasData || bootstrap.remoteHasHistory ? 'pending_remote' : 'healthy'
    });

    if (!bootstrap.localHasData && bootstrap.remoteHasHistory) {
        backend.ensureReady();
        backend.fetch();
        backend.adoptRemote();
        nextState = stateStore.saveState({...nextState, status: 'healthy', hasPendingRemote: false});
    }

    if (bootstrap.localHasData && !bootstrap.remoteHasHistory) {
        let runtime = createSyncRuntime({backend});
        await runtime.retry({reason: 'init'});
    }

    return config;
}

async function status() {
    let currentStatus = createSyncRuntime().getSyncStatus();
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
    let runtime = createSyncRuntime();
    await runtime.retry({reason: 'manual'});
    return runtime.getSyncStatus();
}

async function enable() {
    let config = adapter.getSyncConfig();
    saveConfig({sync: {...config, enabled: true}});
    let runtime = createSyncRuntime();
    if (typeof runtime.enable === 'function') {
        await runtime.enable();
    }
    return runtime.getSyncStatus();
}

async function disable() {
    let config = adapter.getSyncConfig();
    saveConfig({sync: {...config, enabled: false}});
    let runtime = createSyncRuntime();
    if (typeof runtime.disable === 'function') {
        await runtime.disable();
        return runtime.getSyncStatus();
    }
    let next = stateStore.saveState({...stateStore.loadState(), enabled: false, status: 'disabled'});
    return next;
}

module.exports = {
    init,
    status,
    retry,
    enable,
    disable
};
