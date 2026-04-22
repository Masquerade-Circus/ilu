let os = require('os');
let path = require('path');
let {
    SYNC_DIRNAME,
    SYNC_CONFIG_FILENAME,
    SYNC_STATE_FILENAME,
    SYNC_LOCK_FILENAME
} = require('../sync/contracts');

function storageDirPath() {
    return path.join(os.homedir(), '.ilu');
}

function dbFilePath(dbname) {
    return path.join(storageDirPath(), `${dbname}.json`);
}

function noteTempFilePath() {
    return path.join(storageDirPath(), 'note.txt');
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

function syncLockFilePath() {
    return path.join(syncDirPath(), SYNC_LOCK_FILENAME);
}

module.exports = {
    storageDirPath,
    dbFilePath,
    noteTempFilePath,
    syncDirPath,
    syncConfigFilePath,
    syncStateFilePath,
    syncLockFilePath
};
