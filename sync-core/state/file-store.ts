import fs from 'node:fs';
import path from 'node:path';
type SyncState = Record<string, unknown>;
type FileStateStoreOptions = {
    defaultState?: () => SyncState;
    getStateFilePath?: () => string;
    fileSystem?: Pick<typeof fs, 'existsSync' | 'mkdirSync' | 'readFileSync' | 'writeFileSync'>;
    pathModule?: Pick<typeof path, 'dirname'>;
};

function createFileStateStore({defaultState, getStateFilePath, fileSystem = fs, pathModule = path}: FileStateStoreOptions = {}) {
    if (typeof defaultState !== 'function' || typeof getStateFilePath !== 'function') {
        throw new Error('File state store requires defaultState and getStateFilePath');
    }
    let createDefaultState = defaultState;
    let stateFilePath = getStateFilePath;

    function ensureStateDir() {
        fileSystem.mkdirSync(pathModule.dirname(stateFilePath()), {recursive: true});
    }

    function loadState() {
        let file = stateFilePath();

        if (!fileSystem.existsSync(file)) {
            return saveState(createDefaultState());
        }

        return {
            ...createDefaultState(),
            ...JSON.parse(fileSystem.readFileSync(file, 'utf8'))
        };
    }

    function saveState<TState extends SyncState>(state: TState) {
        ensureStateDir();
        let nextState = {
            ...createDefaultState(),
            ...state
        } as unknown as TState;
        fileSystem.writeFileSync(stateFilePath(), JSON.stringify(nextState, null, 2), 'utf8');
        return nextState;
    }

    return {
        defaultState: createDefaultState,
        ensureStateDir,
        getStateFilePath: stateFilePath,
        loadState,
        saveState
    };
}

export { createFileStateStore };
export default {
    createFileStateStore
};
