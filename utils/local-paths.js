let os = require('os');
let path = require('path');

function storageDirPath() {
    return path.join(os.homedir(), '.ilu');
}

function dbFilePath(dbname) {
    return path.join(storageDirPath(), `${dbname}.json`);
}

function noteTempFilePath() {
    return path.join(storageDirPath(), 'note.txt');
}

module.exports = {
    storageDirPath,
    dbFilePath,
    noteTempFilePath
};
