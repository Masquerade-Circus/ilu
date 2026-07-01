import CliTable from 'cli-table';

type RenderCard = {
    title: string;
    position: number;
};

type RenderColumn = {
    title: string;
    wipLimit?: number | null;
    cards: RenderCard[];
};

type RenderOptions = {
    terminalColumns?: number;
};

type RemainderOrder = {
    index: number;
    remainder: number;
};

function getHeader(column: RenderColumn) {
    return column.wipLimit === null || typeof column.wipLimit === 'undefined'
        ? column.title
        : `${column.title} (${column.cards.length}/${column.wipLimit})`;
}
const DEFAULT_TERMINAL_COLUMNS = 80;
const MIN_COLUMN_WIDTH = 5;
const CLI_TABLE_CELL_HORIZONTAL_PADDING = 2;

function getCardText(card: RenderCard) {
    return `${card.position} ${card.title}`;
}

function wrapText(text: unknown, width: number) {
    if (!text || width < 1) {
        return text;
    }

    let paragraphs = String(text).split('\n');

    return paragraphs.map((paragraph: string) => {
        let words = paragraph.match(/\S+/g);

        if (!words) {
            return '';
        }

        let lines: string[] = [];
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

function getTerminalColumns(options: RenderOptions) {
    let terminalColumns = options.terminalColumns;

    if (typeof terminalColumns === 'number' && Number.isInteger(terminalColumns) && terminalColumns > 0) {
        return terminalColumns;
    }

    if (process.stdout && Number.isInteger(process.stdout.columns) && process.stdout.columns > 0) {
        return process.stdout.columns;
    }

    return DEFAULT_TERMINAL_COLUMNS;
}

function getVisibleColumnWidth(column: RenderColumn) {
    let headerWidth = getHeader(column).length;
    let cardWidths = column.cards.map((card: RenderCard) => getCardText(card).length);

    return Math.max(headerWidth, ...cardWidths, 1);
}

function getColumnWidths(columns: RenderColumn[], terminalColumns: number) {
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
    let totalWeight = weights.reduce((sum: number, weight: number) => sum + weight, 0);
    let allocatedExtraWidth = weights.map((weight: number) => Math.floor((weight / totalWeight) * extraWidth));
    let remainder = extraWidth - allocatedExtraWidth.reduce((sum: number, width: number) => sum + width, 0);
    let order = weights
        .map((weight: number, index: number) => ({
            index,
            remainder: ((weight / totalWeight) * extraWidth) - allocatedExtraWidth[index]
        }))
        .sort((left: RemainderOrder, right: RemainderOrder) => right.remainder - left.remainder || left.index - right.index);

    for (let remainderIndex = 0; remainderIndex < remainder; remainderIndex++) {
        allocatedExtraWidth[order[remainderIndex].index] += 1;
    }

    return allocatedExtraWidth.map((width: number) => MIN_COLUMN_WIDTH + width);
}

function renderWithCliTable(columns: RenderColumn[], options: RenderOptions) {
    let colWidths = getColumnWidths(columns, getTerminalColumns(options));
    let table = new CliTable({
        head: columns.map(getHeader),
        colWidths,
        style: {
            compact: true,
            head: []
        }
    });
    let maxRows = columns.reduce((size: number, column: RenderColumn) => Math.max(size, column.cards.length), 0);

    for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
        table.push(columns.map((column: RenderColumn, columnIndex: number) => {
            let card = column.cards[rowIndex];
            let contentWidth = Math.max((colWidths[columnIndex] ?? MIN_COLUMN_WIDTH) - CLI_TABLE_CELL_HORIZONTAL_PADDING, 1);
            return card ? wrapText(getCardText(card), contentWidth) : '';
        }));
    }

    return table.toString();
}

export default function renderBoard(board: {columns?: RenderColumn[]}, options: RenderOptions = {}) {
    let columns = board.columns || [];

    return renderWithCliTable(columns, options);
};
