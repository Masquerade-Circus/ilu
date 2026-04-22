let os = require('os');
let path = require('path');
let {
    SYNC_DIRNAME,
    SYNC_CONFIG_FILENAME,
    TTS_CONFIG_FILENAME,
    SYNC_STATE_FILENAME,
    SYNC_LOCK_FILENAME
} = require('../sync/contracts');

function storageDirPath() {
    return path.join(os.homedir(), '.ilu');
}

function dbFilePath(dbname) {
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

function ttsConfigFilePath() {
    return path.join(syncDirPath(), TTS_CONFIG_FILENAME);
}

function syncLockFilePath() {
    return path.join(syncDirPath(), SYNC_LOCK_FILENAME);
}

module.exports = {
    storageDirPath,
    dbFilePath,
    syncDirPath,
    syncConfigFilePath,
    ttsConfigFilePath,
    syncStateFilePath,
    syncLockFilePath
};
