import fs from 'node:fs';
import path from 'node:path';

// Text-only VT projection of the real application's PTY bytes, not an app render.
// Pixels/colors are accepted by inspecting the physical PNG, never this projection.
// Unknown screen-changing sequences and wide fixture text fail explicitly rather
// than silently producing click coordinates for a different terminal state.
export function createCaptureScreenReader({directory}) {
  let {cols, rows} = JSON.parse(fs.readFileSync(path.join(directory, 'application.json'), 'utf8'));
  let cells = Array.from({length: rows}, () => Array(cols).fill(' '));
  let x = 0;
  let y = 0;
  let consumed = 0;
  const read = () => {
  const output = fs.readFileSync(path.join(directory, 'terminal-output.bin'), 'utf8');
  const delta = output.slice(consumed);
  const tokens = delta.match(/\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[78=>]|[^\x1b]/gu) ?? [];
  if (tokens.join('') !== delta) {
    throw new Error('Incomplete or unsupported PTY escape sequence');
  }
  consumed = output.length;
  for (const token of tokens) {
    if (token.startsWith('\x1b]')) {
      continue;
    }
    if (token.startsWith('\x1b[')) {
      const kind = token.at(-1);
      const parameters = token.slice(2, -1);
      const values = parameters.split(';').map(Number);
      if (kind === 'm' || ((kind === 'h' || kind === 'l') && parameters.startsWith('?'))) {
        if (parameters === '?1049' && kind === 'h') {
          cells = Array.from({length: rows}, () => Array(cols).fill(' '));
          x = 0;
          y = 0;
        }
        continue;
      }
      if ((kind === 'u' && parameters.startsWith('>')) || (kind === 'm' && parameters.startsWith('>'))) {
        continue;
      }
      switch (kind) {
        case 'H':
        case 'f':
          y = Math.min(rows - 1, Math.max(0, (values[0] || 1) - 1));
          x = Math.min(cols - 1, Math.max(0, (values[1] || 1) - 1));
          break;
        case 'J':
          if (values[0] === 2 || values[0] === 3) {
            cells = Array.from({length: rows}, () => Array(cols).fill(' '));
          } else if (values[0] === 0) {
            cells[y].fill(' ', x);
            for (let row = y + 1; row < rows; row++) {
              cells[row].fill(' ');
            }
          } else {
            throw new Error(`Unsupported terminal erase: ${JSON.stringify(token)}`);
          }
          break;
        case 'K':
          cells[y].fill(' ', values[0] === 2 || values[0] === 1 ? 0 : x, values[0] === 1 ? x + 1 : cols);
          break;
        case 'A': y = Math.max(0, y - (values[0] || 1)); break;
        case 'B': y = Math.min(rows - 1, y + (values[0] || 1)); break;
        case 'C': x = Math.min(cols - 1, x + (values[0] || 1)); break;
        case 'D': x = Math.max(0, x - (values[0] || 1)); break;
        case 'G': x = Math.min(cols - 1, Math.max(0, (values[0] || 1) - 1)); break;
        default: throw new Error(`Unsupported terminal control: ${JSON.stringify(token)}`);
      }
      continue;
    }
    if (token === '\r') {
      x = 0;
    } else if (token === '\n') {
      y++;
    } else if (token === '\b') {
      x = Math.max(0, x - 1);
    } else if (token === '\t') {
      x = Math.min(cols - 1, x + 8 - x % 8);
    } else if (token >= ' ' && !token.startsWith('\x1b')) {
      if (token.codePointAt(0) >= 0x2e80 || /\p{Mark}/u.test(token)) {
        throw new Error('Capture fixtures require single-cell text for coordinate assertions');
      }
      if (x >= cols) {
        x = 0;
        y++;
      }
      if (y >= rows) {
        cells.shift();
        cells.push(Array(cols).fill(' '));
        y = rows - 1;
      }
      cells[y][x++] = token;
    }
  }
  return cells.map(line => line.join('').trimEnd()).join('\n').trimEnd();
  };
  return {
    read,
    resize(size) {
      read();
      cols = size.cols;
      rows = size.rows;
      cells = Array.from({length: rows}, (_, row) => Array.from({length: cols}, (_, column) => cells[row]?.[column] ?? ' '));
      x = Math.min(x, cols - 1);
      y = Math.min(y, rows - 1);
    }
  };
}
