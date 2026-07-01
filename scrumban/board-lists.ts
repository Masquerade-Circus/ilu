import isUndefined from 'lodash/isUndefined.js';
import prompts from '../utils/prompts.ts';
import * as __cjsImport19 from '../utils/index.ts';
const { required, log } = __cjsImport19;
import Model from './model.ts';
import type { BoardItem } from './model.ts';
import * as __cjsImport20 from '../utils/prompt-index-selection.ts';
const { selectOne, selectMany } = __cjsImport20;
let SIMPLE_DEFAULT_COLUMNS = ['Backlog', 'Ready', 'In Progress', 'Done'];

type PromptColumn = {
    id: string;
    title: string;
};

type BoardListOptions = Record<string, unknown>;

function sanitizeColumnId(value: unknown) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function buildPromptColumns(columns: string[]) {
    let usedIds = new Set<string>();

    return columns.map((title: string): PromptColumn => {
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

function parseInitialColumns(value: unknown) {
    let titles = String(value || '')
        .split(',')
        .map((item: string) => item.trim())
        .filter(Boolean);

    if (titles.length === 0) {
        titles = SIMPLE_DEFAULT_COLUMNS;
    }

    return buildPromptColumns(titles);
}

function getBoardChoiceName(item: BoardItem) {
    return item.current ? `${item.index} ${item.title} (current)` : `${item.index} ${item.title}`;
}

async function selectBoardIndex(message: string) {
    return selectOne(Model.find(), {
        message,
        emptyMessage: 'You dont have any boards, try adding one.',
        getChoiceName: getBoardChoiceName
    });
}

async function selectBoardIndexes(message: string) {
    return selectMany(Model.find(), {
        message,
        emptyMessage: 'You dont have any boards, try adding one.',
        getChoiceName: getBoardChoiceName
    });
}

let BoardLists = {
    get(index: number): BoardItem {
        let item = Model.findOne({index});
        if (!item) {
            log.warning(`The board "${index}" does not exists`.yellow, 'yellow');
            process.exit(1);
            throw new Error('Board selection failed');
        }
        return item;
    },
    getCurrent(): BoardItem {
        let item = Model.getCurrent();
        if (!item) {
            log.info(`You dont have any boards, try adding one.`.blue, 'blue');
            process.exit(1);
            throw new Error('Current board selection failed');
        }
        return item;
    },
    async add() {
        let answers = await prompts.prompt([
            {type: 'input', name: 'title', message: 'Title of the board', suffix: ' (required)', validate: required('title')},
            {type: 'input', name: 'description', message: 'Description of the board'},
            {type: 'input', name: 'columns', message: 'Initial columns (comma-separated)', default: SIMPLE_DEFAULT_COLUMNS.join(', ')}
        ]);

        let columns = parseInitialColumns(answers.columns);
        let defaultColumnChoices = columns.map((column: PromptColumn) => ({name: column.title, value: column.id}));
        let defaultColumn = await prompts.prompt([
            {
                type: 'search',
                name: 'defaultColumnId',
                message: 'Default column for new cards',
                choices: defaultColumnChoices,
                default: columns[0].id
            }
        ]);

        Model.add({
            title: answers.title,
            description: answers.description,
            columns: columns.map((column: PromptColumn) => ({title: column.title})),
            defaultColumnId: defaultColumn.defaultColumnId
        });
        BoardLists.show();
    },
    async edit(index: unknown) {
        let boardIndex = typeof index === 'number'
            ? index
            : await selectBoardIndex('Select the board to edit');

        let item = BoardLists.get(boardIndex);
        let answers = await prompts.prompt([
            {type: 'input', name: 'title', message: 'Title of the board', suffix: ' (required)', validate: required('title'), default: item.title},
            {type: 'input', name: 'description', message: 'Description of the board', default: item.description}
        ]);

        Object.assign(item, answers);
        Model.save(item);
        BoardLists.show();
    },
    show() {
        let boards = Model.find();

        if (boards.length === 0) {
            log.info(`You dont have any boards, try adding one.`.blue, 'blue');
            process.exit(1);
            return;
        }

        boards.forEach((item: BoardItem) => {
            let str = `${item.index} ${item.title}`;
            if (item.current) {
                log.pointerSmall(str.cyan + ' (current)'.gray, 'cyan');
                return;
            }
            log.pointerSmall(str);
        });
    },
    async use(index: unknown) {
        let boardIndex = typeof index === 'number'
            ? index
            : await selectBoardIndex('Select the board to use');

        let item = BoardLists.get(boardIndex);
        Model.use(item.$id ?? item.id ?? item.index);
        BoardLists.show();
    },
    async remove(index: unknown) {
        let indexes = typeof index === 'number'
            ? [index]
            : await selectBoardIndexes('Select the boards to remove');

        let items = indexes.map((position: number) => BoardLists.get(position));
        items.forEach((item: BoardItem) => Model.remove(item));

        let current = Model.getCurrent();
        if (!current) {
            let first = Model.getFirst();
            if (first) {
                Model.use(first.$id ?? first.id ?? first.index);
            }
        }

        let message = indexes.length === 1
            ? `The board "${indexes[0]}" has been removed.`
            : `${indexes.length} boards have been removed.`;
        log.info(message.blue, 'blue');

        BoardLists.show();
    },
    async details(index: unknown) {
        let boardIndex = typeof index === 'number'
            ? index
            : await selectBoardIndex('Select the board to show');

        let item = BoardLists.get(boardIndex);
        log('Title'.gray);
        log(item.title.cyan, 4);

        if (item.description.trim().length > 0) {
            log('Description'.gray);
            log(item.description.cyan, 4);
        }

        if (item.columns.length > 0) {
            log('Columns'.gray);
            item.columns.forEach((column, columnIndex: number) => {
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
    async actions(args: unknown, opts: BoardListOptions) {
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

export const add = BoardLists.add;
export const details = BoardLists.details;
export const edit = BoardLists.edit;
export const use = BoardLists.use;
export const remove = BoardLists.remove;
export const show = BoardLists.show;
export const actions = BoardLists.actions;
export default BoardLists;
