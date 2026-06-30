import notifySync from '../sync/ilu-hooks.ts';
function createPersistenceNotifier(domain: any) {
    return function afterPersist(action: any) {
        notifySync({domain, action});
    };
}

function createCollectionPersistenceNotifier(dbName: any, collectionName: any) {
    return createPersistenceNotifier(dbName || collectionName || 'data');
}

export { createCollectionPersistenceNotifier, createPersistenceNotifier };
export default {
    createCollectionPersistenceNotifier,
    createPersistenceNotifier
};
