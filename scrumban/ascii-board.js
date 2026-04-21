function getHeader(column) {
    return column.wipLimit === null || typeof column.wipLimit === 'undefined'
        ? column.title
        : `${column.title} (${column.wipLimit})`;
}

function pad(value, width) {
    return value.padEnd(width, ' ');
}

module.exports = function renderBoard(board) {
    let columns = board.columns || [];
    let widths = columns.map(column => {
        let header = getHeader(column);
        let cardWidths = column.cards.map(card => `${card.position} ${card.title}`.length);
        return Math.max(header.length, ...cardWidths, 12);
    });

    let border = `| ${widths.map(width => '-'.repeat(width)).join(' | ')} |`;
    let header = `| ${columns.map((column, index) => pad(getHeader(column), widths[index])).join(' | ')} |`;
    let maxRows = columns.reduce((size, column) => Math.max(size, column.cards.length), 0);
    let rows = [];

    for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
        rows.push(`| ${columns.map((column, index) => {
            let card = column.cards[rowIndex];
            let text = card ? `${card.position} ${card.title}` : '';
            return pad(text, widths[index]);
        }).join(' | ')} |`);
    }

    return [header, border, ...rows].join('\n');
};
