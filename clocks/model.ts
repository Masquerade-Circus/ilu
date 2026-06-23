let fs = require('node:fs');
let path = require('node:path');
let localPaths = require('../utils/local-paths');
let notifySync = require('../sync/ilu-hooks');

function afterPersist(action: any) {
    notifySync({domain: 'clocks', action});
}

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

module.exports = {
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
