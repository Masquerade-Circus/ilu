let isUndefined = require('lodash/isUndefined');
let inquirer = require('../utils/inquirer');
let {required, log} = require('../utils');
let Model = require('./model');
let {selectOne, selectMany} = require('../utils/prompt-index-selection');

let SIMPLE_DEFAULT_COLUMNS = ['Backlog', 'Ready', 'In Progress', 'Done'];

function sanitizeColumnId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function buildPromptColumns(columns) {
    let usedIds = new Set();

    return columns.map(title => {
        let baseId = sanitizeColumnId(title) || 'column';
        let id = baseId;
        let suffix = 2;

        while (usedIds.has(id)) {
            id = `${baseId}-${suffix}`;
            suffix += 1;
        }

        usedIds.add(id);

        return {
            id,
            title
        };
    });
}

function parseInitialColumns(value) {
    let titles = String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

    if (titles.length === 0) {
        titles = SIMPLE_DEFAULT_COLUMNS;
    }

    return buildPromptColumns(titles);
}

function getBoardChoiceName(item) {
    return item.current ? `${item.index} ${item.title} (current)` : `${item.index} ${item.title}`;
}

async function selectBoardIndex(message) {
    return selectOne(Model.find(), {
        message,
        emptyMessage: 'You dont have any boards, try adding one.',
        getChoiceName: getBoardChoiceName
    });
}

async function selectBoardIndexes(message) {
    return selectMany(Model.find(), {
        message,
        emptyMessage: 'You dont have any boards, try adding one.',
        getChoiceName: getBoardChoiceName
    });
}

let BoardLists = {
    get(index) {
        let item = Model.findOne({index});
        if (!item) {
            log.warning(`The board "${index}" does not exists`.yellow, 'yellow');
            process.exit(1);
            return;
        }
        return item;
    },
    getCurrent() {
        let item = Model.getCurrent();
        if (!item) {
            log.info(`You dont have any boards, try adding one.`.blue, 'blue');
            process.exit(1);
            return;
        }
        return item;
    },
    async add() {
        let answers = await inquirer.prompt([
            {type: 'input', name: 'title', message: 'Title of the board', suffix: ' (required)', validate: required('title')},
            {type: 'input', name: 'description', message: 'Description of the board'},
            {type: 'input', name: 'columns', message: 'Initial columns (comma-separated)', default: SIMPLE_DEFAULT_COLUMNS.join(', ')}
        ]);

        let columns = parseInitialColumns(answers.columns);
        let defaultColumn = await inquirer.prompt([
            {
                type: 'select',
                name: 'defaultColumnId',
                message: 'Default column for new cards',
                choices: columns.map(column => ({name: column.title, value: column.id})),
                default: columns[0].id
            }
        ]);

        Model.add({
            title: answers.title,
            description: answers.description,
            columns: columns.map(column => ({title: column.title})),
            defaultColumnId: defaultColumn.defaultColumnId
        });
        BoardLists.show();
    },
    async edit(index) {
        if (typeof index !== 'number') {
            index = await selectBoardIndex('Select the board to edit');
        }

        let item = BoardLists.get(index);
        let answers = await inquirer.prompt([
            {type: 'input', name: 'title', message: 'Title of the board', suffix: ' (required)', validate: required('title'), default: item.title},
            {type: 'input', name: 'description', message: 'Description of the board', default: item.description}
        ]);

        Object.assign(item, answers);
        Model.save(item);
        BoardLists.show();
    },
    show() {
        let boards = Model.find();
        console.clear();

        if (boards.length === 0) {
            log.info(`You dont have any boards, try adding one.`.blue, 'blue');
            process.exit(1);
            return;
        }

        boards.forEach(item => {
            let str = `${item.index} ${item.title}`;
            if (item.current) {
                log.pointerSmall(str.cyan + ' (current)'.gray, 'cyan');
                return;
            }
            log.pointerSmall(str);
        });
    },
    async use(index) {
        if (typeof index !== 'number') {
            index = await selectBoardIndex('Select the board to use');
        }

        let item = BoardLists.get(index);
        Model.use(item.$id);
        BoardLists.show();
    },
    async remove(index) {
        let indexes = typeof index === 'number'
            ? [index]
            : await selectBoardIndexes('Select the boards to remove');

        let items = indexes.map(position => BoardLists.get(position));
        items.forEach(item => Model.remove(item));

        let current = Model.getCurrent();
        if (!current) {
            let first = Model.getFirst();
            if (first) {
                Model.use(first.$id);
            }
        }

        let message = indexes.length === 1
            ? `The board "${indexes[0]}" has been removed.`
            : `${indexes.length} boards have been removed.`;
        log.info(message.blue, 'blue');

        BoardLists.show();
    },
    async details(index) {
        if (typeof index !== 'number') {
            index = await selectBoardIndex('Select the board to show');
        }

        let item = BoardLists.get(index);
        log('Title'.gray);
        log(item.title.cyan, 4);

        if (item.description.trim().length > 0) {
            log('Description'.gray);
            log(item.description.cyan, 4);
        }

        if (item.columns.length > 0) {
            log('Columns'.gray);
            item.columns.forEach((column, columnIndex) => {
                let suffix = column.wipLimit === null || typeof column.wipLimit === 'undefined'
                    ? ''
                    : ` (WIP ${column.wipLimit})`;
                log(`${columnIndex + 1} ${column.title}${suffix}`.cyan, 4);
            });
        }
    },
    async current() {
        let item = BoardLists.getCurrent();
        await BoardLists.details(item.index);
    },
    async actions(args, opts) {
        switch (true) {
            case !isUndefined(opts.add): await BoardLists.add(); break;
            case !isUndefined(opts.edit): await BoardLists.edit(opts.edit); break;
            case !isUndefined(opts.details): await BoardLists.details(opts.details); break;
            case !isUndefined(opts.show): BoardLists.show(); break;
            case !isUndefined(opts.use): await BoardLists.use(opts.use); break;
            case !isUndefined(opts.remove): await BoardLists.remove(opts.remove); break;
            case !isUndefined(opts.current): await BoardLists.current(); break;
            default: BoardLists.show(); break;
        }
    }
};

module.exports = BoardLists;
