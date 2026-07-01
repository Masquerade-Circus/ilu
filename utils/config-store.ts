import fs from 'node:fs';
import localPaths from './local-paths.ts';

type JsonRecord = Record<string, unknown>;
type Paths = typeof localPaths;
type FileSystem = {
    existsSync(path: fs.PathLike): boolean;
    readFileSync(path: fs.PathOrFileDescriptor, encoding: BufferEncoding): string;
    mkdirSync(path: fs.PathLike, options?: fs.MakeDirectoryOptions): string | undefined;
    writeFileSync(path: fs.PathOrFileDescriptor, data: string, options?: fs.WriteFileOptions): void;
    chmodSync?: (path: fs.PathLike, mode: fs.Mode) => void;
};
type ConfigStoreOptions = {
    fs?: FileSystem;
    paths?: Paths;
};
type SyncConfig = {
    enabled: boolean;
    remoteUrl: string | null;
    branch: string;
    autoSync: boolean;
    autoPull: boolean;
    autoPush: boolean;
};
type TtsConfig = {
    apiKey: string | null;
    voice: string | null;
};

function isJsonRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonIfExists(filePath: fs.PathLike, fileSystem: FileSystem = fs) {
    if (!fileSystem.existsSync(filePath)) {
        return null;
    }

    return JSON.parse(fileSystem.readFileSync(filePath, 'utf8')) as unknown;
}

function normalizeSyncConfig(config: unknown = {}): SyncConfig {
    let record = isJsonRecord(config) ? config : {};

    return {
        enabled: record.enabled === true,
        remoteUrl: typeof record.remoteUrl === 'string' && record.remoteUrl.trim() ? record.remoteUrl.trim() : null,
        branch: typeof record.branch === 'string' && record.branch.trim() ? record.branch.trim() : 'main',
        autoSync: record.autoSync !== false,
        autoPull: record.autoPull !== false,
        autoPush: record.autoPush !== false
    };
}

function normalizeTtsConfig(config: unknown = {}): TtsConfig {
    let record = isJsonRecord(config) ? config : {};

    return {
        apiKey: typeof record.apiKey === 'string' && record.apiKey.trim() ? record.apiKey.trim() : null,
        voice: typeof record.voice === 'string' && record.voice.trim() ? record.voice.trim() : null
    };
}

function serializeTtsConfig(config: unknown = {}) {
    let normalized = normalizeTtsConfig(config);
    let next: Partial<TtsConfig> = {};

    if (normalized.apiKey) {
        next.apiKey = normalized.apiKey;
    }

    if (normalized.voice) {
        next.voice = normalized.voice;
    }

    return next;
}

function loadSyncConfig({fs: fileSystem = fs, paths = localPaths}: ConfigStoreOptions = {}) {
    let currentConfig = readJsonIfExists(paths.syncConfigFilePath(), fileSystem);
    return normalizeSyncConfig(currentConfig || {});
}

function saveSyncConfig(config: unknown, {fs: fileSystem = fs, paths = localPaths}: ConfigStoreOptions = {}) {
    let nextConfig = normalizeSyncConfig(config);
    fileSystem.mkdirSync(paths.syncDirPath(), {recursive: true});
    fileSystem.writeFileSync(paths.syncConfigFilePath(), JSON.stringify(nextConfig, null, 2), 'utf8');
    return nextConfig;
}

function loadTtsConfig({fs: fileSystem = fs, paths = localPaths}: ConfigStoreOptions = {}) {
    let currentConfig = readJsonIfExists(paths.ttsConfigFilePath(), fileSystem);
    return normalizeTtsConfig(currentConfig || {});
}

function saveTtsConfig(config: unknown, {fs: fileSystem = fs, paths = localPaths}: ConfigStoreOptions = {}) {
    let nextConfig = serializeTtsConfig(config);
    fileSystem.mkdirSync(paths.syncDirPath(), {recursive: true, mode: 0o700});
    fileSystem.writeFileSync(paths.ttsConfigFilePath(), JSON.stringify(nextConfig, null, 2), {encoding: 'utf8', mode: 0o600});

    if (typeof fileSystem.chmodSync === 'function') {
        fileSystem.chmodSync(paths.ttsConfigFilePath(), 0o600);
    }

    return nextConfig;
}

function getSyncConfig({fs: fileSystem = fs, paths = localPaths}: ConfigStoreOptions = {}) {
    return loadSyncConfig({fs: fileSystem, paths});
}

function getTtsConfig({fs: fileSystem = fs, paths = localPaths}: ConfigStoreOptions = {}) {
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
