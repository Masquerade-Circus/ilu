let fs = require('node:fs');
let path = require('node:path');
let localPaths = require('../utils/local-paths');

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

function write(clocks) {
    ensureStorageDir();
    fs.writeFileSync(getFilePath(), JSON.stringify(clocks, null, 2), 'utf8');
    return clocks;
}

module.exports = {
    find() {
        return read();
    },
    get(index) {
        return read()[index - 1];
    },
    add(clock) {
        let clocks = read();
        clocks.push({
            name: clock.name.trim(),
            timezone: clock.timezone.trim()
        });
        return write(clocks);
    },
    remove(index) {
        if (typeof index === 'number') {
            let clocks = read();
            clocks.splice(index - 1, 1);
            return write(clocks);
        }

        if (Array.isArray(index)) {
            let clocks = read();
            let indexes = [...new Set(index)]
                .map(value => parseInt(value, 10))
                .filter(value => Number.isInteger(value) && value > 0)
                .sort((left, right) => right - left);

            indexes.forEach(position => {
                clocks.splice(position - 1, 1);
            });

            return write(clocks);
        }

        return write([]);
    }
};
