import fs from "node:fs";
import path from "node:path";

// Text-only VT projection of the real application's PTY bytes, not an app render.
// Pixel acceptance still requires inspecting the physical PNG. Recorded ANSI
// backgrounds expose the real terminal's styling instructions for assertions.
// Unknown screen-changing sequences and wide fixture text fail explicitly rather
// than silently producing click coordinates for a different terminal state.
export function createCaptureScreenReader({ directory }) {
  let { cols, rows } = JSON.parse(fs.readFileSync(path.join(directory, "application.json"), "utf8"));
  let cells = Array.from({ length: rows }, () => Array(cols).fill(" "));
  let backgrounds = Array.from({ length: rows }, () => Array(cols).fill(null));
  let foregrounds = Array.from({ length: rows }, () => Array(cols).fill(null));
  let background = null;
  let foreground = null;
  let x = 0;
  let y = 0;
  let consumed = 0;
  const read = () => {
    const output = fs.readFileSync(path.join(directory, "terminal-output.bin"), "utf8");
    const delta = output.slice(consumed);
    const tokens = delta.match(/\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[78=>]|[^\x1b]/gu) ?? [];
    if (tokens.join("") !== delta) {
      throw new Error("Incomplete or unsupported PTY escape sequence");
    }
    consumed = output.length;
    for (const token of tokens) {
      if (token.startsWith("\x1b]")) {
        continue;
      }
      if (token.startsWith("\x1b[")) {
        const kind = token.at(-1);
        const parameters = token.slice(2, -1);
        const values = parameters.split(";").map(Number);
        if (kind === "m" && !parameters.startsWith(">")) {
          for (let index = 0; index < values.length; index++) {
            const value = values[index];
            if (value === 0 || value === 49) {
              background = null;
            }
            if (value === 0 || value === 39 || (value >= 30 && value <= 37) || (value >= 90 && value <= 97)) {
              foreground = null;
            } else if ((value === 38 || value === 48) && values[index + 1] === 2) {
              const rgb = values.slice(index + 2, index + 5);
              if (
                rgb.length !== 3 ||
                !rgb.every((component) => Number.isInteger(component) && component >= 0 && component <= 255)
              ) {
                throw new Error("Invalid RGB style in the captured PTY");
              }
              if (value === 48) {
                background = `#${rgb.map((component) => component.toString(16).padStart(2, "0")).join("")}`;
              } else {
                foreground = `#${rgb.map((component) => component.toString(16).padStart(2, "0")).join("")}`;
              }
              index += 4;
            } else if (value === 38 && values[index + 1] === 5) {
              foreground = null;
              index += 2;
            } else if (value === 48 || (value >= 40 && value <= 47) || (value >= 100 && value <= 107)) {
              throw new Error("Unsupported captured background palette");
            }
          }
          continue;
        }
        if ((kind === "h" || kind === "l") && parameters.startsWith("?")) {
          if (parameters === "?1049" && kind === "h") {
            cells = Array.from({ length: rows }, () => Array(cols).fill(" "));
            backgrounds = Array.from({ length: rows }, () => Array(cols).fill(background));
            foregrounds = Array.from({ length: rows }, () => Array(cols).fill(foreground));
            x = 0;
            y = 0;
          }
          continue;
        }
        if (
          (kind === "u" && (parameters.startsWith(">") || parameters === "<")) ||
          (kind === "m" && parameters.startsWith(">"))
        ) {
          continue;
        }
        switch (kind) {
          case "H":
          case "f":
            y = Math.min(rows - 1, Math.max(0, (values[0] || 1) - 1));
            x = Math.min(cols - 1, Math.max(0, (values[1] || 1) - 1));
            break;
          case "J":
            if (values[0] === 2 || values[0] === 3) {
              cells = Array.from({ length: rows }, () => Array(cols).fill(" "));
              backgrounds = Array.from({ length: rows }, () => Array(cols).fill(background));
              foregrounds = Array.from({ length: rows }, () => Array(cols).fill(foreground));
            } else if (values[0] === 0) {
              cells[y].fill(" ", x);
              backgrounds[y].fill(background, x);
              foregrounds[y].fill(foreground, x);
              for (let row = y + 1; row < rows; row++) {
                cells[row].fill(" ");
                backgrounds[row].fill(background);
                foregrounds[row].fill(foreground);
              }
            } else {
              throw new Error(`Unsupported terminal erase: ${JSON.stringify(token)}`);
            }
            break;
          case "K":
            cells[y].fill(" ", values[0] === 2 || values[0] === 1 ? 0 : x, values[0] === 1 ? x + 1 : cols);
            backgrounds[y].fill(background, values[0] === 2 || values[0] === 1 ? 0 : x, values[0] === 1 ? x + 1 : cols);
            foregrounds[y].fill(foreground, values[0] === 2 || values[0] === 1 ? 0 : x, values[0] === 1 ? x + 1 : cols);
            break;
          case "A":
            y = Math.max(0, y - (values[0] || 1));
            break;
          case "B":
            y = Math.min(rows - 1, y + (values[0] || 1));
            break;
          case "C":
            x = Math.min(cols - 1, x + (values[0] || 1));
            break;
          case "D":
            x = Math.max(0, x - (values[0] || 1));
            break;
          case "G":
            x = Math.min(cols - 1, Math.max(0, (values[0] || 1) - 1));
            break;
          default:
            throw new Error(`Unsupported terminal control: ${JSON.stringify(token)}`);
        }
        continue;
      }
      if (token === "\r") {
        x = 0;
      } else if (token === "\n") {
        y++;
      } else if (token === "\b") {
        x = Math.max(0, x - 1);
      } else if (token === "\t") {
        x = Math.min(cols - 1, x + 8 - (x % 8));
      } else if (token >= " " && !token.startsWith("\x1b")) {
        if (token.codePointAt(0) >= 0x2e80 || /\p{Mark}/u.test(token)) {
          throw new Error("Capture fixtures require single-cell text for coordinate assertions");
        }
        if (x >= cols) {
          x = 0;
          y++;
        }
        if (y >= rows) {
          cells.shift();
          cells.push(Array(cols).fill(" "));
          backgrounds.shift();
          backgrounds.push(Array(cols).fill(background));
          foregrounds.shift();
          foregrounds.push(Array(cols).fill(foreground));
          y = rows - 1;
        }
        backgrounds[y][x] = background;
        foregrounds[y][x] = foreground;
        cells[y][x++] = token;
      }
    }
    return cells
      .map((line) => line.join("").trimEnd())
      .join("\n")
      .trimEnd();
  };
  return {
    read,
    frame() {
      return {
        cols,
        rows,
        lines: cells.map((line) => line.join("")),
        backgrounds: backgrounds.map((line) => [...line]),
        foregrounds: foregrounds.map((line) => [...line])
      };
    },
    resize(size) {
      read();
      cols = size.cols;
      rows = size.rows;
      cells = Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, column) => cells[row]?.[column] ?? " ")
      );
      backgrounds = Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, column) => backgrounds[row]?.[column] ?? null)
      );
      foregrounds = Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, column) => foregrounds[row]?.[column] ?? null)
      );
      x = Math.min(x, cols - 1);
      y = Math.min(y, rows - 1);
    }
  };
}
