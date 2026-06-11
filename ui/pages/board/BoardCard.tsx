import type { BoardCard, BoardColumn, Selection } from "../../types";

export function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

export function wrapText(value: unknown, width: number): string[] {
  const text = String(value).replace(/\s+/g, " ").trim();

  if (text.length === 0) {
    return [""];
  }

  if (!positiveInteger(width)) {
    return [text];
  }

  const lines: string[] = [];
  let current = "";

  for (const word of text.split(" ")) {
    if (word.length > width) {
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }

      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      continue;
    }

    const next = current.length > 0 ? `${current} ${word}` : word;

    if (next.length <= width) {
      current = next;
      continue;
    }

    if (current.length > 0) {
      lines.push(current);
    }
    current = word;
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

export function normalizeBoardCard(card: BoardCard | string | null | undefined): BoardCard | null {
  if (typeof card === "string") {
    return { title: card, description: "" };
  }

  if (typeof card !== "object" || card === null) {
    return null;
  }

  const { title, description, ...rest } = card;

  return {
    ...rest,
    title: typeof title === "string" ? title : "",
    description: typeof description === "string" ? description : ""
  };
}

export function getBoardColumn(board: { columns?: BoardColumn[] } | null | undefined, columnIndex: number): BoardColumn | null {
  return Array.isArray(board?.columns) ? board.columns[columnIndex - 1] ?? null : null;
}

export function getBoardCard(
  board: { columns?: BoardColumn[] } | null | undefined,
  selection: Selection | null | undefined
): (BoardCard & Selection & { column: BoardColumn }) | null {
  const column = selection ? getBoardColumn(board, selection.columnIndex) : null;
  const card = column && Array.isArray(column.cards) ? normalizeBoardCard(column.cards[selection!.position - 1]) : null;

  if (card === null || typeof card.title !== "string" || card.title.length === 0 || !selection || column === null) {
    return null;
  }

  return { column, ...card, columnIndex: selection.columnIndex, position: selection.position };
}
