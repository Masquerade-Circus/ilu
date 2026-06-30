import fs from 'node:fs';
import path from 'node:path';
import localPaths from '../utils/local-paths.ts';
import * as __cjsImport13 from '../utils/persistence-sync.ts';
const { createPersistenceNotifier } = __cjsImport13;
let afterPersist = createPersistenceNotifier('clocks');

function getFilePath() {
    return localPaths.dbFilePath('clocks');
}

function ensureStorageDir() {
    fs.mkdirSync(path.dirname(getFilePath()), {recursive: true});
}

function read() {
    let file = getFilePath();

    if (!fs.existsSync(file)) {
        return [];
    }

    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function write(clocks: any) {
    ensureStorageDir();
    fs.writeFileSync(getFilePath(), JSON.stringify(clocks, null, 2), 'utf8');
    afterPersist('save');
    return clocks;
}

const __defaultExport = {
    find() {
        return read();
    },
    get(index: any) {
        return read()[index - 1];
    },
    add(clock: any) {
        let clocks = read();
        clocks.push({
            name: clock.name.trim(),
            timezone: clock.timezone.trim()
        });
        return write(clocks);
    },
    remove(index: any) {
        if (typeof index === 'number') {
            let clocks = read();
            clocks.splice(index - 1, 1);
            return write(clocks);
        }

        if (Array.isArray(index)) {
            let clocks = read();
            let indexes = [...new Set(index)]
                .map((value: any) => parseInt(value, 10))
                .filter((value: any) => Number.isInteger(value) && value > 0)
                .sort((left: any, right: any) => right - left);

            indexes.forEach((position: any) => {
                clocks.splice(position - 1, 1);
            });

            return write(clocks);
        }

        return write([]);
    },
    move({fromPosition, toPosition}: any) {
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
