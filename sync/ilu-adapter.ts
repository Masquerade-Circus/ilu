import fs from 'node:fs';
import localPaths from '../utils/local-paths.ts';
import configStore from '../utils/config-store.ts';
const IGNORE_PATTERNS = [
    '.config/**'
];

function getSyncConfig() {
    return configStore.getSyncConfig({fs, paths: localPaths});
}

const __defaultExport = {
    getSourceRoot() {
        return localPaths.storageDirPath();
    },
    getIgnorePatterns() {
        return [...IGNORE_PATTERNS];
    },
    getSyncConfig,
    buildCommitMessage(context: any = {}) {
        let domain = context.domain || 'data';
        let action = context.action || 'save';
        return `sync(${domain}): ${action} local data snapshot`;
    }
};

export const getSourceRoot = __defaultExport.getSourceRoot;
export const getIgnorePatterns = __defaultExport.getIgnorePatterns;
export { getSyncConfig };
export const buildCommitMessage = __defaultExport.buildCommitMessage;
export default __defaultExport;
