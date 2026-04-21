let loadDb = require('../utils/load-db');

let DEFAULT_COLUMNS = [
    {id: 'backlog', title: 'Backlog', wipLimit: null},
    {id: 'ready', title: 'Ready', wipLimit: null},
    {id: 'in-progress', title: 'In Progress', wipLimit: null},
    {id: 'done', title: 'Done', wipLimit: null}
];

let DEFAULT_COLUMN_ID = DEFAULT_COLUMNS[0].id;

function sanitizeColumnId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function ensureUniqueColumnId(baseId, usedIds) {
    let nextId = baseId || 'column';
    let suffix = 2;

    while (usedIds.has(nextId)) {
        nextId = `${baseId || 'column'}-${suffix}`;
        suffix += 1;
    }

    usedIds.add(nextId);
    return nextId;
}

function cloneColumn(column, usedIds) {
    return {
        id: ensureUniqueColumnId(sanitizeColumnId(column.id || column.title), usedIds),
        title: (column.title || '').trim(),
        wipLimit: normalizeWipLimit(column.wipLimit ?? null),
        cards: []
    };
}

function cloneDefaultColumns() {
    let usedIds = new Set();
    return DEFAULT_COLUMNS.map((column, index) => ({
        ...cloneColumn(column, usedIds),
        index: index + 1
    }));
}

function cloneColumns(columns = []) {
    let usedIds = new Set();
    return columns.map((column, index) => ({
        ...cloneColumn(column, usedIds),
        index: index + 1
    }));
}

function normalizeCards(column) {
    column.cards.forEach((card, index) => {
        card.position = index + 1;
    });
}

function normalizeColumns(board) {
    board.columns.forEach((column, index) => {
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

function getColumn(board, index) {
    return board.columns[index - 1];
}

function getColumnIndexById(board, columnId) {
    return board.columns.findIndex(column => column.id === columnId);
}

function getDefaultColumn(board) {
    let columnIndex = getColumnIndexById(board, board.defaultColumnId);
    return columnIndex >= 0 ? board.columns[columnIndex] : null;
}

function validateDefaultColumn(board) {
    if (!board.defaultColumnId || getColumnIndexById(board, board.defaultColumnId) < 0) {
        throw new Error('Board default column must match an existing column');
    }
}

function hasCapacity(column) {
    return column.wipLimit === null || column.cards.length < column.wipLimit;
}

function normalizeWipLimit(value) {
    if (value === null) {
        return null;
    }

    if (Number.isInteger(value) && value >= 1) {
        return value;
    }

    throw new Error('WIP limit must be null or an integer greater than or equal to 1');
}

function prepareCard(card) {
    return {
        title: card.title.trim() || '',
        description: (card.description || '').trim(),
        position: 0
    };
}

let DB = loadDb('boards');

let Model = {
    collection: DB.getCollection('boards'),
    get(id) {
        return Model.collection.get(id);
    },
    find(query = {}, options = {sort: {index: 1}}) {
        return Model.collection.find(query, options);
    },
    findOne(query = {}, options = {sort: {index: 1}}) {
        return Model.collection.findOne(query, options);
    },
    save(board) {
        validateDefaultColumn(board);
        normalizeColumns(board);
        return Model.collection.update(board);
    },
    add(item) {
        let columns = Array.isArray(item.columns) && item.columns.length > 0
            ? cloneColumns(item.columns)
            : cloneDefaultColumns();

        let defaultColumnId = item.defaultColumnId || columns[0].id;
        let board = {
            title: item.title.trim() || '',
            description: item.description.trim() || '',
            current: false,
            index: Model.collection.count() + 1,
            defaultColumnId,
            columns
        };

        validateDefaultColumn(board);

        board = Model.collection.add(board);

        return Model.use(board.$id);
    },
    remove(item) {
        if (!item) {
            Model.collection.find().forEach(current => Model.collection.remove(current));
            return;
        }

        Model.collection.remove(item);
        Model.updateIndexes();
    },
    updateIndexes() {
        Model.find().forEach((item, index) => {
            item.index = index + 1;
            Model.save(item);
        });
    },
    getCurrent() {
        return Model.findOne({current: true});
    },
    getFirst() {
        return Model.findOne();
    },
    use(id) {
        Model.find({current: true}).forEach(item => {
            item.current = false;
            Model.save(item);
        });

        let current = Model.get(id);
        current.current = true;
        return Model.save(current);
    }
};

Model.columns = {
    add(values) {
        let current = Model.getCurrent();
        let usedIds = new Set(current.columns.map(column => column.id));
        current.columns.push({
            id: ensureUniqueColumnId(sanitizeColumnId(values.id || values.title), usedIds),
            title: values.title.trim() || '',
            wipLimit: normalizeWipLimit(values.wipLimit ?? null),
            cards: []
        });
        return Model.save(current);
    },
    edit(index, values) {
        let current = Model.getCurrent();
        let column = getColumn(current, index);

        if (!column) {
            return current;
        }

        if (Object.prototype.hasOwnProperty.call(values, 'title')) {
            column.title = values.title.trim() || '';
        }

        if (Object.prototype.hasOwnProperty.call(values, 'wipLimit')) {
            column.wipLimit = normalizeWipLimit(values.wipLimit);
        }

        return Model.save(current);
    },
    setDefault(index) {
        let current = Model.getCurrent();
        let column = getColumn(current, index);

        if (!column) {
            return current;
        }

        current.defaultColumnId = column.id;
        return Model.save(current);
    },
    reorder({fromIndex, toIndex}) {
        let current = Model.getCurrent();
        let [column] = current.columns.splice(fromIndex - 1, 1);

        if (!column) {
            return current;
        }

        current.columns.splice(toIndex - 1, 0, column);
        return Model.save(current);
    },
    remove(index) {
        let current = Model.getCurrent();
        let column = getColumn(current, index);

        if (!column) {
            return current;
        }

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
    add(values, {columnIndex} = {}) {
        let current = Model.getCurrent();
        let defaultColumn = getDefaultColumn(current);
        let column = typeof columnIndex === 'number'
            ? getColumn(current, columnIndex)
            : defaultColumn;
        column.cards.push(prepareCard(values));
        return Model.save(current);
    },
    edit({columnIndex, position, values}) {
        let current = Model.getCurrent();
        let column = getColumn(current, columnIndex);
        let card = column && column.cards[position - 1];

        if (!card) {
            return current;
        }

        if (Object.prototype.hasOwnProperty.call(values, 'title')) {
            card.title = values.title.trim() || '';
        }

        if (Object.prototype.hasOwnProperty.call(values, 'description')) {
            card.description = (values.description || '').trim();
        }

        return Model.save(current);
    },
    remove({columnIndex, positions}) {
        let current = Model.getCurrent();
        let column = getColumn(current, columnIndex);
        [...positions]
            .sort((left, right) => right - left)
            .forEach(position => {
                column.cards.splice(position - 1, 1);
            });
        return Model.save(current);
    },
    move({fromColumn, fromPosition, toColumn, toPosition}) {
        let current = Model.getCurrent();
        let originColumn = getColumn(current, fromColumn);
        let targetColumn = getColumn(current, toColumn);
        let [card] = originColumn.cards.splice(fromPosition - 1, 1);

        if (!card) {
            return current;
        }

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

                column.cards.push(previousColumn.cards.shift());
            }
        }

        return Model.save(current);
    }
};

module.exports = Model;
