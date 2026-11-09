import IluDb from 'iludb';
import IluDbNodeJsonPlugin from 'iludb/plugins/node-json';
import { activeDataConflict, beginDataRecovery, DataConflictError } from '../sync/iludb-recovery.ts';
import * as __cjsImport139 from './local-paths.ts';
const { dbFilePath } = __cjsImport139;
IluDb.use(IluDbNodeJsonPlugin);
const loadedDatabases = new Set<ReturnType<typeof IluDb>>();

function loadDb(dbname: string) {
    let filePath = dbFilePath(dbname);
    let database = IluDb(filePath);
    loadedDatabases.add(database);
    let originalGetCollection = database.getCollection.bind(database);

    database.getCollection = function getCollection<TCollection extends object = IluDb.Document>(name: string) {
        let collection = originalGetCollection<TCollection>(name);

        return new Proxy(collection, {
            get(target, property, receiver) {
                let value = Reflect.get(target, property, receiver);

                if (typeof value !== 'function' || !['add', 'update', 'remove'].includes(String(property))) {
                    return value;
                }

                return function persistWithConflictDetection(...args: unknown[]) {
                    let activeConflict = activeDataConflict(filePath, () => database.reload());
                    if (activeConflict !== null) {
                        throw activeConflict;
                    }

                    try {
                        return Reflect.apply(value, target, args);
                    } catch (error: unknown) {
                        if (!(error instanceof IluDbNodeJsonPlugin.ConflictError)) {
                            throw error;
                        }

                        throw beginDataRecovery({filePath, domain: dbname, conflict: error, reload: () => database.reload()});
                    }
                };
            }
        });
    };

    return database;
}

function reloadLoadedDatabases() {
    for (const database of loadedDatabases) {
        database.reload();
    }
}

export { DataConflictError, loadDb, reloadLoadedDatabases };
export default loadDb;
