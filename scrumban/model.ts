let loadDb = require('../utils/load-db');
let notifySync = require('../sync/ilu-hooks');

let DEFAULT_COLUMNS = [
    {id: 'backlog', title: 'Backlog', wipLimit: null},
    {id: 'ready', title: 'Ready', wipLimit: null},
    {id: 'in-progress', title: 'In Progress', wipLimit: null},
    {id: 'done', title: 'Done', wipLimit: null}
];

let DEFAULT_COLUMN_ID = DEFAULT_COLUMNS[0].id;

function afterPersist(action: any) {
    notifySync({domain: 'boards', action});
}

function sanitizeColumnId(value: any) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function ensureUniqueColumnId(baseId: any, usedIds: any) {
    let nextId = baseId || 'column';
    let suffix = 2;

    while (usedIds.has(nextId)) {
        nextId = `${baseId || 'column'}-${suffix}`;
        suffix += 1;
    }

    usedIds.add(nextId);
    return nextId;
}

function cloneColumn(column: any, usedIds: any) {
    return {
        id: ensureUniqueColumnId(sanitizeColumnId(column.id || column.title), usedIds),
        title: (column.title || '').trim(),
        wipLimit: normalizeWipLimit(column.wipLimit ?? null),
        cards: []
    };
}

function cloneDefaultColumns() {
    let usedIds = new Set();
    return DEFAULT_COLUMNS.map((column: any, index: any) => ({
        ...cloneColumn(column, usedIds),
        index: index + 1
    }));
}

function cloneColumns(columns: any = []) {
    let usedIds = new Set();
    return columns.map((column: any, index: any) => ({
        ...cloneColumn(column, usedIds),
        index: index + 1
    }));
}

function normalizeCards(column: any) {
    column.cards.forEach((card: any, index: any) => {
        card.position = index + 1;
    });
}

function normalizeColumns(board: any) {
    board.columns.forEach((column: any, index: any) => {
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

function getColumn(board: any, index: any) {
    return board.columns[index - 1];
}

function getColumnIndexById(board: any, columnId: any) {
    return board.columns.findIndex((column: any) => column.id === columnId);
}

function getDefaultColumn(board: any) {
    let columnIndex = getColumnIndexById(board, board.defaultColumnId);
    return columnIndex >= 0 ? board.columns[columnIndex] : null;
}

function validateDefaultColumn(board: any) {
    if (!board.defaultColumnId || getColumnIndexById(board, board.defaultColumnId) < 0) {
        throw new Error('Board default column must match an existing column');
    }
}

function hasCapacity(column: any) {
    return column.wipLimit === null || column.cards.length < column.wipLimit;
}

function normalizeWipLimit(value: any) {
    if (value === null) {
        return null;
    }

    if (Number.isInteger(value) && value >= 1) {
        return value;
    }

    throw new Error('WIP limit must be null or an integer greater than or equal to 1');
}

function prepareCard(card: any) {
    return {
        title: card.title.trim() || '',
        description: (card.description || '').trim(),
        position: 0
    };
}

let DB = loadDb('boards');

let Model: any = {
    collection: DB.getCollection('boards'),
    get(id: any) {
        return Model.collection.get(id);
    },
    find(query: any = {}, options: any = {sort: {index: 1}}) {
        return Model.collection.find(query, options);
    },
    findOne(query: any = {}, options: any = {sort: {index: 1}}) {
        return Model.collection.findOne(query, options);
    },
    save(board: any) {
        validateDefaultColumn(board);
        normalizeColumns(board);
        let saved = Model.collection.update(board);
        afterPersist('save');
        return saved;
    },
    add(item: any) {
        let columns = Array.isArray(item.columns) && item.columns.length > 0
            ? cloneColumns(item.columns)
            : cloneDefaultColumns();

        let defaultColumnId = item.defaultColumnId || columns[0].id;
        let board: any = {
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
    remove(item: any) {
        if (!item) {
            Model.collection.find().forEach((current: any) => Model.collection.remove(current));
            afterPersist('remove');
            return;
        }

        Model.collection.remove(item);
        Model.updateIndexes();
        afterPersist('remove');
    },
    updateIndexes() {
        Model.find().forEach((item: any, index: any) => {
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
    use(id: any) {
        Model.find({current: true}).forEach((item: any) => {
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
};

Model.columns = {
    add(values: any) {
        let current = Model.getCurrent();
        let usedIds = new Set(current.columns.map((column: any) => column.id));
        current.columns.push({
            id: ensureUniqueColumnId(sanitizeColumnId(values.id || values.title), usedIds),
            title: values.title.trim() || '',
            wipLimit: normalizeWipLimit(values.wipLimit ?? null),
            cards: []
        });
        return Model.save(current);
    },
    edit(index: any, values: any) {
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
    setDefault(index: any) {
        let current = Model.getCurrent();
        let column = getColumn(current, index);

        if (!column) {
            return current;
        }

        current.defaultColumnId = column.id;
        return Model.save(current);
    },
    reorder({fromIndex, toIndex}: any) {
        let current = Model.getCurrent();
        let [column] = current.columns.splice(fromIndex - 1, 1);

        if (!column) {
            return current;
        }

        current.columns.splice(toIndex - 1, 0, column);
        return Model.save(current);
    },
    remove(index: any) {
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
    add(values: any, {columnIndex}: any = {}) {
        let current = Model.getCurrent();
        let defaultColumn = getDefaultColumn(current);
        let column = typeof columnIndex === 'number'
            ? getColumn(current, columnIndex)
            : defaultColumn;
        column.cards.push(prepareCard(values));
        return Model.save(current);
    },
    edit({columnIndex, position, values}: any) {
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
    remove({columnIndex, positions}: any) {
        let current = Model.getCurrent();
        let column = getColumn(current, columnIndex);
        [...positions]
            .sort((left: any, right: any) => right - left)
            .forEach((position: any) => {
                column.cards.splice(position - 1, 1);
            });
        return Model.save(current);
    },
    moveMany({cards, toColumn}: any) {
        let current = Model.getCurrent();
        let targetColumn = getColumn(current, toColumn);
        let seenSelections = new Set();
        let selections = [...cards]
            .filter((card: any) => {
                let key = `${card.fromColumn}:${card.fromPosition}`;

                if (seenSelections.has(key)) {
                    return false;
                }

                seenSelections.add(key);
                return true;
            })
            .map((card: any) => ({
                fromColumn: card.fromColumn,
                fromPosition: card.fromPosition,
                column: getColumn(current, card.fromColumn)
            }))
            .filter((selection: any) => selection.column && selection.column.cards[selection.fromPosition - 1]);
        let incomingSelections = selections.filter((selection: any) => selection.fromColumn !== toColumn);

        if (targetColumn.wipLimit !== null && targetColumn.cards.length + incomingSelections.length > targetColumn.wipLimit) {
            throw new Error('Cannot move cards into a column that would exceed its WIP limit');
        }

        let selectedIncomingCards = incomingSelections
            .sort((left: any, right: any) => {
                if (left.fromColumn !== right.fromColumn) {
                    return left.fromColumn - right.fromColumn;
                }

                return left.fromPosition - right.fromPosition;
            })
            .map((selection: any) => selection.column.cards[selection.fromPosition - 1]);

        let groupedPositions = incomingSelections.reduce((acc: any, selection: any) => {
            if (!acc[selection.fromColumn]) {
                acc[selection.fromColumn] = [];
            }

            acc[selection.fromColumn].push(selection.fromPosition);
            return acc;
        }, {});

        Object.keys(groupedPositions)
            .map((value: any) => parseInt(value, 10))
            .sort((left: any, right: any) => left - right)
            .forEach((columnIndex: any) => {
                let column = getColumn(current, columnIndex);
                groupedPositions[columnIndex]
                    .sort((left: any, right: any) => right - left)
                    .forEach((position: any) => {
                        column.cards.splice(position - 1, 1);
                    });
            });

        selectedIncomingCards.forEach((card: any) => {
            targetColumn.cards.push(card);
        });

        return Model.save(current);
    },
    move({fromColumn, fromPosition, toColumn, toPosition}: any) {
        let current = Model.getCurrent();
        let originColumn = getColumn(current, fromColumn);
        let targetColumn = getColumn(current, toColumn);

        if (fromColumn !== toColumn && !hasCapacity(targetColumn)) {
            throw new Error('Cannot move a card into a column that is already at its WIP limit');
        }

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
