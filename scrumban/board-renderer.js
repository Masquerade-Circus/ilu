const CliTable = require('cli-table');

function getHeader(column) {
    return column.wipLimit === null || typeof column.wipLimit === 'undefined'
        ? column.title
        : `${column.title} (${column.cards.length}/${column.wipLimit})`;
}
const DEFAULT_TERMINAL_COLUMNS = 80;
const MIN_COLUMN_WIDTH = 5;
const CLI_TABLE_CELL_HORIZONTAL_PADDING = 2;

function getCardText(card) {
    return `${card.position} ${card.title}`;
}

function wrapText(text, width) {
    if (!text || width < 1) {
        return text;
    }

    let paragraphs = String(text).split('\n');

    return paragraphs.map(paragraph => {
        let words = paragraph.match(/\S+/g);

        if (!words) {
            return '';
        }

        let lines = [];
        let currentLine = '';

        for (let word of words) {
            let remainingWord = word;

            while (remainingWord.length > width) {
                if (currentLine) {
                    lines.push(currentLine);
                    currentLine = '';
                }

                lines.push(remainingWord.slice(0, width));
                remainingWord = remainingWord.slice(width);
            }

            let candidate = currentLine ? `${currentLine} ${remainingWord}` : remainingWord;

            if (candidate.length <= width) {
                currentLine = candidate;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                }

                currentLine = remainingWord;
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines.join('\n');
    }).join('\n');
}

function getTerminalColumns(options) {
    if (options && Number.isInteger(options.terminalColumns) && options.terminalColumns > 0) {
        return options.terminalColumns;
    }

    if (process.stdout && Number.isInteger(process.stdout.columns) && process.stdout.columns > 0) {
        return process.stdout.columns;
    }

    return DEFAULT_TERMINAL_COLUMNS;
}

function getVisibleColumnWidth(column) {
    let headerWidth = getHeader(column).length;
    let cardWidths = column.cards.map(card => getCardText(card).length);

    return Math.max(headerWidth, ...cardWidths, 1);
}

function getColumnWidths(columns, terminalColumns) {
    let columnCount = columns.length;

    if (columnCount === 0) {
        return [];
    }

    let tableChromeWidth = (columnCount * 3) + 1;
    let minimumContentWidth = columnCount * MIN_COLUMN_WIDTH;
    let availableContentWidth = Math.max(minimumContentWidth, terminalColumns - tableChromeWidth);
    let extraWidth = availableContentWidth - minimumContentWidth;

    if (extraWidth === 0) {
        return Array.from({length: columnCount}, () => MIN_COLUMN_WIDTH);
    }

    let weights = columns.map(getVisibleColumnWidth);
    let totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let allocatedExtraWidth = weights.map(weight => Math.floor((weight / totalWeight) * extraWidth));
    let remainder = extraWidth - allocatedExtraWidth.reduce((sum, width) => sum + width, 0);
    let order = weights
        .map((weight, index) => ({
            index,
            remainder: ((weight / totalWeight) * extraWidth) - allocatedExtraWidth[index]
        }))
        .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

    for (let remainderIndex = 0; remainderIndex < remainder; remainderIndex++) {
        allocatedExtraWidth[order[remainderIndex].index] += 1;
    }

    return allocatedExtraWidth.map(width => MIN_COLUMN_WIDTH + width);
}

function renderWithCliTable(columns, options) {
    let colWidths = getColumnWidths(columns, getTerminalColumns(options));
    let table = new CliTable({
        head: columns.map(getHeader),
        colWidths,
        style: {
            compact: true,
            head: []
        }
    });
    let maxRows = columns.reduce((size, column) => Math.max(size, column.cards.length), 0);

    for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
        table.push(columns.map((column, columnIndex) => {
            let card = column.cards[rowIndex];
            let contentWidth = Math.max(colWidths[columnIndex] - CLI_TABLE_CELL_HORIZONTAL_PADDING, 1);
            return card ? wrapText(getCardText(card), contentWidth) : '';
        }));
    }

    return table.toString();
}

module.exports = function renderBoard(board, options) {
    let columns = board.columns || [];
    return renderWithCliTable(columns, options);
};
