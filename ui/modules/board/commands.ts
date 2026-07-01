import type {
  TerminalCommand,
  TerminalCommandContext,
  TerminalKeyBinding
} from "@valyrianjs/terminal";
import type {
  BoardActionResult,
  BoardActions,
  BoardColumn,
  BoardRuntimeState,
  BoardSnapshot,
  Selection,
  UiSnapshot
} from "../../types";
import { getBoardCard, getBoardColumn } from "./BoardCard";
import { positiveInteger } from "./number-guards";
import {
  closeBoardOverlay,
  isBoardOverlayState,
  openBoardAddCardModal
} from "./state";

type SnapshotRef = {
  current: UiSnapshot;
  refresh: (domain?: "board") => UiSnapshot;
};

export function safeBoardActionResult(result: unknown, fallback: string = "Card could not be saved. Try again."): BoardActionResult {
  if (typeof result === "object" && result !== null && typeof (result as Record<string, unknown>).ok === "boolean") {
    return result as BoardActionResult;
  }

  return { ok: false, error: fallback };
}

export function sameBoardSelection(left: Selection | null | undefined, right: Selection | null | undefined): boolean {
  return Boolean(left && right && left.columnIndex === right.columnIndex && left.position === right.position);
}

export function createBoardKeyBindings(): TerminalKeyBinding[] {
  return [
    { key: "o", command: { id: "ilu.board-open-details" }, scope: "global", when: { focusedTag: "terminal-list" } },
    { key: "O", command: { id: "ilu.board-open-details" }, scope: "global", when: { focusedTag: "terminal-list" } },
    { key: "o", command: { id: "ilu.board-open-details" }, scope: "global", when: { focusedTag: "terminal-button" } },
    { key: "O", command: { id: "ilu.board-open-details" }, scope: "global", when: { focusedTag: "terminal-button" } },
    { key: "SHIFT_UP", command: { id: "ilu.board-card-priority-up" }, scope: "list", when: { focusedTag: "terminal-list" } },
    { key: "SHIFT_DOWN", command: { id: "ilu.board-card-priority-down" }, scope: "list", when: { focusedTag: "terminal-list" } },
    { key: "LEFT", command: { id: "ilu.column-left" }, scope: "global", when: { focusedTag: "terminal-list" } },
    { key: "RIGHT", command: { id: "ilu.column-right" }, scope: "global", when: { focusedTag: "terminal-list" } },
    { key: "LEFT", command: { id: "ilu.board-column-header-left" }, scope: "global", when: { focusedTag: "terminal-button" } },
    { key: "RIGHT", command: { id: "ilu.board-column-header-right" }, scope: "global", when: { focusedTag: "terminal-button" } }
  ];
}

function boardCardListHasKeyFocus(context: TerminalCommandContext | null | undefined): boolean {
  return context?.focusedTag === "terminal-list" && typeof context.focusedId === "string" && context.focusedId.startsWith("board-card-list-");
}

function focusedBoardColumnIndex(context: TerminalCommandContext | null | undefined): number | null {
  const focusedId = typeof context?.focusedId === "string" ? context.focusedId : "";
  const match = focusedId.match(/^board-card-list-(\d+)$/);

  if (!match) {
    return null;
  }

  const columnIndex = Number(match[1]);
  return positiveInteger(columnIndex) ? columnIndex : null;
}

function focusedBoardColumnHeaderIndex(context: TerminalCommandContext | null | undefined): number | null {
  const focusedId = typeof context?.focusedId === "string" ? context.focusedId : "";
  const match = focusedId.match(/^board-column-header-(\d+)$/);

  if (!match) {
    return null;
  }

  const columnIndex = Number(match[1]);
  return positiveInteger(columnIndex) ? columnIndex : null;
}

function firstSelectionInColumn(board: BoardSnapshot, columnIndex: number): Selection | null {
  const column = getBoardColumn(board, columnIndex);

  if (!column || !Array.isArray(column.cards) || column.cards.length === 0) {
    return null;
  }

  const firstCard = column.cards[0];
  const position = typeof firstCard === "object" && firstCard !== null && positiveInteger(firstCard.position) ? firstCard.position : 1;
  return { columnIndex, position };
}

function boardColumnsFromSnapshot(snapshotRef: SnapshotRef): BoardColumn[] {
  const columns = snapshotRef.current && snapshotRef.current.board ? snapshotRef.current.board.columns : null;

  return Array.isArray(columns) ? columns : [];
}

export function handleBoardColumnKeyCommand(command: TerminalCommand, state: BoardRuntimeState, snapshotRef: SnapshotRef, boardActions: BoardActions, isActive: boolean = true, context?: TerminalCommandContext): boolean {
  if (command.id !== "ilu.column-left" && command.id !== "ilu.column-right" && command.id !== "ilu.board-column-header-left" && command.id !== "ilu.board-column-header-right") {
    return false;
  }

  if (!isActive || state.overlay !== null) {
    return false;
  }

  const columns = boardColumnsFromSnapshot(snapshotRef);

  if (command.id === "ilu.board-column-header-left" || command.id === "ilu.board-column-header-right") {
    const columnIndex = focusedBoardColumnHeaderIndex(context);

    if (columns.length === 0 || columnIndex === null) {
      return false;
    }

    const toColumn = command.id === "ilu.board-column-header-left" ? columnIndex - 1 : columnIndex + 1;

    if (toColumn < 1 || toColumn > columns.length) {
      return true;
    }

    const moveColumn = command.id === "ilu.board-column-header-left" ? boardActions.moveColumnLeft : boardActions.moveColumnRight;

    if (typeof moveColumn !== "function") {
      state.actionError = "Column could not be moved. Try again.";
      state.overlay = "card-action-error";
      return true;
    }

    const result = safeBoardActionResult(moveColumn({ columnIndex }), "Column could not be moved. Try again.");

    if (!result.ok) {
      state.actionError = String(result.error || "Column could not be moved. Try again.");
      state.overlay = "card-action-error";
      return true;
    }

    snapshotRef.refresh("board");
    state.selectedColumnIndex = toColumn;
    state.selectedCard = null;
    state.pendingFocus = `board-column-header-${toColumn}`;
    return true;
  }

  const selection = state.selectedCard;

  if (columns.length === 0 || !selection || !positiveInteger(selection.columnIndex) || !positiveInteger(selection.position)) {
    return true;
  }

  const fromColumn = selection.columnIndex;
  const toColumn = command.id === "ilu.column-left" ? fromColumn - 1 : fromColumn + 1;

  if (toColumn < 1 || toColumn > columns.length) {
    return true;
  }

  const sourceCards = Array.isArray(columns[fromColumn - 1]?.cards) ? columns[fromColumn - 1].cards || [] : [];
  const targetCards = Array.isArray(columns[toColumn - 1]?.cards) ? columns[toColumn - 1].cards || [] : [];

  if (selection.position > sourceCards.length) {
    return true;
  }

  if (typeof boardActions.moveCard !== "function") {
    state.actionError = "Card could not be moved. Try again.";
    state.overlay = "card-action-error";
    return true;
  }

  const targetPosition = targetCards.length + 1;
  const result = safeBoardActionResult(boardActions.moveCard({ fromColumn, fromPosition: selection.position, toColumn }), "Card could not be moved. Try again.");

  if (!result.ok) {
    state.actionError = String(result.error || "Card could not be moved. Try again.");
    state.overlay = "card-action-error";
    return true;
  }

  snapshotRef.refresh("board");
  state.selectedColumnIndex = toColumn;
  state.selectedCard = { columnIndex: toColumn, position: targetPosition };
  state.pendingFocus = `board-card-list-${toColumn}`;
  return true;
}

function handleBoardCardPriorityKeyCommand(command: TerminalCommand, state: BoardRuntimeState, snapshotRef: SnapshotRef, boardActions: BoardActions, isActive: boolean = true, context?: TerminalCommandContext): boolean {
  if (command.id !== "ilu.board-card-priority-up" && command.id !== "ilu.board-card-priority-down") {
    return false;
  }

  if (!isActive || state.overlay !== null || !boardCardListHasKeyFocus(context)) {
    return false;
  }

  const columnIndex = focusedBoardColumnIndex(context);
  const currentBoard = snapshotRef.current.board || {} as BoardSnapshot;
  const selection = state.selectedCard && state.selectedCard.columnIndex === columnIndex
    ? state.selectedCard
    : columnIndex === null
      ? null
      : firstSelectionInColumn(currentBoard, columnIndex);

  if (columnIndex === null || !selection || !positiveInteger(selection.position)) {
    return true;
  }

  const column = getBoardColumn(currentBoard, columnIndex);
  const cards = Array.isArray(column?.cards) ? column.cards : [];
  const toPosition = command.id === "ilu.board-card-priority-up" ? selection.position - 1 : selection.position + 1;

  if (toPosition < 1 || toPosition > cards.length) {
    return true;
  }

  if (typeof boardActions.prioritizeCard !== "function") {
    state.actionError = "Priority could not be changed. Try again.";
    state.overlay = "card-action-error";
    return true;
  }

  const result = safeBoardActionResult(boardActions.prioritizeCard({ columnIndex, position: selection.position, toPosition }), "Priority could not be changed. Try again.");

  if (!result.ok) {
    state.actionError = String(result.error || "Priority could not be changed. Try again.");
    state.overlay = "card-action-error";
    return true;
  }

  snapshotRef.refresh("board");
  state.selectedColumnIndex = columnIndex;
  state.selectedCard = { columnIndex, position: toPosition };
  state.pendingFocus = `board-card-list-${columnIndex}`;
  state.actionError = "";
  return true;
}

function resetBoardDestructiveArming(state: BoardRuntimeState): void {
  state.removeCardArmedUntil = 0;
  state.removeCardArmedSelection = null;
  state.removeColumnArmedUntil = 0;
  state.removeColumnArmedIndex = null;
}

function openBoardCardDetailsFromKeyboard(state: BoardRuntimeState, snapshotRef: SnapshotRef, context?: TerminalCommandContext): boolean {
  const columnIndex = focusedBoardColumnIndex(context);
  const currentBoard = snapshotRef.current.board || {} as BoardSnapshot;
  const selection = state.selectedCard && state.selectedCard.columnIndex === columnIndex
    ? state.selectedCard
    : columnIndex === null
      ? null
      : firstSelectionInColumn(currentBoard, columnIndex);
  const details = getBoardCard(currentBoard, selection);

  if (!details) {
    state.actionError = "Choose a card first.";
    state.overlay = "card-action-error";
    return true;
  }

  resetBoardDestructiveArming(state);
  state.selectedCard = { columnIndex: details.columnIndex, position: details.position };
  state.selectedColumnIndex = details.columnIndex;
  state.overlay = "card-details";
  state.pendingFocus = "board-card-details-scroll";
  return true;
}

function openBoardColumnDetailsFromKeyboard(state: BoardRuntimeState, snapshotRef: SnapshotRef, context?: TerminalCommandContext): boolean {
  const columnIndex = focusedBoardColumnHeaderIndex(context);
  const currentBoard = snapshotRef.current.board || {} as BoardSnapshot;
  const columns = Array.isArray(currentBoard.columns) ? currentBoard.columns : [];

  if (columnIndex === null) {
    return false;
  }

  state.selectedColumnIndex = columnIndex;

  if (columns.length === 0) {
    resetBoardDestructiveArming(state);
    state.overlay = "column-details";
    state.pendingFocus = "board-add-column";
    return true;
  }

  if (!getBoardColumn(currentBoard, columnIndex)) {
    state.actionError = "Choose a column first.";
    state.overlay = "card-action-error";
    return true;
  }

  resetBoardDestructiveArming(state);
  state.overlay = "column-details";
  state.pendingFocus = "board-remove-column";
  return true;
}

function handleBoardOpenDetailsKeyCommand(command: TerminalCommand, state: BoardRuntimeState, snapshotRef: SnapshotRef, isActive: boolean = true, context?: TerminalCommandContext): boolean {
  if (command.id !== "ilu.board-open-details") {
    return false;
  }

  if (!isActive || state.overlay !== null) {
    return false;
  }

  if (boardCardListHasKeyFocus(context)) {
    return openBoardCardDetailsFromKeyboard(state, snapshotRef, context);
  }

  return openBoardColumnDetailsFromKeyboard(state, snapshotRef, context);
}

export function handleBoardCommand(
  command: TerminalCommand,
  state: BoardRuntimeState,
  snapshotRef: SnapshotRef,
  boardActions: BoardActions,
  isActive: boolean = true,
  context?: TerminalCommandContext
): boolean {
  if (command.id === "ilu.add") {
    if (!isActive) {
      return false;
    }

    openBoardAddCardModal(state);
    return true;
  }

  if (isActive && (command.id === "ilu.cancel" || command.id === "ilu.escape") && isBoardOverlayState(state.overlay)) {
    closeBoardOverlay(state);
    return true;
  }

  if (handleBoardCardPriorityKeyCommand(command, state, snapshotRef, boardActions, isActive, context)) {
    return true;
  }

  if (handleBoardOpenDetailsKeyCommand(command, state, snapshotRef, isActive, context)) {
    return true;
  }

  return handleBoardColumnKeyCommand(command, state, snapshotRef, boardActions, isActive, context);
}
