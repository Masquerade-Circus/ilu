let notifySync = require('../sync/ilu-hooks');

function createPersistenceNotifier(domain: any) {
    return function afterPersist(action: any) {
        notifySync({domain, action});
    };
}

function createCollectionPersistenceNotifier(dbName: any, collectionName: any) {
    return createPersistenceNotifier(dbName || collectionName || 'data');
}

module.exports = {
    createCollectionPersistenceNotifier,
    createPersistenceNotifier
};
