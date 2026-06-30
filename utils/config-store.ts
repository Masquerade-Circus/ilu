import fs from 'node:fs';
import localPaths from './local-paths.ts';
function readJsonIfExists(filePath: any, fileSystem: any = fs) {
    if (!fileSystem.existsSync(filePath)) {
        return null;
    }

    return JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
}

function normalizeSyncConfig(config: any = {}) {
    return {
        enabled: config.enabled === true,
        remoteUrl: typeof config.remoteUrl === 'string' && config.remoteUrl.trim() ? config.remoteUrl.trim() : null,
        branch: typeof config.branch === 'string' && config.branch.trim() ? config.branch.trim() : 'main',
        autoSync: config.autoSync !== false,
        autoPull: config.autoPull !== false,
        autoPush: config.autoPush !== false
    };
}

function normalizeTtsConfig(config: any = {}) {
    return {
        apiKey: typeof config.apiKey === 'string' && config.apiKey.trim() ? config.apiKey.trim() : null,
        voice: typeof config.voice === 'string' && config.voice.trim() ? config.voice.trim() : null
    };
}

function serializeTtsConfig(config: any = {}) {
    let normalized = normalizeTtsConfig(config);
    let next: any = {};

    if (normalized.apiKey) {
        next.apiKey = normalized.apiKey;
    }

    if (normalized.voice) {
        next.voice = normalized.voice;
    }

    return next;
}

function loadSyncConfig({fs: fileSystem = fs, paths = localPaths}: any = {}) {
    let currentConfig = readJsonIfExists(paths.syncConfigFilePath(), fileSystem);
    return normalizeSyncConfig(currentConfig || {});
}

function saveSyncConfig(config: any, {fs: fileSystem = fs, paths = localPaths}: any = {}) {
    let nextConfig = normalizeSyncConfig(config);
    fileSystem.mkdirSync(paths.syncDirPath(), {recursive: true});
    fileSystem.writeFileSync(paths.syncConfigFilePath(), JSON.stringify(nextConfig, null, 2), 'utf8');
    return nextConfig;
}

function loadTtsConfig({fs: fileSystem = fs, paths = localPaths}: any = {}) {
    let currentConfig = readJsonIfExists(paths.ttsConfigFilePath(), fileSystem);
    return normalizeTtsConfig(currentConfig || {});
}

function saveTtsConfig(config: any, {fs: fileSystem = fs, paths = localPaths}: any = {}) {
    let nextConfig = serializeTtsConfig(config);
    fileSystem.mkdirSync(paths.syncDirPath(), {recursive: true, mode: 0o700});
    fileSystem.writeFileSync(paths.ttsConfigFilePath(), JSON.stringify(nextConfig, null, 2), {encoding: 'utf8', mode: 0o600});

    if (typeof fileSystem.chmodSync === 'function') {
        fileSystem.chmodSync(paths.ttsConfigFilePath(), 0o600);
    }

    return nextConfig;
}

function getSyncConfig({fs: fileSystem = fs, paths = localPaths}: any = {}) {
    return loadSyncConfig({fs: fileSystem, paths});
}

function getTtsConfig({fs: fileSystem = fs, paths = localPaths}: any = {}) {
    return loadTtsConfig({fs: fileSystem, paths});
}

export { loadSyncConfig, saveSyncConfig, loadTtsConfig, saveTtsConfig, getSyncConfig, getTtsConfig, normalizeSyncConfig, normalizeTtsConfig };
export default {
    loadSyncConfig,
    saveSyncConfig,
    loadTtsConfig,
    saveTtsConfig,
    getSyncConfig,
    getTtsConfig,
    normalizeSyncConfig,
    normalizeTtsConfig
};
