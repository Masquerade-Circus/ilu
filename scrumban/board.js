let isUndefined = require('lodash/isUndefined');
let inquirer = require('../utils/inquirer');
let {required, log} = require('../utils');
let Model = require('./model');
let BoardLists = require('./board-lists');
let renderBoard = require('./ascii-board');
let promptBoardPriority = require('./board-priority-prompt');

function getCurrentBoard() {
    let board = Model.getCurrent();
    if (!board) {
        log.info(`You dont have any boards, try adding one.`.blue, 'blue');
        process.exit(1);
        return;
    }
    return board;
}

function getCards(board) {
    let cards = [];

    board.columns.forEach((column, columnIndex) => {
        column.cards.forEach((card, positionIndex) => {
            cards.push({
                name: `[${column.title}] ${card.position} ${card.title}`,
                value: `${columnIndex + 1}:${positionIndex + 1}`,
                columnIndex: columnIndex + 1,
                position: positionIndex + 1,
                card
            });
        });
    });

    return cards;
}

async function selectCard(message, multiple = false) {
    let board = getCurrentBoard();
    let cards = getCards(board);

    if (cards.length === 0) {
        log.info(`You dont have any cards, try adding one.`.blue, 'blue');
        process.exit(1);
        return;
    }

    let answers = await inquirer.prompt([
        {
            type: multiple ? 'checkbox' : 'select',
            name: multiple ? 'cardKeys' : 'cardKey',
            message,
            choices: cards,
            validate(value) {
                if (!multiple) {
                    return true;
                }
                return value.length > 0 || 'Please select at least one card';
            }
        }
    ]);

    return multiple ? answers.cardKeys : answers.cardKey;
}

function parseCardKey(cardKey) {
    let [columnIndex, position] = cardKey.split(':').map(value => parseInt(value, 10));
    return {columnIndex, position};
}

function getCardByKey(cardKey) {
    let board = getCurrentBoard();
    let {columnIndex, position} = parseCardKey(cardKey);
    let column = board.columns[columnIndex - 1];
    let card = column && column.cards[position - 1];
    return {board, columnIndex, position, column, card};
}

async function selectColumn(message, columns) {
    let answers = await inquirer.prompt([
        {
            type: 'select',
            name: 'columnIndex',
            message,
            choices: columns.map(column => ({name: column.title, value: column.index}))
        }
    ]);

    return answers.columnIndex;
}

async function selectColumnsTarget(columns) {
    let answers = await inquirer.prompt([
        {
            type: 'select',
            name: 'selection',
            message: 'Select a column to manage',
            choices: [
                ...columns.map(column => ({name: column.title, value: `column:${column.index}`})),
                {name: '+ Add column', value: 'add-column'},
                {name: '↺ Reset to simple default', value: 'reset-simple-default'},
                {name: 'Cancel', value: 'cancel'}
            ]
        }
    ]);

    return answers.selection;
}

function getColumnsWithIndexes(board) {
    return board.columns.map((column, index) => ({...column, index: index + 1}));
}

function hasAnyCards(board) {
    return board.columns.some(column => column.cards.length > 0);
}

function canRemoveColumn(board, column) {
    return column.cards.length === 0 && column.id !== board.defaultColumnId;
}

function getColumnActions(board, column, columnIndex) {
    let choices = [
        {name: 'Rename', value: 'rename-column'},
        {name: 'Set WIP', value: 'set-wip'}
    ];

    if (column.id !== board.defaultColumnId) {
        choices.push({name: 'Make default', value: 'make-default'});
    }

    if (columnIndex > 1) {
        choices.push({name: 'Move left', value: 'move-left'});
    }

    if (columnIndex < board.columns.length) {
        choices.push({name: 'Move right', value: 'move-right'});
    }

    if (canRemoveColumn(board, column)) {
        choices.push({name: 'Remove', value: 'remove-column'});
    }

    choices.push({name: 'Cancel', value: 'cancel'});

    return choices;
}

async function selectColumnAction(board, column, columnIndex) {
    let answers = await inquirer.prompt([
        {
            type: 'select',
            name: 'action',
            message: `What do you want to do with "${column.title}"?`,
            choices: getColumnActions(board, column, columnIndex)
        }
    ]);

    return answers.action;
}

function validateWipLimitInput(value) {
    let normalizedValue = String(value || '').trim();

    if (normalizedValue.length === 0) {
        return true;
    }

    if (/^[1-9]\d*$/.test(normalizedValue)) {
        return true;
    }

    return 'Please enter a valid integer greater than or equal to 1';
}

function isWipLimitReachedError(error) {
    return error && /WIP limit/i.test(error.message || '');
}

let Board = {
    getCurrent: getCurrentBoard,
    async add() {
        getCurrentBoard();

        let answers = await inquirer.prompt([
            {type: 'input', name: 'title', message: 'Title of the card', suffix: ' (required)', validate: required('title')},
            {type: 'input', name: 'description', message: 'Description of the card'}
        ]);

        Model.cards.add(answers);
        await Board.showWithActions();
    },
    async details() {
        let cardKey = await selectCard('Select a card.');
        let {card, column} = getCardByKey(cardKey);

        log('Title'.gray);
        log(card.title.cyan, 4);
        log('Column'.gray);
        log(column.title.cyan, 4);

        if (card.description.trim().length > 0) {
            log('Description'.gray);
            log(card.description.cyan, 4);
        }
    },
    async edit() {
        let cardKey = await selectCard('Select a card to edit.');
        let {card, columnIndex, position} = getCardByKey(cardKey);
        let answers = await inquirer.prompt([
            {type: 'input', name: 'title', message: 'Title of the card', suffix: ' (required)', validate: required('title'), default: card.title},
            {type: 'input', name: 'description', message: 'Description of the card', default: card.description}
        ]);

        Model.cards.edit({columnIndex, position, values: answers});
        await Board.showWithActions();
    },
    async move() {
        let board = getCurrentBoard();
        let cardKey = await selectCard('Select a card to move.');
        let {columnIndex, position} = parseCardKey(cardKey);
        let answers = await inquirer.prompt([
            {
                type: 'select',
                name: 'columnIndex',
                message: 'Select the destination column',
                choices: board.columns.map((column, index) => ({name: column.title, value: index + 1}))
            }
        ]);

        let targetColumn = board.columns[answers.columnIndex - 1];
        try {
            Model.cards.move({
                fromColumn: columnIndex,
                fromPosition: position,
                toColumn: answers.columnIndex,
                toPosition: targetColumn.cards.length + 1
            });
        } catch (error) {
            if (!isWipLimitReachedError(error)) {
                throw error;
            }

            log.info('Cannot move this card because the destination column has already reached its WIP limit.'.blue, 'blue');
        }
        await Board.showWithActions();
    },
    async priority() {
        let board = getCurrentBoard();
        let columns = getColumnsWithIndexes(board);
        let columnIndex = await selectColumn('Select the column to reorder', columns);
        let column = board.columns[columnIndex - 1];

        if (!column || column.cards.length < 2) {
            log.info('This column has fewer than two cards, there is nothing to change.'.blue, 'blue');
            await Board.showWithActions();
            return;
        }

        let move = await promptBoardPriority({
            columnTitle: column.title,
            cards: column.cards
        });

        if (move && move.fromPosition !== move.toPosition) {
            Model.cards.move({
                fromColumn: columnIndex,
                fromPosition: move.fromPosition,
                toColumn: columnIndex,
                toPosition: move.toPosition
            });
        }

        await Board.showWithActions();
    },
    async remove() {
        let cardKeys = await selectCard('Select cards to remove.', true);
        let grouped = cardKeys.reduce((acc, cardKey) => {
            let {columnIndex, position} = parseCardKey(cardKey);
            if (!acc[columnIndex]) {
                acc[columnIndex] = [];
            }
            acc[columnIndex].push(position);
            return acc;
        }, {});

        Object.keys(grouped)
            .map(value => parseInt(value, 10))
            .sort((left, right) => left - right)
            .forEach(columnIndex => {
                Model.cards.remove({columnIndex, positions: grouped[columnIndex]});
            });

        log.info(`${cardKeys.length} ${cardKeys.length === 1 ? 'card has' : 'cards have'} been removed.`.blue, 'blue');
        await Board.showWithActions();
    },
    async columns() {
        let board = getCurrentBoard();
        let columns = getColumnsWithIndexes(board);
        let selection = await selectColumnsTarget(columns);

        if (selection === 'add-column') {
            let addAnswer = await inquirer.prompt([
                {type: 'input', name: 'title', message: 'Column title', suffix: ' (required)', validate: required('title')}
            ]);
            Model.columns.add({title: addAnswer.title});
        }

        if (selection === 'reset-simple-default') {
            if (hasAnyCards(board)) {
                log.info('Cannot reset to the simple default while the board has cards.'.blue, 'blue');
            } else {
                Model.columns.resetSimpleDefault();
            }
        }

        if (selection.startsWith('column:')) {
            let columnIndex = parseInt(selection.split(':')[1], 10);
            let column = board.columns[columnIndex - 1];
            let action = await selectColumnAction(board, column, columnIndex);

            if (action === 'set-wip') {
                let wipAnswer = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'wipLimit',
                        message: 'WIP limit (leave empty for none)',
                        validate: validateWipLimitInput
                    }
                ]);

                let wipLimit = String(wipAnswer.wipLimit || '').trim();
                Model.columns.edit(columnIndex, {
                    wipLimit: wipLimit.length === 0 ? null : parseInt(wipLimit, 10)
                });
            }

            if (action === 'rename-column') {
                let renameAnswer = await inquirer.prompt([
                    {type: 'input', name: 'title', message: 'Column title', suffix: ' (required)', validate: required('title'), default: column.title}
                ]);
                Model.columns.edit(columnIndex, {title: renameAnswer.title});
            }

            if (action === 'make-default') {
                Model.columns.setDefault(columnIndex);
            }

            if (action === 'move-left') {
                Model.columns.reorder({fromIndex: columnIndex, toIndex: columnIndex - 1});
            }

            if (action === 'move-right') {
                Model.columns.reorder({fromIndex: columnIndex, toIndex: columnIndex + 1});
            }

            if (action === 'remove-column' && canRemoveColumn(board, column)) {
                Model.columns.remove(columnIndex);
            }
        }

        await Board.showWithActions();
    },
    async show() {
        let board = getCurrentBoard();
        log(`\nBoard: ${board.title.cyan}\n${renderBoard(board)}\n`, 0);
    },
    async showWithActions() {
        await Board.show();
    },
    list() {
        return BoardLists.show();
    },
    async use() {
        await BoardLists.use();
    },
    async addBoard() {
        await BoardLists.add();
    },
    async editBoard() {
        await BoardLists.edit();
    },
    async removeBoard() {
        await BoardLists.remove();
    },
    async actions(args, opts) {
        switch (true) {
            case !isUndefined(opts.add): await Board.add(); break;
            case !isUndefined(opts.details): await Board.details(); break;
            case !isUndefined(opts.edit): await Board.edit(); break;
            case !isUndefined(opts.move): await Board.move(); break;
            case !isUndefined(opts.priority): await Board.priority(); break;
            case !isUndefined(opts.remove): await Board.remove(); break;
            case !isUndefined(opts.columns): await Board.columns(); break;
            case !isUndefined(opts.listBoards): Board.list(); break;
            case !isUndefined(opts.useBoard): await Board.use(); break;
            case !isUndefined(opts.addBoard): await Board.addBoard(); break;
            case !isUndefined(opts.editBoard): await Board.editBoard(); break;
            case !isUndefined(opts.removeBoard): await Board.removeBoard(); break;
            case !isUndefined(opts.show): await Board.show(); break;
            default: await Board.show(); break;
        }
    }
};

module.exports = Board;
