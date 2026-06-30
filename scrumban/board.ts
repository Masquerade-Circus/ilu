import isUndefined from 'lodash/isUndefined.js';
import prompts from '../utils/prompts';
import * as __cjsImport22 from '../utils';
const { required, log } = __cjsImport22;
import * as __cjsImport23 from '../utils/prompt-integer-validation';
const { integerPromptValidator } = __cjsImport23;
import Model from './model';
import BoardLists from './board-lists';
import renderBoard from './board-renderer';
import promptBoardPriority from './board-priority-prompt';
function getCurrentBoard() {
    let board = Model.getCurrent();
    if (!board) {
        log.info(`You dont have any boards, try adding one.`.blue, 'blue');
        process.exit(1);
        return;
    }
    return board;
}

function getCards(board: any) {
    let cards: any = [];

    board.columns.forEach((column: any, columnIndex: any) => {
        column.cards.forEach((card: any, positionIndex: any) => {
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

function filterChoices(choices: any, search: any) {
    let normalizedSearch = String(search || '').trim().toLowerCase();

    if (normalizedSearch.length === 0) {
        return choices;
    }

    return choices.filter((choice: any) => choice.name.toLowerCase().includes(normalizedSearch));
}

async function selectCard(message: any, multiple: any = false) {
    let board = getCurrentBoard();
    let cards = getCards(board);

    if (cards.length === 0) {
        log.info(`You dont have any cards, try adding one.`.blue, 'blue');
        process.exit(1);
        return;
    }

    let answers = await prompts.prompt([
        {
            type: multiple ? 'checkbox' : 'search',
            name: multiple ? 'cardKeys' : 'cardKey',
            message,
            choices: cards,
            validate(value: any) {
                if (!multiple) {
                    return true;
                }
                return value.length > 0 || 'Please select at least one card';
            }
        }
    ]);

    return multiple ? answers.cardKeys : answers.cardKey;
}

function parseCardKey(cardKey: any) {
    let [columnIndex, position] = cardKey.split(':').map((value: any) => parseInt(value, 10));
    return {columnIndex, position};
}

function getCardByKey(cardKey: any) {
    let board = getCurrentBoard();
    let {columnIndex, position} = parseCardKey(cardKey);
    let column = board.columns[columnIndex - 1];
    let card = column && column.cards[position - 1];
    return {board, columnIndex, position, column, card};
}

async function selectColumn(message: any, columns: any) {
    let choices = columns.map((column: any) => ({name: column.title, value: column.index}));
    let answers = await prompts.prompt([
        {
            type: 'search',
            name: 'columnIndex',
            message,
            choices
        }
    ]);

    return answers.columnIndex;
}

async function selectColumnsTarget(columns: any) {
    let choices = [
        ...columns.map((column: any) => ({name: column.title, value: `column:${column.index}`})),
        {name: '+ Add column', value: 'add-column'},
        {name: '↺ Reset to simple default', value: 'reset-simple-default'},
        {name: 'Cancel', value: 'cancel'}
    ];
    let answers = await prompts.prompt([
        {
            type: 'search',
            name: 'selection',
            message: 'Select a column to manage',
            choices
        }
    ]);

    return answers.selection;
}

function getColumnsWithIndexes(board: any) {
    return board.columns.map((column: any, index: any) => ({...column, index: index + 1}));
}

function hasAnyCards(board: any) {
    return board.columns.some((column: any) => column.cards.length > 0);
}

function canRemoveColumn(board: any, column: any) {
    return column.cards.length === 0 && column.id !== board.defaultColumnId;
}

function getColumnActions(board: any, column: any, columnIndex: any) {
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

async function selectColumnAction(board: any, column: any, columnIndex: any) {
    let answers = await prompts.prompt([
        {
            type: 'select',
            name: 'action',
            message: `What do you want to do with "${column.title}"?`,
            choices: getColumnActions(board, column, columnIndex)
        }
    ]);

    return answers.action;
}

function isWipLimitReachedError(error: any) {
    return error && /WIP limit/i.test(error.message || '');
}

function sortCardMoves(cardKeys: any) {
    return cardKeys
        .map(parseCardKey)
        .sort((left: any, right: any) => {
            if (left.columnIndex !== right.columnIndex) {
                return left.columnIndex - right.columnIndex;
            }

            return left.position - right.position;
        });
}

function canMoveAllCardsToColumn(board: any, moves: any, targetColumnIndex: any) {
    let targetColumn = board.columns[targetColumnIndex - 1];

    if (!targetColumn || !targetColumn.wipLimit) {
        return true;
    }

    let incomingCards = moves.filter((move: any) => move.columnIndex !== targetColumnIndex).length;
    return targetColumn.cards.length + incomingCards <= targetColumn.wipLimit;
}

let Board = {
    getCurrent: getCurrentBoard,
    async add() {
        getCurrentBoard();

        let answers = await prompts.prompt([
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
        let answers = await prompts.prompt([
            {type: 'input', name: 'title', message: 'Title of the card', suffix: ' (required)', validate: required('title'), default: card.title},
            {type: 'input', name: 'description', message: 'Description of the card', default: card.description}
        ]);

        Model.cards.edit({columnIndex, position, values: answers});
        await Board.showWithActions();
    },
    async move() {
        let board = getCurrentBoard();
        let cardKeys = await selectCard('Select cards to move.', true);
        let columnChoices = board.columns.map((column: any, index: any) => ({name: column.title, value: index + 1}));
        let answers = await prompts.prompt([
            {
                type: 'search',
                name: 'columnIndex',
                message: 'Select the destination column',
                choices: columnChoices
            }
        ]);

        let targetColumn = board.columns[answers.columnIndex - 1];
        let moves = sortCardMoves(cardKeys);

        if (!canMoveAllCardsToColumn(board, moves, answers.columnIndex)) {
            log.info('Cannot move these cards because the destination column would exceed its WIP limit.'.blue, 'blue');
            await Board.showWithActions();
            return;
        }

        try {
            Model.cards.moveMany({
                cards: moves.map((move: any) => ({
                    fromColumn: move.columnIndex,
                    fromPosition: move.position
                })),
                toColumn: answers.columnIndex
            });
        } catch (error: any) {
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
        let grouped = cardKeys.reduce((acc: any, cardKey: any) => {
            let {columnIndex, position} = parseCardKey(cardKey);
            if (!acc[columnIndex]) {
                acc[columnIndex] = [];
            }
            acc[columnIndex].push(position);
            return acc;
        }, {});

        Object.keys(grouped)
            .map((value: any) => parseInt(value, 10))
            .sort((left: any, right: any) => left - right)
            .forEach((columnIndex: any) => {
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
            let addAnswer = await prompts.prompt([
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
                let wipAnswer = await prompts.prompt([
                    {
                        type: 'number',
                        name: 'wipLimit',
                        message: 'WIP limit (0 for none)',
                        defaultValue: column.wipLimit || 0,
                        min: 0,
                        validate: integerPromptValidator('WIP limit must be 0 or a whole number.')
                    }
                ]);

                Model.columns.edit(columnIndex, {
                    wipLimit: wipAnswer.wipLimit === 0 ? null : wipAnswer.wipLimit
                });
            }

            if (action === 'rename-column') {
                let renameAnswer = await prompts.prompt([
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
        return (BoardLists as any).show();
    },
    async use() {
        await (BoardLists as any).use();
    },
    async addBoard() {
        await (BoardLists as any).add();
    },
    async editBoard() {
        await (BoardLists as any).edit();
    },
    async removeBoard() {
        await (BoardLists as any).remove();
    },
    async actions(args: any, opts: any) {
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

export const add = Board.add;
export const move = Board.move;
export const priority = Board.priority;
export const details = Board.details;
export const edit = Board.edit;
export const remove = Board.remove;
export const columns = Board.columns;
export const show = Board.show;
export const showWithActions = Board.showWithActions;
export const list = Board.list;
export const use = Board.use;
export const addBoard = Board.addBoard;
export const editBoard = Board.editBoard;
export const removeBoard = Board.removeBoard;
export const actions = Board.actions;
export default Board;
