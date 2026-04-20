require('colors');

let inquirer = require('../utils/inquirer');
let {log} = require('../utils');
let Model = require('./model');
let isUndefined = require('lodash/isUndefined');

let FALLBACK_TIMEZONES = [
    'America/Mexico_City',
    'America/Monterrey',
    'America/New_York',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Madrid',
    'Etc/UTC',
    'Asia/Tokyo'
];

function fail(message) {
    log.cross(message, 'red');
    process.exit(1);
}

function normalizeTimezone(timezone) {
    return String(timezone || '').trim();
}

function normalizeName(name) {
    return String(name || '').trim();
}

function normalizeSearch(search) {
    return String(search || '').trim().toLowerCase();
}

function getAvailableTimezones() {
    if (typeof Intl.supportedValuesOf === 'function') {
        try {
            let timezones = Intl.supportedValuesOf('timeZone');

            if (Array.isArray(timezones) && timezones.length > 0) {
                return timezones;
            }
        } catch (error) {
            // fall back to local list
        }
    }

    return FALLBACK_TIMEZONES;
}

function searchTimezones(search) {
    let normalizedSearch = normalizeSearch(search);

    return getAvailableTimezones()
        .filter(timezone => timezone.toLowerCase().includes(normalizedSearch))
        .slice(0, 20);
}

function getClockChoice(item, index) {
    return {
        name: `${index + 1} ${item.name} (${item.timezone})`,
        value: index + 1
    };
}

function validTimezone(timezone) {
    try {
        Intl.DateTimeFormat(undefined, {timeZone: timezone}).format(new Date());
        return true;
    } catch (error) {
        return false;
    }
}

function formatTime(timezone) {
    return new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(new Date());
}

let Clocks = {
    get(index) {
        let item = Model.get(index);

        if (!item) {
            fail(`The clock "${index}" does not exists`);
            return;
        }

        return item;
    },
    async add() {
        let searchAnswer = await inquirer.prompt([
            {
                type: 'input',
                name: 'search',
                message: 'Search timezone',
                suffix: ' (required)',
                validate(value) {
                    return searchTimezones(value).length > 0 || 'Please provide a search with matching timezones';
                }
            }
        ]);
        let matches = searchTimezones(searchAnswer.search);
        let timezoneAnswer = await inquirer.prompt([
            {
                type: 'select',
                name: 'timezone',
                message: 'Select a timezone',
                choices: matches.map(timezone => ({name: timezone, value: timezone}))
            }
        ]);
        let nameAnswer = await inquirer.prompt([
            {
                type: 'input',
                name: 'name',
                message: 'Name of the clock',
                suffix: ' (required)',
                validate(value) {
                    return normalizeName(value).length > 0 || 'Please provide a name';
                }
            }
        ]);

        let timezone = normalizeTimezone(timezoneAnswer.timezone);
        let name = normalizeName(nameAnswer.name);

        if (!validTimezone(timezone)) {
            fail('Invalid timezone. Please provide a valid IANA timezone.');
            return;
        }

        if (name.length === 0) {
            fail('Clock name is required.');
            return;
        }

        Model.add({timezone, name});
        Clocks.show();
    },
    show() {
        let clocks = Model.find();

        if (clocks.length === 0) {
            log.info('You dont have any clocks, try adding one.');
            process.exit(1);
            return;
        }

        clocks.forEach((item, index) => {
            log.pointerSmall(`${index + 1} ${formatTime(item.timezone).cyan.bold} - ${item.name.white} ${`(${item.timezone})`.gray}`);
        });
    },
    async remove(index) {
        if (typeof index === 'number') {
            Clocks.get(index);
            Model.remove(index);
            log.info(`The clock "${index}" has been removed.`);

            if (Model.find().length > 0) {
                Clocks.show();
            }

            return;
        }

        let clocks = Model.find();

        if (clocks.length === 0) {
            log.info('You dont have any clocks, try adding one.');
            process.exit(1);
            return;
        }

        let answers = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'indexes',
                message: 'Select clocks to remove.',
                choices: clocks.map(getClockChoice),
                validate(value) {
                    return value.length > 0 || 'Please select at least one clock';
                }
            }
        ]);

        Model.remove(answers.indexes);
        log.info(`${answers.indexes.length} ${answers.indexes.length === 1 ? 'clock has' : 'clocks have'} been removed.`);

        if (Model.find().length > 0) {
            Clocks.show();
        }

    },
    async actions(args, opts) {
        switch (true) {
            case !isUndefined(opts.add): await Clocks.add(); break;
            case !isUndefined(opts.show): Clocks.show(); break;
            case !isUndefined(opts.remove): await Clocks.remove(opts.remove); break;
            default: Clocks.show(); break;
        }
    }
};

module.exports = Clocks;
