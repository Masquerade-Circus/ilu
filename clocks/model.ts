import fs from 'node:fs';
import path from 'node:path';
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

function write(clocks: Clock[]) {
    ensureStorageDir();
    fs.writeFileSync(getFilePath(), JSON.stringify(clocks, null, 2), 'utf8');
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
        let clocks = read();
        clocks.push({
            name: clock.name.trim(),
            timezone: clock.timezone.trim()
        });
        return write(clocks);
    },
    remove(index: number | Array<number | string> | unknown) {
        if (typeof index === 'number') {
            let clocks = read();
            clocks.splice(index - 1, 1);
            return write(clocks);
        }

        if (Array.isArray(index)) {
            let clocks = read();
            let indexes = [...new Set(index)]
                .map((value) => parseInt(String(value), 10))
                .filter((value) => Number.isInteger(value) && value > 0)
                .sort((left, right) => right - left);

            indexes.forEach((position) => {
                clocks.splice(position - 1, 1);
            });

            return write(clocks);
        }

        return write([]);
    },
    move({fromPosition, toPosition}: ClockMove) {
        let clocks = read();
        let [clock] = clocks.splice(fromPosition - 1, 1);

        if (!clock) {
            return clocks;
        }

        clocks.splice(toPosition - 1, 0, clock);
        return write(clocks);
    }
};
export default __defaultExport;
