require('colors');

let inquirer = require('../utils/inquirer');
let {log} = require('../utils');
let Model = require('./model');
let promptPriority = require('./priority-prompt');
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

let TIMEZONE_ALIASES = [
    {
        label: 'UTC (Etc/UTC)',
        value: 'Etc/UTC',
        terms: ['utc']
    }
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
        .filter(timezone => normalizedSearch.length === 0 || timezone.toLowerCase().includes(normalizedSearch))
        .slice(0, 20);
}

function searchTimezoneChoices(search) {
    let normalizedSearch = normalizeSearch(search);
    let choices = [];
    let seen = new Set();

    TIMEZONE_ALIASES
        .filter(alias => normalizedSearch.length > 0 && alias.terms.some(term => term.includes(normalizedSearch) || normalizedSearch.includes(term)))
        .forEach(alias => {
            if (seen.has(alias.value)) {
                return;
            }

            seen.add(alias.value);
            choices.push({name: alias.label, value: alias.value});
        });

    searchTimezones(search).forEach(timezone => {
        if (seen.has(timezone)) {
            return;
        }

        seen.add(timezone);
        choices.push({name: timezone, value: timezone});
    });

    return choices.slice(0, 20);
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
        let timezoneAnswer = await inquirer.prompt([
            {
                type: 'search',
                name: 'timezone',
                message: 'Search and select a timezone',
                source(search) {
                    return searchTimezoneChoices(search);
                }
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
    async priority() {
        let clocks = Model.find();

        if (clocks.length < 2) {
            log.info('You need at least two clocks to change their priority.');

            if (clocks.length > 0) {
                Clocks.show();
            }

            return;
        }

        let move = await promptPriority({clocks: clocks.map(clock => ({...clock}))});

        if (move && move.fromPosition !== move.toPosition) {
            Model.move(move);
        }

        Clocks.show();
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
            case !isUndefined(opts.priority): await Clocks.priority(); break;
            case !isUndefined(opts.remove): await Clocks.remove(opts.remove); break;
            default: Clocks.show(); break;
        }
    }
};

module.exports = Clocks;
