let log = require('../utils/log');

function shouldLogSync(syncIndex) {
    if (!syncIndex || typeof syncIndex.getSyncConfig !== 'function') {
        return false;
    }

    let config;
    try {
        config = syncIndex.getSyncConfig();
    } catch (_) {
        return false;
    }

    return config && config.enabled === true && config.autoSync !== false;
}

function logSyncing(syncIndex) {
    if (!shouldLogSync(syncIndex)) {
        return;
    }

    try {
        log.info('Syncing...');
    } catch (_) {}
}

module.exports = function notifySync(context) {
    Promise.resolve()
        .then(() => {
            let syncIndex = require('./index');
            logSyncing(syncIndex);

            return syncIndex.notifyLocalMutation(context);
        })
        .catch(() => null);
};
