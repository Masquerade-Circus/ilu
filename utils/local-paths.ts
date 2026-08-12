import os from 'os';
import path from 'path';
import * as syncContracts from '../sync/contracts.ts';
let {
    SYNC_DIRNAME,
    SYNC_CONFIG_FILENAME,
    TTS_CONFIG_FILENAME,
    SYNC_STATE_FILENAME,
    SYNC_PENDING_FILENAME,
    SYNC_LOCK_FILENAME
} = syncContracts;

function storageDirPath() {
    return path.join(os.homedir(), '.ilu');
}

function dbFilePath(dbname: string) {
    return path.join(storageDirPath(), `${dbname}.json`);
}

function syncDirPath() {
    return path.join(storageDirPath(), SYNC_DIRNAME);
}

function syncConfigFilePath() {
    return path.join(syncDirPath(), SYNC_CONFIG_FILENAME);
}

function syncStateFilePath() {
    return path.join(syncDirPath(), SYNC_STATE_FILENAME);
}

function syncPendingFilePath() {
    return path.join(syncDirPath(), SYNC_PENDING_FILENAME);
}

function ttsConfigFilePath() {
    return path.join(syncDirPath(), TTS_CONFIG_FILENAME);
}

function syncLockFilePath() {
    return path.join(syncDirPath(), SYNC_LOCK_FILENAME);
}

export { storageDirPath, dbFilePath, syncDirPath, syncConfigFilePath, ttsConfigFilePath, syncStateFilePath, syncPendingFilePath, syncLockFilePath };
export default {
    storageDirPath,
    dbFilePath,
    syncDirPath,
    syncConfigFilePath,
    ttsConfigFilePath,
    syncStateFilePath,
    syncPendingFilePath,
    syncLockFilePath
};
