import type {
  BoardId,
  BoardRuntimeState,
  CardFormState,
  Selection,
  TextFormState,
  TitleFormState
} from "../../types";
import { positiveInteger } from "./number-guards";

const BOARD_OVERLAY_STATES = Object.freeze([
  "add-card",
  "card-action-error",
  "card-details",
  "edit-card",
  "move-card",
  "priority-card",
  "remove-card-confirm",
  "column-details",
  "add-column",
  "rename-column",
  "board-details",
  "add-board",
  "rename-board",
  "remove-board-confirm",
  "set-wip-limit",
  "reset-columns-confirm"
] as const);

export function isBoardOverlayState(value: unknown): boolean {
  return typeof value === "string" && (BOARD_OVERLAY_STATES as readonly string[]).includes(value);
}

export function normalizeCardFormState(value: unknown = null): CardFormState {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

  return {
    title: typeof source.title === "string" ? source.title : "",
    description: typeof source.description === "string" ? source.description : "",
    error: typeof source.error === "string" ? source.error : ""
  };
}

export function normalizeTitleFormState(value: unknown = null): TitleFormState {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

  return {
    title: typeof source.title === "string" ? source.title : "",
    error: typeof source.error === "string" ? source.error : ""
  };
}

export function normalizeAddCardState(value: unknown = null): CardFormState {
  return normalizeCardFormState(value);
}

export function normalizeTextFormState(value: unknown = null): TextFormState {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

  return {
    title: typeof source.title === "string" ? source.title : "",
    description: typeof source.description === "string" ? source.description : "",
    error: typeof source.error === "string" ? source.error : ""
  };
}

function normalizeBoardId(value: unknown): BoardId | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return null;
}

export function normalizeSelection(value: unknown): Selection | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const columnIndex = source.columnIndex;
  const position = source.position;

  if (!positiveInteger(columnIndex) || !positiveInteger(position)) {
    return null;
  }

  return { columnIndex, position };
}

export function boardCardListFocusId(state: Pick<BoardRuntimeState, "selectedColumnIndex">): string {
  const columnIndex = positiveInteger(state.selectedColumnIndex) ? state.selectedColumnIndex : 1;

  return `board-card-list-${columnIndex}`;
}

export function getBoardPendingFocus(state: Pick<BoardRuntimeState, "selectedColumnIndex">): string {
  return boardCardListFocusId(state);
}

export function createInitialBoardState(overrides: Partial<BoardRuntimeState> | Record<string, unknown> = {}): BoardRuntimeState {
  const source = typeof overrides === "object" && overrides !== null ? overrides as Record<string, unknown> : {};
  const state: BoardRuntimeState = {
    addCard: normalizeAddCardState(source.addCard),
    editCard: normalizeCardFormState(source.editCard),
    addColumn: normalizeTitleFormState(source.addColumn),
    renameColumn: normalizeTitleFormState(source.renameColumn),
    addBoard: normalizeTextFormState(source.addBoard),
    renameBoard: normalizeTextFormState(source.renameBoard),
    wipLimit: normalizeTitleFormState(source.wipLimit),
    selectedCard: normalizeSelection(source.selectedCard),
    selectedColumnIndex: positiveInteger(source.selectedColumnIndex) ? source.selectedColumnIndex : 1,
    selectedBoardId: normalizeBoardId(source.selectedBoardId),
    actionError: typeof source.actionError === "string" ? source.actionError : "",
    overlay: typeof source.overlay === "string" && isBoardOverlayState(source.overlay) ? source.overlay : null,
    pendingFocus: typeof source.pendingFocus === "string" ? source.pendingFocus : null,
    removeCardArmedUntil: positiveInteger(source.removeCardArmedUntil) ? source.removeCardArmedUntil : 0,
    removeCardArmedSelection: normalizeSelection(source.removeCardArmedSelection),
    removeColumnArmedUntil: positiveInteger(source.removeColumnArmedUntil) ? source.removeColumnArmedUntil : 0,
    removeColumnArmedIndex: positiveInteger(source.removeColumnArmedIndex) ? source.removeColumnArmedIndex : null
  };

  normalizeBoardRuntimeState(state);
  return state;
}

export function normalizeBoardRuntimeState(state: BoardRuntimeState): void {
  state.addCard = normalizeAddCardState(state.addCard);
  state.editCard = normalizeCardFormState(state.editCard);
  state.addColumn = normalizeTitleFormState(state.addColumn);
  state.renameColumn = normalizeTitleFormState(state.renameColumn);
  state.addBoard = normalizeTextFormState(state.addBoard);
  state.renameBoard = normalizeTextFormState(state.renameBoard);
  state.wipLimit = normalizeTitleFormState(state.wipLimit);
  state.selectedCard = normalizeSelection(state.selectedCard);
  state.selectedColumnIndex = positiveInteger(state.selectedColumnIndex) ? state.selectedColumnIndex : 1;
  state.selectedBoardId = normalizeBoardId(state.selectedBoardId);
  state.actionError = typeof state.actionError === "string" ? state.actionError : "";
  state.removeCardArmedUntil = positiveInteger(state.removeCardArmedUntil) ? state.removeCardArmedUntil : 0;
  state.removeCardArmedSelection = normalizeSelection(state.removeCardArmedSelection);
  state.removeColumnArmedUntil = positiveInteger(state.removeColumnArmedUntil) ? state.removeColumnArmedUntil : 0;
  state.removeColumnArmedIndex = positiveInteger(state.removeColumnArmedIndex) ? state.removeColumnArmedIndex : null;

  if (typeof state.overlay !== "string" || !isBoardOverlayState(state.overlay)) {
    state.overlay = null;
  }

  state.pendingFocus = typeof state.pendingFocus === "string"
    ? state.pendingFocus
    : state.overlay === null
      ? getBoardPendingFocus(state)
      : null;
}

export function openBoardAddCardModal(state: BoardRuntimeState): void {
  state.overlay = "add-card";
  state.addCard = normalizeAddCardState();
  state.pendingFocus = "board-add-title";
}

export function clearBoardUiOverlay(state: BoardRuntimeState): void {
  closeBoardOverlay(state);
}

export function closeBoardOverlay(state: BoardRuntimeState): void {
  state.overlay = null;
  state.addCard = normalizeAddCardState();
  state.editCard = normalizeCardFormState();
  state.addColumn = normalizeTitleFormState();
  state.renameColumn = normalizeTitleFormState();
  state.addBoard = normalizeTextFormState();
  state.renameBoard = normalizeTextFormState();
  state.wipLimit = normalizeTitleFormState();
  state.actionError = "";
  state.pendingFocus = boardCardListFocusId(state);
  state.removeCardArmedUntil = 0;
  state.removeCardArmedSelection = null;
  state.removeColumnArmedUntil = 0;
  state.removeColumnArmedIndex = null;
}
