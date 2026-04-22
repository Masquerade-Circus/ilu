let fs = require('node:fs');
let localPaths = require('./local-paths');

function readJsonIfExists(filePath, fileSystem = fs) {
    if (!fileSystem.existsSync(filePath)) {
        return null;
    }

    return JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
}

function normalizeSyncConfig(config = {}) {
    return {
        enabled: config.enabled === true,
        remoteUrl: typeof config.remoteUrl === 'string' && config.remoteUrl.trim() ? config.remoteUrl.trim() : null,
        branch: typeof config.branch === 'string' && config.branch.trim() ? config.branch.trim() : 'main',
        autoSync: config.autoSync !== false,
        autoPull: config.autoPull !== false,
        autoPush: config.autoPush !== false
    };
}

function normalizeTtsConfig(config = {}) {
    return {
        apiKey: typeof config.apiKey === 'string' && config.apiKey.trim() ? config.apiKey.trim() : null,
        voice: typeof config.voice === 'string' && config.voice.trim() ? config.voice.trim() : null
    };
}

function serializeTtsConfig(config = {}) {
    let normalized = normalizeTtsConfig(config);
    let next = {};

    if (normalized.apiKey) {
        next.apiKey = normalized.apiKey;
    }

    if (normalized.voice) {
        next.voice = normalized.voice;
    }

    return next;
}

function loadSyncConfig({fs: fileSystem = fs, paths = localPaths} = {}) {
    let currentConfig = readJsonIfExists(paths.syncConfigFilePath(), fileSystem);
    return normalizeSyncConfig(currentConfig || {});
}

function saveSyncConfig(config, {fs: fileSystem = fs, paths = localPaths} = {}) {
    let nextConfig = normalizeSyncConfig(config);
    fileSystem.mkdirSync(paths.syncDirPath(), {recursive: true});
    fileSystem.writeFileSync(paths.syncConfigFilePath(), JSON.stringify(nextConfig, null, 2), 'utf8');
    return nextConfig;
}

function loadTtsConfig({fs: fileSystem = fs, paths = localPaths} = {}) {
    let currentConfig = readJsonIfExists(paths.ttsConfigFilePath(), fileSystem);
    return normalizeTtsConfig(currentConfig || {});
}

function saveTtsConfig(config, {fs: fileSystem = fs, paths = localPaths} = {}) {
    let nextConfig = serializeTtsConfig(config);
    fileSystem.mkdirSync(paths.syncDirPath(), {recursive: true});
    fileSystem.writeFileSync(paths.ttsConfigFilePath(), JSON.stringify(nextConfig, null, 2), 'utf8');
    return nextConfig;
}

function getSyncConfig({fs: fileSystem = fs, paths = localPaths} = {}) {
    return loadSyncConfig({fs: fileSystem, paths});
}

function getTtsConfig({fs: fileSystem = fs, paths = localPaths} = {}) {
    return loadTtsConfig({fs: fileSystem, paths});
}

module.exports = {
    loadSyncConfig,
    saveSyncConfig,
    loadTtsConfig,
    saveTtsConfig,
    getSyncConfig,
    getTtsConfig,
    normalizeSyncConfig,
    normalizeTtsConfig
};
