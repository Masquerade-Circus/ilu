import loadDb from '../utils/load-db.ts';
import * as __cjsImport24 from '../utils/persistence-sync.ts';
const { createPersistenceNotifier } = __cjsImport24;

export type BoardId = number | string;

export type BoardCard = {
    title: string;
    description: string;
    position: number;
};

export type BoardColumn = {
    id: string;
    title: string;
    wipLimit: number | null;
    cards: BoardCard[];
    index?: number;
};

export type BoardItem = {
    $id?: BoardId;
    id?: BoardId;
    title: string;
    description: string;
    current: boolean;
    index: number;
    defaultColumnId: string;
    columns: BoardColumn[];
};

type BoardDraft = {
    title: string;
    description: string;
    current?: boolean;
    index?: number;
    defaultColumnId?: string;
    columns?: BoardColumnInput[];
};

type BoardColumnInput = {
    id?: string;
    title: string;
    wipLimit?: number | null;
};

type BoardCardInput = {
    title: string;
    description?: string;
};

type BoardQuery = Record<string, unknown>;
type BoardFindOptions = {sort?: Record<string, 1 | -1>};

type BoardCollection = {
    get(id: BoardId): BoardItem;
    find(query?: BoardQuery, options?: BoardFindOptions): BoardItem[];
    findOne(query?: BoardQuery, options?: BoardFindOptions): BoardItem;
    update(board: BoardItem): BoardItem;
    add(board: BoardItem): BoardItem;
    remove(board: BoardItem): void;
    count(): number;
};

type BoardColumnActions = {
    add(values: BoardColumnInput): BoardItem;
    edit(index: number, values: Partial<BoardColumnInput>): BoardItem;
    setDefault(index: number): BoardItem;
    reorder(values: {fromIndex: number; toIndex: number}): BoardItem;
    remove(index: number): BoardItem;
    resetSimpleDefault(): BoardItem;
};

type BoardCardActions = {
    add(values: BoardCardInput, options?: {columnIndex?: number}): BoardItem;
    edit(values: {columnIndex: number; position: number; values: Partial<BoardCardInput>}): BoardItem;
    remove(values: {columnIndex: number; positions: Iterable<number>}): BoardItem;
    moveMany(values: {cards: Array<{fromColumn: number; fromPosition: number}>; toColumn: number}): BoardItem;
    move(values: {fromColumn: number; fromPosition: number; toColumn: number; toPosition?: number}): BoardItem;
};

type BoardModel = {
    collection: BoardCollection;
    columns: BoardColumnActions;
    cards: BoardCardActions;
    get(id: BoardId): BoardItem;
    find(query?: BoardQuery, options?: BoardFindOptions): BoardItem[];
    findOne(query?: BoardQuery, options?: BoardFindOptions): BoardItem;
    save(board: BoardItem): BoardItem;
    add(item: BoardDraft): BoardItem;
    remove(item?: BoardItem | null): void;
    updateIndexes(): void;
    getCurrent(): BoardItem;
    getFirst(): BoardItem;
    use(id: BoardId): BoardItem;
    getLast?: unknown;
    addColumn?: unknown;
    editColumn?: unknown;
    removeColumn?: unknown;
    reorderColumns?: unknown;
    setDefaultColumn?: unknown;
    move?: unknown;
};

type BoardCardSelection = {
    fromColumn: number;
    fromPosition: number;
    column: BoardColumn;
};

type GroupedPositions = Record<number, number[]>;

let DEFAULT_COLUMNS: BoardColumnInput[] = [
    {id: 'backlog', title: 'Backlog', wipLimit: null},
    {id: 'ready', title: 'Ready', wipLimit: null},
    {id: 'in-progress', title: 'In Progress', wipLimit: null},
    {id: 'done', title: 'Done', wipLimit: null}
];

let DEFAULT_COLUMN_ID = 'backlog';

let afterPersist = createPersistenceNotifier('boards');

function sanitizeColumnId(value: unknown) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function ensureUniqueColumnId(baseId: string, usedIds: Set<string>) {
    let nextId = baseId || 'column';
    let suffix = 2;

    while (usedIds.has(nextId)) {
        nextId = `${baseId || 'column'}-${suffix}`;
        suffix += 1;
    }

    usedIds.add(nextId);
    return nextId;
}

function cloneColumn(column: BoardColumnInput, usedIds: Set<string>): BoardColumn {
    return {
        id: ensureUniqueColumnId(sanitizeColumnId(column.id || column.title), usedIds),
        title: (column.title || '').trim(),
        wipLimit: normalizeWipLimit(column.wipLimit ?? null),
        cards: []
    };
}

function cloneDefaultColumns() {
    let usedIds = new Set<string>();
    return DEFAULT_COLUMNS.map((column: BoardColumnInput, index: number) => ({
        ...cloneColumn(column, usedIds),
        index: index + 1
    }));
}

function cloneColumns(columns: BoardColumnInput[] = []) {
    let usedIds = new Set<string>();
    return columns.map((column: BoardColumnInput, index: number) => ({
        ...cloneColumn(column, usedIds),
        index: index + 1
    }));
}

function normalizeCards(column: BoardColumn) {
    column.cards.forEach((card: BoardCard, index: number) => {
        card.position = index + 1;
    });
}

function normalizeColumns(board: BoardItem) {
    board.columns.forEach((column: BoardColumn, index: number) => {
        if (!column.id) {
            column.id = sanitizeColumnId(column.title);
        }
        column.index = index + 1;
        column.wipLimit = normalizeWipLimit(column.wipLimit ?? null);
        if (!Array.isArray(column.cards)) {
            column.cards = [];
        }
        normalizeCards(column);
    });
}

function getColumn(board: BoardItem, index: number) {
    return board.columns[index - 1];
}

function assertColumn(board: BoardItem, index: number) {
    if (!Number.isInteger(index) || index < 1 || index > board.columns.length) {
        throw new Error('Invalid column position');
    }

    return getColumn(board, index);
}

function assertCard(column: BoardColumn, position: number) {
    if (!Number.isInteger(position) || position < 1 || position > column.cards.length) {
        throw new Error('Invalid card position');
    }

    return column.cards[position - 1];
}

function getColumnIndexById(board: BoardItem, columnId: string) {
    return board.columns.findIndex((column: BoardColumn) => column.id === columnId);
}

function getDefaultColumn(board: BoardItem): BoardColumn {
    let columnIndex = getColumnIndexById(board, board.defaultColumnId);
    if (columnIndex < 0) {
        throw new Error('Board default column must match an existing column');
    }

    return board.columns[columnIndex];
}

function validateDefaultColumn(board: BoardItem) {
    if (!board.defaultColumnId || getColumnIndexById(board, board.defaultColumnId) < 0) {
        throw new Error('Board default column must match an existing column');
    }
}

function hasCapacity(column: BoardColumn) {
    return column.wipLimit === null || column.cards.length < column.wipLimit;
}

function normalizeWipLimit(value: unknown): number | null {
    if (value === null) {
        return null;
    }

    if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
        return value;
    }

    throw new Error('WIP limit must be null or an integer greater than or equal to 1');
}

function prepareCard(card: BoardCardInput): BoardCard {
    return {
        title: card.title.trim() || '',
        description: (card.description || '').trim(),
        position: 0
    };
}

let DB = loadDb('boards');

let Model = {
    collection: DB.getCollection('boards') as BoardCollection,
    get(id: BoardId) {
        return Model.collection.get(id);
    },
    find(query: BoardQuery = {}, options: BoardFindOptions = {sort: {index: 1}}) {
        return Model.collection.find(query, options);
    },
    findOne(query: BoardQuery = {}, options: BoardFindOptions = {sort: {index: 1}}) {
        return Model.collection.findOne(query, options);
    },
    save(board: BoardItem) {
        validateDefaultColumn(board);
        normalizeColumns(board);
        let saved = Model.collection.update(board);
        afterPersist('save');
        return saved;
    },
    add(item: BoardDraft) {
        let columns = Array.isArray(item.columns) && item.columns.length > 0
            ? cloneColumns(item.columns)
            : cloneDefaultColumns();

        let defaultColumnId = item.defaultColumnId || columns[0].id;
        let board: BoardItem = {
            title: item.title.trim() || '',
            description: item.description.trim() || '',
            current: false,
            index: Model.collection.count() + 1,
            defaultColumnId,
            columns
        };

        validateDefaultColumn(board);

        board = Model.collection.add(board);

        return Model.use(board.$id ?? board.id ?? board.index);
    },
    remove(item?: BoardItem | null) {
        if (!item) {
            Model.collection.find().forEach((current: BoardItem) => Model.collection.remove(current));
            afterPersist('remove');
            return;
        }

        Model.collection.remove(item);
        Model.updateIndexes();
        afterPersist('remove');
    },
    updateIndexes() {
        Model.find().forEach((item: BoardItem, index: number) => {
            item.index = index + 1;
            validateDefaultColumn(item);
            normalizeColumns(item);
            Model.collection.update(item);
        });
    },
    getCurrent() {
        return Model.findOne({current: true});
    },
    getFirst() {
        return Model.findOne();
    },
    use(id: BoardId) {
        Model.find({current: true}).forEach((item: BoardItem) => {
            item.current = false;
            validateDefaultColumn(item);
            normalizeColumns(item);
            Model.collection.update(item);
        });

        let current = Model.get(id);
        current.current = true;
        validateDefaultColumn(current);
        normalizeColumns(current);
        let saved = Model.collection.update(current);
        afterPersist('use');
        return saved;
    }
} as BoardModel;

Model.columns = {
    add(values: BoardColumnInput) {
        let current = Model.getCurrent();
        let usedIds = new Set(current.columns.map((column: BoardColumn) => column.id));
        current.columns.push({
            id: ensureUniqueColumnId(sanitizeColumnId(values.id || values.title), usedIds),
            title: values.title.trim() || '',
            wipLimit: normalizeWipLimit(values.wipLimit ?? null),
            cards: []
        });
        return Model.save(current);
    },
    edit(index: number, values: Partial<BoardColumnInput>) {
        let current = Model.getCurrent();
        let column = assertColumn(current, index);

        if (typeof values.title === 'string') {
            column.title = values.title.trim() || '';
        }

        if (Object.prototype.hasOwnProperty.call(values, 'wipLimit')) {
            column.wipLimit = normalizeWipLimit(values.wipLimit);
        }

        return Model.save(current);
    },
    setDefault(index: number) {
        let current = Model.getCurrent();
        let column = assertColumn(current, index);

        current.defaultColumnId = column.id;
        return Model.save(current);
    },
    reorder({fromIndex, toIndex}: {fromIndex: number; toIndex: number}) {
        let current = Model.getCurrent();
        assertColumn(current, fromIndex);
        assertColumn(current, toIndex);
        let [column] = current.columns.splice(fromIndex - 1, 1);

        current.columns.splice(toIndex - 1, 0, column);
        return Model.save(current);
    },
    remove(index: number) {
        let current = Model.getCurrent();
        let column = assertColumn(current, index);

        if (column.cards.length > 0) {
            throw new Error('Cannot remove a column with cards');
        }

        if (column.id === current.defaultColumnId) {
            throw new Error('Cannot remove the default column');
        }

        current.columns.splice(index - 1, 1);
        return Model.save(current);
    },
    resetSimpleDefault() {
        let current = Model.getCurrent();
        current.columns = cloneDefaultColumns();
        current.defaultColumnId = DEFAULT_COLUMN_ID;
        return Model.save(current);
    }
};

Model.cards = {
    add(values: BoardCardInput, {columnIndex}: {columnIndex?: number} = {}) {
        let current = Model.getCurrent();
        let defaultColumn = getDefaultColumn(current);
        let column = typeof columnIndex === 'number'
            ? assertColumn(current, columnIndex)
            : defaultColumn;
        column.cards.push(prepareCard(values));
        return Model.save(current);
    },
    edit({columnIndex, position, values}: {columnIndex: number; position: number; values: Partial<BoardCardInput>}) {
        let current = Model.getCurrent();
        let column = assertColumn(current, columnIndex);
        let card = assertCard(column, position);

        if (typeof values.title === 'string') {
            card.title = values.title.trim() || '';
        }

        if (typeof values.description === 'string') {
            card.description = (values.description || '').trim();
        }

        return Model.save(current);
    },
    remove({columnIndex, positions}: {columnIndex: number; positions: Iterable<number>}) {
        let current = Model.getCurrent();
        let column = assertColumn(current, columnIndex);
        [...positions].forEach((position: number) => assertCard(column, position));
        [...positions]
            .sort((left: number, right: number) => right - left)
            .forEach((position: number) => {
                column.cards.splice(position - 1, 1);
            });
        return Model.save(current);
    },
    moveMany({cards, toColumn}: {cards: Array<{fromColumn: number; fromPosition: number}>; toColumn: number}) {
        let current = Model.getCurrent();
        let targetColumn = assertColumn(current, toColumn);
        let seenSelections = new Set<string>();
        let selections = [...cards]
            .filter((card: {fromColumn: number; fromPosition: number}) => {
                let key = `${card.fromColumn}:${card.fromPosition}`;

                if (seenSelections.has(key)) {
                    return false;
                }

                seenSelections.add(key);
                return true;
            })
            .map((card: {fromColumn: number; fromPosition: number}): BoardCardSelection => ({
                fromColumn: card.fromColumn,
                fromPosition: card.fromPosition,
                column: assertColumn(current, card.fromColumn)
            }));

        selections.forEach((selection: BoardCardSelection) => assertCard(selection.column, selection.fromPosition));
        let incomingSelections = selections.filter((selection: BoardCardSelection) => selection.fromColumn !== toColumn);

        if (targetColumn.wipLimit !== null && targetColumn.cards.length + incomingSelections.length > targetColumn.wipLimit) {
            throw new Error('Cannot move cards into a column that would exceed its WIP limit');
        }

        let selectedIncomingCards = incomingSelections
            .sort((left: BoardCardSelection, right: BoardCardSelection) => {
                if (left.fromColumn !== right.fromColumn) {
                    return left.fromColumn - right.fromColumn;
                }

                return left.fromPosition - right.fromPosition;
            })
            .map((selection: BoardCardSelection) => selection.column.cards[selection.fromPosition - 1]);

        let groupedPositions = incomingSelections.reduce((acc: GroupedPositions, selection: BoardCardSelection) => {
            if (!acc[selection.fromColumn]) {
                acc[selection.fromColumn] = [];
            }

            acc[selection.fromColumn].push(selection.fromPosition);
            return acc;
        }, {});

        Object.keys(groupedPositions)
            .map((value: string) => parseInt(value, 10))
            .sort((left: number, right: number) => left - right)
            .forEach((columnIndex: number) => {
                let column = getColumn(current, columnIndex);
                groupedPositions[columnIndex]
                    .sort((left: number, right: number) => right - left)
                    .forEach((position: number) => {
                        column.cards.splice(position - 1, 1);
                    });
            });

        selectedIncomingCards.forEach((card: BoardCard) => {
            targetColumn.cards.push(card);
        });

        return Model.save(current);
    },
    move({fromColumn, fromPosition, toColumn, toPosition}: {fromColumn: number; fromPosition: number; toColumn: number; toPosition?: number}) {
        let current = Model.getCurrent();
        let originColumn = assertColumn(current, fromColumn);
        let targetColumn = assertColumn(current, toColumn);
        let card = assertCard(originColumn, fromPosition);

        if (typeof toPosition === 'number' && (toPosition < 1 || toPosition > targetColumn.cards.length + 1)) {
            throw new Error('Invalid card position');
        }

        if (fromColumn !== toColumn && !hasCapacity(targetColumn)) {
            throw new Error('Cannot move a card into a column that is already at its WIP limit');
        }

        originColumn.cards.splice(fromPosition - 1, 1);

        let insertAt = typeof toPosition === 'number' ? toPosition - 1 : targetColumn.cards.length;
        targetColumn.cards.splice(insertAt, 0, card);

        if (toColumn > fromColumn) {
            for (let columnIndex = toColumn - 1; columnIndex >= 2; columnIndex--) {
                let column = getColumn(current, columnIndex);
                let previousColumn = getColumn(current, columnIndex - 1);

                if (!hasCapacity(column)) {
                    break;
                }

                if (previousColumn.cards.length === 0) {
                    break;
                }

                let shiftedCard = previousColumn.cards.shift();

                if (!shiftedCard) {
                    break;
                }

                column.cards.push(shiftedCard);
            }
        }

        return Model.save(current);
    }
};

export const collection = Model.collection;
export const get = Model.get;
export const find = Model.find;
export const findOne = Model.findOne;
export const add = Model.add;
export const save = Model.save;
export const remove = Model.remove;
export const getCurrent = Model.getCurrent;
export const getFirst = Model.getFirst;
export const getLast = Model.getLast;
export const updateIndexes = Model.updateIndexes;
export const use = Model.use;
export const addColumn = Model.addColumn;
export const editColumn = Model.editColumn;
export const removeColumn = Model.removeColumn;
export const reorderColumns = Model.reorderColumns;
export const setDefaultColumn = Model.setDefaultColumn;
export const columns = Model.columns;
export const cards = Model.cards;
export const move = Model.move;
export default Model;
