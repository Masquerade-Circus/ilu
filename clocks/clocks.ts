import 'colors';
import prompts from '../utils/prompts.ts';
import * as __cjsImport12 from '../utils/index.ts';
const { log } = __cjsImport12;
import Model from './model.ts';
import type { Clock } from './model.ts';
import promptPriority from './priority-prompt.ts';
type TimezoneAlias = {
    label: string;
    value: string;
    terms: string[];
};

type ClockChoice = {
    name: string;
    value: number | string;
};

type PromptAnswer = Record<string, unknown>;

type ClockActionOptions = {
    add?: unknown;
    show?: unknown;
    priority?: unknown;
    remove?: number | boolean;
};

function hasOption(opts: ClockActionOptions, key: keyof ClockActionOptions) {
    return opts[key] !== void 0;
}

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

let TIMEZONE_ALIASES: TimezoneAlias[] = [
    {
        label: 'UTC (Etc/UTC)',
        value: 'Etc/UTC',
        terms: ['utc']
    }
];

function fail(message: string) {
    log.cross(message, 'red');
    process.exit(1);
}

function normalizeTimezone(timezone: unknown) {
    return String(timezone || '').trim();
}

function normalizeName(name: unknown) {
    return String(name || '').trim();
}

function normalizeSearch(search: unknown) {
    return String(search || '').trim().toLowerCase();
}

function getAvailableTimezones() {
    if (typeof Intl.supportedValuesOf === 'function') {
        try {
            let timezones = Intl.supportedValuesOf('timeZone');

            if (Array.isArray(timezones) && timezones.length > 0) {
                return timezones;
            }
        } catch {
            // fall back to local list
        }
    }

    return FALLBACK_TIMEZONES;
}

function searchTimezones(search: unknown) {
    let normalizedSearch = normalizeSearch(search);

    return getAvailableTimezones()
        .filter((timezone) => normalizedSearch.length === 0 || timezone.toLowerCase().includes(normalizedSearch));
}

function searchTimezoneChoices(search: unknown = ''): ClockChoice[] {
    let normalizedSearch = normalizeSearch(search);
    let choices: ClockChoice[] = [];
    let seen = new Set<string>();

    TIMEZONE_ALIASES
        .filter((alias) => normalizedSearch.length === 0 || alias.terms.some((term) => term.includes(normalizedSearch) || normalizedSearch.includes(term)))
        .forEach((alias) => {
            if (seen.has(alias.value)) {
                return;
            }

            seen.add(alias.value);
            choices.push({name: alias.label, value: alias.value});
        });

    searchTimezones(search).forEach((timezone) => {
        if (seen.has(timezone)) {
            return;
        }

        seen.add(timezone);
        choices.push({name: timezone, value: timezone});
    });

    return choices;
}

function getClockChoice(item: Clock, index: number) {
    return {
        name: `${index + 1} ${item.name} (${item.timezone})`,
        value: index + 1
    };
}

function validTimezone(timezone: string) {
    try {
        Intl.DateTimeFormat(undefined, {timeZone: timezone}).format(new Date());
        return true;
    } catch {
        return false;
    }
}

function formatTime(timezone: string) {
    return new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }).format(new Date());
}

let Clocks = {
    get(index: number) {
        let item = Model.get(index);

        if (!item) {
            fail(`The clock "${index}" does not exists`);
            return;
        }

        return item;
    },
    async add() {
        let timezoneAnswer = await prompts.prompt([
            {
                type: 'search',
                name: 'timezone',
                message: 'Search and select a timezone',
                choices: searchTimezoneChoices()
            }
        ]);
        let nameAnswer = await prompts.prompt([
            {
                type: 'input',
                name: 'name',
                message: 'Name of the clock',
                suffix: ' (required)',
                validate(value: unknown) {
                    return normalizeName(value).length > 0 || 'Please provide a name';
                }
            }
        ]);

        let timezone = normalizeTimezone((timezoneAnswer as PromptAnswer).timezone);
        let name = normalizeName((nameAnswer as PromptAnswer).name);

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

        let move = await promptPriority({clocks: clocks.map((clock) => ({...clock}))});

        if (move && move.fromPosition !== move.toPosition) {
            Model.move(move);
        }

        Clocks.show();
    },
    async remove(index: number | boolean) {
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

        let answers = await prompts.prompt([
            {
                type: 'checkbox',
                name: 'indexes',
                message: 'Select clocks to remove.',
                choices: clocks.map(getClockChoice),
                validate(value: unknown) {
                    return Array.isArray(value) && value.length > 0 || 'Please select at least one clock';
                }
            }
        ]);

        let indexes = (answers as PromptAnswer).indexes;
        let selectedIndexes = Array.isArray(indexes) ? indexes : [];

        Model.remove(selectedIndexes as Array<number | string>);
        log.info(`${selectedIndexes.length} ${selectedIndexes.length === 1 ? 'clock has' : 'clocks have'} been removed.`);

        if (Model.find().length > 0) {
            Clocks.show();
        }

    },
    async actions(args: unknown[], opts: ClockActionOptions) {
        switch (true) {
            case hasOption(opts, 'add'): await Clocks.add(); break;
            case hasOption(opts, 'show'): Clocks.show(); break;
            case hasOption(opts, 'priority'): await Clocks.priority(); break;
            case hasOption(opts, 'remove'): await Clocks.remove(opts.remove as number | boolean); break;
            default: Clocks.show(); break;
        }
    }
};

export const add = Clocks.add;
export const show = Clocks.show;
export const priority = Clocks.priority;
export const remove = Clocks.remove;
export const actions = Clocks.actions;
export default Clocks;
