import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import localPaths from '../utils/local-paths.ts';
import * as __cjsImport13 from '../utils/persistence-sync.ts';
const { createPersistenceNotifier } = __cjsImport13;
let afterPersist = createPersistenceNotifier('clocks');

export type Clock = {
    name: string;
    timezone: string;
};

export type ClockMove = {
    fromPosition: number;
    toPosition: number;
};

function getFilePath() {
    return localPaths.dbFilePath('clocks');
}

function ensureStorageDir() {
    fs.mkdirSync(path.dirname(getFilePath()), {recursive: true});
}

function read(): Clock[] {
    let file = getFilePath();

    if (!fs.existsSync(file)) {
        return [];
    }

    return JSON.parse(fs.readFileSync(file, 'utf8')) as Clock[];
}

function mutate(update: (clocks: Clock[]) => Clock[]) {
    ensureStorageDir();
    const privateDir = localPaths.syncDirPath();
    fs.mkdirSync(privateDir, {recursive: true});
    const lockPath = path.join(privateDir, 'clocks-write.lock');
    let lock: number;
    try {
        lock = fs.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error('Clocks are being updated by another process. Try again. If the previous process stopped unexpectedly, remove .ilu/.config/clocks-write.lock after confirming no clock writer is active.');
        }
        throw error;
    }
    const pendingFile = path.join(privateDir, `clocks-${randomUUID()}.json`);
    let clocks: Clock[];
    try {
        clocks = update(read());
        fs.writeFileSync(pendingFile, JSON.stringify(clocks, null, 2), 'utf8');
        fs.renameSync(pendingFile, getFilePath());
    } finally {
        try {
            fs.rmSync(pendingFile, {force: true});
        } finally {
            fs.closeSync(lock);
            fs.unlinkSync(lockPath);
        }
    }
    afterPersist('save');
    return clocks;
}

const __defaultExport = {
    find() {
        return read();
    },
    get(index: number) {
        return read()[index - 1];
    },
    add(clock: Clock) {
        return mutate((clocks) => {
            clocks.push({name: clock.name.trim(), timezone: clock.timezone.trim()});
            return clocks;
        });
    },
    remove(index: number | Array<number | string> | unknown) {
        if (typeof index === 'number') {
            return mutate((clocks) => {
                clocks.splice(index - 1, 1);
                return clocks;
            });
        }

        if (Array.isArray(index)) {
            let indexes = [...new Set(index)]
                .map((value) => parseInt(String(value), 10))
                .filter((value) => Number.isInteger(value) && value > 0)
                .sort((left, right) => right - left);

            return mutate((clocks) => {
                indexes.forEach((position) => clocks.splice(position - 1, 1));
                return clocks;
            });
        }

        return mutate(() => []);
    },
    move({fromPosition, toPosition}: ClockMove) {
        return mutate((clocks) => {
            let [clock] = clocks.splice(fromPosition - 1, 1);
            if (clock) {
                clocks.splice(toPosition - 1, 0, clock);
            }
            return clocks;
        });
    }
};
export default __defaultExport;
