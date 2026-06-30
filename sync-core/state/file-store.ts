import fs from 'node:fs';
import path from 'node:path';
function createFileStateStore({defaultState, getStateFilePath, fileSystem = fs, pathModule = path}: any = {}) {
    if (typeof defaultState !== 'function' || typeof getStateFilePath !== 'function') {
        throw new Error('File state store requires defaultState and getStateFilePath');
    }

    function ensureStateDir() {
        fileSystem.mkdirSync(pathModule.dirname(getStateFilePath()), {recursive: true});
    }

    function loadState() {
        let file = getStateFilePath();

        if (!fileSystem.existsSync(file)) {
            return saveState(defaultState());
        }

        return {
            ...defaultState(),
            ...JSON.parse(fileSystem.readFileSync(file, 'utf8'))
        };
    }

    function saveState(state: any) {
        ensureStateDir();
        let nextState = {
            ...defaultState(),
            ...state
        };
        fileSystem.writeFileSync(getStateFilePath(), JSON.stringify(nextState, null, 2), 'utf8');
        return nextState;
    }

    return {
        defaultState,
        ensureStateDir,
        getStateFilePath,
        loadState,
        saveState
    };
}

export { createFileStateStore };
export default {
    createFileStateStore
};
