import notifySync from '../sync/ilu-hooks.ts';
function createPersistenceNotifier(domain: string) {
    return function afterPersist(action: string) {
        notifySync({domain, action});
    };
}

function createCollectionPersistenceNotifier(dbName: string | null | undefined, collectionName: string | null | undefined) {
    return createPersistenceNotifier(dbName || collectionName || 'data');
}

export { createCollectionPersistenceNotifier, createPersistenceNotifier };
export default {
    createCollectionPersistenceNotifier,
    createPersistenceNotifier
};
