import {
  Button,
  Editor,
  Fixed,
  FocusScope,
  Hr,
  Input,
  List,
  NumberInput,
  Pane,
  ScrollView,
  Split,
  Text,
  View
} from "@valyrianjs/terminal";
import type {
  TerminalCommand,
  TerminalCommandContext,
  TerminalEditorChangeEventPayload,
  TerminalInputChangeEventPayload,
  TerminalKeyBinding,
  TerminalListActiveEventPayload,
  TerminalListPressEventPayload,
  TerminalNumberSubmitEventPayload
} from "@valyrianjs/terminal";
import type {
  BoardRuntimeState,
  BoardActions,
  BoardActionResult,
  BoardCard,
  BoardColumn,
  BoardId,
  BoardLayout,
  BoardSnapshot,
  RefreshSnapshot,
  BoardSummary,
  CardFormState,
  Selection,
  TitleFormState,
  TextFormState,
  UiSnapshot
} from "../../types";
import { createButton, createButtonStatus } from "../../components/Button";
import { EditOverlay } from "../../components/EditOverlay";
import { AppOverlay } from "../../components/Overlay";
import { emptyStateText, errorStateText } from "../../components/StateText";
import {
  CARD_DETAILS_SURFACE_STYLE,
  CONTROL_BUTTON_STYLE
} from "../../theme";
import { getBoardCard, getBoardColumn, positiveInteger } from "./BoardCard";
import { createBoardActionBar } from "./BoardActionBar";
import { createBoardColumnNode } from "./BoardColumn";

const BOARD_SHELL_FIXED_ROWS = 5;
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

function isBoardOverlayState(value: unknown): boolean {
  return typeof value === "string" && (BOARD_OVERLAY_STATES as readonly string[]).includes(value);
}

type SnapshotRef = {
  current: UiSnapshot;
  refresh: (domain?: "board") => UiSnapshot;
};

type BoardMainViewOptions = {
  board: BoardSnapshot;
  state: BoardRuntimeState;
  isActive: boolean;
  width: number;
  boardActions: BoardActions;
  refreshSnapshot: RefreshSnapshot;
  utilityActions?: JSX.Element[];
};

type BoardMainViewResult = {
  activePanelNodes: JSX.Element[];
  actionBar: JSX.Element | null;
  overlays: Array<JSX.Element | null>;
};

export function boardSwitchElementId(board: BoardSummary, index: number): string {
  const rawId = typeof board.id === "string" || typeof board.id === "number" ? String(board.id) : `board-${index + 1}`;
  return rawId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || `board-${index + 1}`;
}

function boardSelectorItems(board: BoardSnapshot): BoardSummary[] {
  if (Array.isArray(board.boards) && board.boards.length > 0) {
    return board.boards;
  }

  const title = typeof board.title === "string" && board.title.trim().length > 0 ? board.title.trim() : "No board yet";
  return [{ id: typeof board.id === "string" || typeof board.id === "number" ? board.id : "current", title, current: true }];
}

type BoardSelectorHandlers = {
  switchBoard?: (id: BoardId) => void;
  openBoardDetails?: (id: BoardId) => void;
};

function renderBoardSelector(board: BoardSnapshot, handlers: BoardSelectorHandlers = {}): JSX.Element {
  const boards = boardSelectorItems(board);

  return (
    <View direction="row" gap={1}>
      {boards.map((item, index) => {
        const id = boardSwitchElementId(item, index);
        const label = typeof item.title === "string" && item.title.trim().length > 0 ? item.title.trim() : "Untitled board";
        const active = item.current === true || ((typeof board.id === "string" || typeof board.id === "number") && item.id === board.id);

        return (
          <Button
            id={`board-switch-${id}`}
            label={label}
            style={CONTROL_BUTTON_STYLE}
            styles={{ selected: "button.focus", focus: "button.focus", hover: "button.hover" }}
            state={active ? "selected" : undefined}
            onpress={() => {
              if (typeof handlers.switchBoard === "function" && (typeof item.id === "string" || typeof item.id === "number")) {
                handlers.switchBoard(item.id);
              }
            }}
            ondoublepress={() => {
              if (typeof handlers.openBoardDetails === "function" && (typeof item.id === "string" || typeof item.id === "number")) {
                handlers.openBoardDetails(item.id);
              }
            }}
          />
        );
      })}
    </View>
  );
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

function wrappedTerminalText(value: string, width: number): string {
  const safeWidth = positiveInteger(width) ? width : 1;
  const words = value.trim().split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (word.length > safeWidth) {
      if (currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = "";
      }

      for (let index = 0; index < word.length; index += safeWidth) {
        lines.push(word.slice(index, index + safeWidth));
      }

      continue;
    }

    const candidate = currentLine.length > 0 ? currentLine + " " + word : word;

    if (candidate.length <= safeWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    currentLine = word;
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines.join("\n") : "";
}

function cardDetailsHeadingWidth(totalWidth: number): number {
  const paneHorizontalChrome = 4;

  return Math.max(1, totalWidth - paneHorizontalChrome);
}

function safeActionResult(result: unknown, fallback = "Card could not be saved. Try again."): BoardActionResult {
  if (typeof result === "object" && result !== null && typeof (result as Record<string, unknown>).ok === "boolean") {
    return result as BoardActionResult;
  }

  return { ok: false, error: fallback };
}

function boardColumnsFromSnapshot(snapshotRef: SnapshotRef): BoardColumn[] {
  const columns = snapshotRef.current && snapshotRef.current.board ? snapshotRef.current.board.columns : null;

  return Array.isArray(columns) ? columns : [];
}

function sameSelection(left: Selection | null | undefined, right: Selection | null | undefined): boolean {
  return Boolean(left && right && left.columnIndex === right.columnIndex && left.position === right.position);
}

export function handleBoardColumnKeyCommand(command: TerminalCommand, state: BoardRuntimeState, snapshotRef: SnapshotRef, boardActions: BoardActions, isActive = true, context?: TerminalCommandContext): boolean {
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

    const result = safeActionResult(moveColumn({ columnIndex }), "Column could not be moved. Try again.");

    if (!result.ok) {
      state.actionError = result.error || "Column could not be moved. Try again.";
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
  const result = safeActionResult(boardActions.moveCard({ fromColumn, fromPosition: selection.position, toColumn }), "Card could not be moved. Try again.");

  if (!result.ok) {
    state.actionError = result.error || "Card could not be moved. Try again.";
    state.overlay = "card-action-error";
    return true;
  }

  snapshotRef.refresh("board");
  state.selectedColumnIndex = toColumn;
  state.selectedCard = { columnIndex: toColumn, position: targetPosition };
  state.pendingFocus = `board-card-list-${toColumn}`;
  return true;
}

function handleBoardCardPriorityKeyCommand(command: TerminalCommand, state: BoardRuntimeState, snapshotRef: SnapshotRef, boardActions: BoardActions, isActive = true, context?: TerminalCommandContext): boolean {
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

  const result = safeActionResult(boardActions.prioritizeCard({ columnIndex, position: selection.position, toPosition }), "Priority could not be changed. Try again.");

  if (!result.ok) {
    state.actionError = result.error || "Priority could not be changed. Try again.";
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

function handleBoardOpenDetailsKeyCommand(command: TerminalCommand, state: BoardRuntimeState, snapshotRef: SnapshotRef, isActive = true, context?: TerminalCommandContext): boolean {
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
  isActive = true,
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

export function renderBoardNodes(board: BoardSnapshot, state: BoardRuntimeState, layout: BoardLayout): JSX.Element[] {
  if (typeof board.error === "string" && board.error.length > 0) {
    return [errorStateText(board.error)];
  }

  const selector = renderBoardSelector(board, { switchBoard: layout.switchBoard, openBoardDetails: layout.openBoardDetails });

  if (!Array.isArray(board.columns) || board.columns.length === 0) {
    return [
      <Pane fill={true}>
        <Fixed position="top" size={1}>{selector}</Fixed>
        {emptyStateText("No columns yet. Add a column to get started.")}
      </Pane>
    ];
  }

  const columns = board.columns;
  const gap = 0;
  const boardWidth = Math.max(1, layout.width - 2);
  const columnWidth = Math.max(1, Math.floor(boardWidth / columns.length));
  const columnNodes = columns.map((column, columnOffset) => {
    return createBoardColumnNode(column, columnOffset, columnWidth, state, layout.openCardDetails, layout.openColumnDetails);
  });

  return [
    <Pane fill={true}>
      <Fixed position="top" size={1}>{selector}</Fixed>
      <Split width={boardWidth} fill={true} direction="row" gap={gap} sizes={columns.map(() => "1fr")}>{columnNodes}</Split>
    </Pane>
  ];
}

export function createBoardMainView(options: BoardMainViewOptions): BoardMainViewResult {
  const { board, boardActions, isActive, refreshSnapshot, state, width } = options;

  function currentBoard(): BoardSnapshot {
    return board || {} as BoardSnapshot;
  }

  function selectedCardDetails(): (BoardCard & Selection & { column: BoardColumn }) | null {
    return getBoardCard(currentBoard(), state.selectedCard);
  }

  function selectedColumn(): BoardColumn | null {
    return getBoardColumn(currentBoard(), state.selectedColumnIndex);
  }

  function cardCountInColumn(columnIndex: number): number {
    const column = getBoardColumn(currentBoard(), columnIndex);

    return column && Array.isArray(column.cards) ? column.cards.length : 0;
  }

  function resetBoardSelection(): void {
    state.selectedCard = null;
    state.selectedColumnIndex = 1;
    clearRemoveColumnArming();
    state.pendingFocus = "board-card-list-1";
  }

  function switchBoard(id: BoardId): void {
    if (typeof boardActions.useBoard !== "function") {
      state.actionError = "We couldn’t open this board. Try again.";
      state.overlay = "card-action-error";
      return;
    }

    if (applyBoardResult(boardActions.useBoard({ id }), "We couldn’t open this board. Try again.")) {
      resetBoardSelection();
    }
  }


  function currentBoardSummaries(): BoardSummary[] {
    return Array.isArray(currentBoard().boards) ? currentBoard().boards || [] : [];
  }

  function boardById(id: BoardId | null): BoardSummary | null {
    if (id === null) {
      return null;
    }

    return currentBoardSummaries().find((item) => item.id === id) || null;
  }

  function currentBoardSummary(): BoardSummary | null {
    const boards = currentBoardSummaries();
    const current = boards.find((item) => item.current === true);

    if (current) {
      return current;
    }

    const boardId = currentBoard().id;

    if (typeof boardId === "string" || typeof boardId === "number") {
      return boards.find((item) => item.id === boardId) || null;
    }

    return boards[0] || null;
  }

  function selectedBoardSummary(): BoardSummary | null {
    return boardById(state.selectedBoardId) || currentBoardSummary();
  }

  function selectedBoardId(): BoardId | null {
    const selected = selectedBoardSummary();

    if (selected && (typeof selected.id === "string" || typeof selected.id === "number")) {
      return selected.id;
    }

    return null;
  }

  function setBoardTarget(id: BoardId): void {
    state.selectedBoardId = id;
  }

  function openBoardDetails(id: BoardId): void {
    const board = boardById(id);

    if (!board) {
      state.actionError = "Choose a board first.";
      state.overlay = "card-action-error";
      return;
    }

    state.selectedBoardId = id;
    state.overlay = "board-details";
    state.pendingFocus = "board-board-details-scroll";
  }

  function openAddBoard(): void {
    state.addBoard = normalizeTextFormState();
    state.overlay = "add-board";
    state.pendingFocus = "board-add-board-title";
  }

  function openRenameBoard(id: BoardId): void {
    const board = boardById(id);

    if (!board) {
      state.actionError = "Choose a board first.";
      state.overlay = "card-action-error";
      return;
    }

    state.selectedBoardId = id;
    state.renameBoard = normalizeTextFormState({ title: board.title, description: board.description || "" });
    state.overlay = "rename-board";
    state.pendingFocus = "board-rename-board-title";
  }

  function openRemoveBoard(id: BoardId): void {
    const board = boardById(id);

    if (!board) {
      state.actionError = "Choose a board first.";
      state.overlay = "card-action-error";
      return;
    }

    state.selectedBoardId = id;
    state.overlay = "remove-board-confirm";
    state.pendingFocus = "board-remove-board-confirm";
  }

  function saveAddBoard(): void {
    const form = normalizeTextFormState(state.addBoard);
    const title = form.title.trim();
    const description = form.description.trim();

    if (!title) {
      state.addBoard = { ...form, error: "Title is required." };
      state.pendingFocus = "board-add-board-title";
      return;
    }

    if (typeof boardActions.addBoard !== "function") {
      state.addBoard = { ...form, error: "Board could not be saved. Try again." };
      state.pendingFocus = "board-add-board-title";
      return;
    }

    const result = safeActionResult(boardActions.addBoard({ title, description }), "Board could not be saved. Try again.");

    if (!result.ok) {
      state.addBoard = { ...form, error: result.error || "Board could not be saved. Try again." };
      state.pendingFocus = "board-add-board-title";
      return;
    }

    refreshSnapshot("board");
    closeBoardOverlay(state);
    resetBoardSelection();
  }

  function saveRenameBoard(): void {
    const form = normalizeTextFormState(state.renameBoard);
    const title = form.title.trim();
    const description = form.description.trim();
    const boardId = selectedBoardId();

    if (boardId === null) {
      state.renameBoard = { ...form, error: "Choose a board first." };
      return;
    }

    if (!title) {
      state.renameBoard = { ...form, error: "Title is required." };
      state.pendingFocus = "board-rename-board-title";
      return;
    }

    if (typeof boardActions.renameBoard !== "function") {
      state.renameBoard = { ...form, error: "Board could not be renamed. Try again." };
      state.pendingFocus = "board-rename-board-title";
      return;
    }

    const result = safeActionResult(boardActions.renameBoard({ boardId, title, description }), "Board could not be renamed. Try again.");

    if (!result.ok) {
      state.renameBoard = { ...form, error: result.error || "Board could not be renamed. Try again." };
      state.pendingFocus = "board-rename-board-title";
      return;
    }

    refreshSnapshot("board");
    closeBoardOverlay(state);
  }

  function removeSelectedBoard(): void {
    const boardId = selectedBoardId();

    if (boardId === null || typeof boardActions.removeBoard !== "function") {
      state.actionError = "Board could not be deleted. Try again.";
      state.overlay = "card-action-error";
      return;
    }

    if (applyBoardResult(boardActions.removeBoard({ boardId }), "Board could not be deleted. Try again.")) {
      resetBoardSelection();
    }
  }

  function currentBoardHasCards(): boolean {
    const current = currentBoard();

    if (typeof current.totalCards === "number" && current.totalCards > 0) {
      return true;
    }

    const columns = Array.isArray(current.columns) ? current.columns : [];
    return columns.some((column) => {
      if (typeof column.count === "number" && column.count > 0) {
        return true;
      }

      return Array.isArray(column.cards) && column.cards.length > 0;
    });
  }

  function openResetColumnsConfirm(): void {
    if (currentBoardHasCards()) {
      state.actionError = "Move or remove cards before resetting columns.";
      state.overlay = "card-action-error";
      return;
    }

    state.overlay = "reset-columns-confirm";
    state.pendingFocus = "board-reset-columns-confirm";
  }

  function resetColumns(): void {
    if (typeof boardActions.resetDefaultColumns !== "function") {
      state.actionError = "Columns could not be reset. Try again.";
      state.overlay = "card-action-error";
      return;
    }

    applyBoardResult(boardActions.resetDefaultColumns(), "Columns could not be reset. Try again.");
  }

  function openSetWipLimit(): void {
    const column = selectedColumn();

    if (!column) {
      showColumnSelectionError();
      return;
    }

    const currentLimit = typeof column.wipLimit === "number" && column.wipLimit > 0 ? String(column.wipLimit) : "0";
    state.wipLimit = normalizeTitleFormState({ title: currentLimit });
    state.overlay = "set-wip-limit";
    state.pendingFocus = "board-wip-limit";
  }

  function validWipLimit(value: number): boolean {
    return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
  }

  function parsedWipLimitFromForm(form: TitleFormState): number | null {
    const rawValue = form.title.trim();
    const parsedValue = Number(rawValue);

    if (rawValue.length === 0 || !validWipLimit(parsedValue)) {
      return null;
    }

    return parsedValue;
  }

  function saveWipLimit(rawValue?: string): void {
    const form = normalizeTitleFormState(state.wipLimit);
    const parsedLimit = typeof rawValue === "string" ? parsedWipLimitFromForm({ ...form, title: rawValue }) : parsedWipLimitFromForm(form);

    if (parsedLimit === null || !validWipLimit(parsedLimit)) {
      state.wipLimit = { ...form, error: "Choose a WIP limit of 0 or higher." };
      state.pendingFocus = "board-wip-limit";
      return;
    }

    if (typeof boardActions.setWipLimit !== "function") {
      state.wipLimit = { ...form, error: "Column WIP limit could not be changed. Try again." };
      state.pendingFocus = "board-wip-limit";
      return;
    }

    const result = safeActionResult(boardActions.setWipLimit({ columnIndex: state.selectedColumnIndex, wipLimit: parsedLimit }), "Column WIP limit could not be changed. Try again.");

    if (!result.ok) {
      state.wipLimit = { ...form, error: result.error || "Column WIP limit could not be changed. Try again." };
      state.pendingFocus = "board-wip-limit";
      return;
    }

    refreshSnapshot("board");
    closeBoardOverlay(state);
  }

  function setSelectedColumnAsDefault(): void {
    if (typeof boardActions.setDefaultColumn !== "function") {
      state.actionError = "Default column could not be changed. Try again.";
      state.overlay = "card-action-error";
      return;
    }

    applyBoardResult(boardActions.setDefaultColumn({ columnIndex: state.selectedColumnIndex }), "Default column could not be changed. Try again.");
  }

  function cardRemoveIsArmed(selection: Selection): boolean {
    return sameSelection(state.removeCardArmedSelection, selection) && Date.now() <= (state.removeCardArmedUntil || 0);
  }

  function armOrRemoveSelectedCard(): void {
    const details = selectedCardDetails();

    if (!details) {
      showCardSelectionError();
      return;
    }

    const selection = { columnIndex: details.columnIndex, position: details.position };

    if (!cardRemoveIsArmed(selection)) {
      state.removeCardArmedSelection = selection;
      state.removeCardArmedUntil = Date.now() + 4000;
      state.overlay = "card-details";
      state.pendingFocus = "board-card-remove";
      return;
    }

    applyBoardResult(boardActions.removeCard(selection), "Card could not be deleted. Try again.");
  }

  function clearRemoveCardArming(): void {
    state.removeCardArmedUntil = 0;
    state.removeCardArmedSelection = null;
  }

  function columnRemoveIsArmed(columnIndex: number): boolean {
    return state.removeColumnArmedIndex === columnIndex && Date.now() <= (state.removeColumnArmedUntil || 0);
  }

  function clearRemoveColumnArming(): void {
    state.removeColumnArmedUntil = 0;
    state.removeColumnArmedIndex = null;
  }

  function showCardSelectionError(): void {
    state.actionError = "Choose a card first.";
    state.overlay = "card-action-error";
  }

  function showColumnSelectionError(): void {
    state.actionError = "Choose a column first.";
    state.overlay = "card-action-error";
  }

  function openCardDetails(selection: Selection): void {
    const details = getBoardCard(currentBoard(), selection);

    if (!details) {
      showCardSelectionError();
      return;
    }

    const nextSelection = { columnIndex: details.columnIndex, position: details.position };

    clearRemoveCardArming();
    clearRemoveColumnArming();
    state.selectedCard = nextSelection;
    state.selectedColumnIndex = details.columnIndex;
    state.overlay = "card-details";
    state.pendingFocus = "board-card-details-scroll";
  }

  function openEditCard(): void {
    const details = selectedCardDetails();

    if (!details) {
      showCardSelectionError();
      return;
    }

    state.editCard = normalizeCardFormState({ title: details.title, description: details.description });
    state.overlay = "edit-card";
    state.pendingFocus = "board-edit-title";
  }

  function openMoveCard(): void {
    if (!selectedCardDetails()) {
      showCardSelectionError();
      return;
    }

    state.overlay = "move-card";
    state.pendingFocus = "board-move-cancel";
  }

  function openPriorityCard(): void {
    if (!selectedCardDetails()) {
      showCardSelectionError();
      return;
    }

    state.overlay = "priority-card";
    state.pendingFocus = "board-priority-cancel";
  }

  function openColumnDetails(columnIndex: number = state.selectedColumnIndex): void {
    if (positiveInteger(columnIndex)) {
      if (state.selectedColumnIndex !== columnIndex) {
        clearRemoveColumnArming();
      }

      state.selectedColumnIndex = columnIndex;
    }

    const current = currentBoard();

    if (!Array.isArray(current.columns) || current.columns.length === 0) {
      state.overlay = "column-details";
      state.pendingFocus = "board-add-column";
      return;
    }

    if (!selectedColumn()) {
      showColumnSelectionError();
      return;
    }

    clearRemoveCardArming();
    clearRemoveColumnArming();
    state.overlay = "column-details";
    state.pendingFocus = "board-remove-column";
  }

  function openAddColumn(): void {
    state.addColumn = normalizeTitleFormState();
    state.overlay = "add-column";
    state.pendingFocus = "board-add-column-title";
  }

  function openRenameColumn(columnIndex: number = state.selectedColumnIndex): void {
    if (positiveInteger(columnIndex)) {
      state.selectedColumnIndex = columnIndex;
    }

    const column = selectedColumn();

    if (!column) {
      showColumnSelectionError();
      return;
    }

    state.renameColumn = normalizeTitleFormState({ title: column.title });
    state.overlay = "rename-column";
    state.pendingFocus = "board-rename-column-title";
  }

  function applyBoardResult(result: unknown, fallback: string, options: { selectedColumnIndex?: number } = {}): boolean {
    const safe = safeActionResult(result || { ok: false, error: fallback }, fallback);

    if (!safe.ok) {
      state.actionError = safe.error || fallback;
      state.overlay = "card-action-error";
      return false;
    }

    if (positiveInteger(options.selectedColumnIndex)) {
      state.selectedColumnIndex = options.selectedColumnIndex;
    }

    refreshSnapshot("board");
    closeBoardOverlay(state);
    return true;
  }

  function saveAddCard(): void {
    const form = normalizeAddCardState(state.addCard);
    const title = form.title.trim();
    const description = form.description.trim();

    if (!title) {
      state.addCard = { ...form, error: "Title is required." };
      state.pendingFocus = "board-add-title";
      return;
    }

    const result = safeActionResult(boardActions.addCard({ title, description }));

    if (!result.ok) {
      state.addCard = { ...form, error: result.error || "Card could not be saved. Try again." };
      state.pendingFocus = "board-add-title";
      return;
    }

    refreshSnapshot("board");
    closeBoardOverlay(state);
  }


  function boardOverlayContentHeight(): number {
    return Math.max(1, BOARD_SHELL_FIXED_ROWS + 12);
  }

  function boardOverlayContentWidth(): number {
    const horizontalMargin = Math.round(width * 0.1) * 2;

    return Math.max(1, width - horizontalMargin);
  }

  function boardOverlayEditorHeight(): number {
    return Math.max(4, boardOverlayContentHeight() - 5);
  }


  function addCardOverlay(): JSX.Element | null {
    if (state.overlay !== "add-card") {
      return null;
    }

    const form = normalizeAddCardState(state.addCard);

    return (
      <EditOverlay
        heading="Add card"
        error={form.error}
        titleLabel="Title"
        titleInputId="board-add-title"
        titleValue={form.title}
        titlePlaceholder="Card title"
        inputStyle="input.base"
        inputFocusStyle="input.focus"
        editorLabel="Description"
        editorId="board-add-description"
        editorValue={form.description}
        editorPlaceholder="Optional description"
        editorHeight={boardOverlayEditorHeight()}
        editorStyle="editor.base"
        editorFocusStyle="editor.focus"
        primaryActionId="board-add-save"
        cancelActionId="board-add-cancel"
        onTitleInput={(value) => {
          const next = normalizeAddCardState(state.addCard);
          next.title = value;
          next.error = "";
          state.addCard = next;
        }}
        onEditorInput={(value) => {
          const next = normalizeAddCardState(state.addCard);
          next.description = value;
          next.error = "";
          state.addCard = next;
        }}
        onSave={saveAddCard}
        onCancel={() => closeBoardOverlay(state)}
      />
    );
  }
  function cardActionErrorOverlay(): JSX.Element | null {
    if (state.overlay !== "card-action-error") {
      return null;
    }

    return (
      <AppOverlay trapFocus={true}
        content={[
          <Text>{state.actionError || "Action could not be completed."}</Text>
        
        ]}
        bottomNav={createButton("board-action-error-close", "OK", () => closeBoardOverlay(state))}
      />
    );
  }

  function cardDetailsOverlay(): JSX.Element | null {
    if (state.overlay !== "card-details") {
      return null;
    }

    const details = selectedCardDetails();

    if (!details) {
      return null;
    }

    const selection = { columnIndex: details.columnIndex, position: details.position };
    const removeIsArmed = cardRemoveIsArmed(selection);
    const headingWidth = cardDetailsHeadingWidth(boardOverlayContentWidth());
    const heading = wrappedTerminalText(`${details.column.title} | ${details.title}`, headingWidth);

    return (
      <AppOverlay
        trapFocus={true}
        surfaceStyle={CARD_DETAILS_SURFACE_STYLE}
        content={
          <FocusScope>
            <ScrollView id="board-card-details-scroll" height={Math.max(1, boardOverlayContentHeight() - 1)}>
              <Text>{heading}</Text>
              <Hr width={headingWidth} />
              {details.description ? <Text>{details.description}</Text> : null}
              {removeIsArmed ? <Text state="warning">Select Delete card to confirm.</Text> : null}
            </ScrollView>
          </FocusScope>
        }
        bottomNav={[
          <Text></Text>,
          <View direction="row" gap={1}>
            {createButton("board-card-edit", "Edit", openEditCard)}
            {createButton("board-card-move", "Move", openMoveCard)}
            {createButton("board-card-priority", "Priority", openPriorityCard)}
            {createButton("board-card-remove", removeIsArmed ? "Delete card" : "Remove", armOrRemoveSelectedCard, removeIsArmed ? "error" : undefined)}
            {createButton("board-details-close", "Close", () => closeBoardOverlay(state))}
          </View>
        ]}
      />
    );
  }

  function saveEditCard(): void {
    const details = selectedCardDetails();
    const nextForm = normalizeCardFormState(state.editCard);
    const title = nextForm.title.trim();

    if (!details) {
      showCardSelectionError();
      return;
    }

    if (!title) {
      state.editCard = { ...nextForm, error: "Title is required." };
      state.pendingFocus = "board-edit-title";
      return;
    }

    applyBoardResult(boardActions.editCard({
      columnIndex: details.columnIndex,
      position: details.position,
      title,
      description: nextForm.description.trim()
    }), "Card could not be updated. Try again.");
  }

  function editCardOverlay(): JSX.Element | null {
    if (state.overlay !== "edit-card") {
      return null;
    }

    const form = normalizeCardFormState(state.editCard);

    return (
      <EditOverlay
        heading="Edit card"
        error={form.error}
        titleLabel="Title"
        titleInputId="board-edit-title"
        titleValue={form.title}
        titlePlaceholder="Card title"
        inputStyle="input.base"
        inputFocusStyle="input.focus"
        editorLabel="Description"
        editorId="board-edit-description"
        editorValue={form.description}
        editorPlaceholder="Optional description"
        editorHeight={boardOverlayEditorHeight()}
        editorStyle="editor.base"
        editorFocusStyle="editor.focus"
        primaryActionId="board-edit-save"
        cancelActionId="board-edit-cancel"
        onTitleInput={(value) => {
          const next = normalizeCardFormState(state.editCard);
          next.title = value;
          next.error = "";
          state.editCard = next;
        }}
        onEditorInput={(value) => {
          const next = normalizeCardFormState(state.editCard);
          next.description = value;
          next.error = "";
          state.editCard = next;
        }}
        onSave={saveEditCard}
        onCancel={() => closeBoardOverlay(state)}
      />
    );
  }
  function moveCardOverlay(): JSX.Element | null {
    if (state.overlay !== "move-card") {
      return null;
    }

    const details = selectedCardDetails();
    const current = currentBoard();

    if (!details) {
      return null;
    }

    return (
      <AppOverlay trapFocus={true}
        content={[
          <Text>{`Move "${details.title}" to:`}</Text>,
          ...((current.columns || []).map((column: BoardColumn, offset: number) => createButton(`board-move-to-${offset + 1}`, column.title || "Untitled column", () => {
            const toColumn = offset + 1;
            const targetPosition = toColumn === details.columnIndex ? details.position : cardCountInColumn(toColumn) + 1;

            if (applyBoardResult(boardActions.moveCard({
              fromColumn: details.columnIndex,
              fromPosition: details.position,
              toColumn
            }), "Card could not be moved. Try again.")) {
              state.selectedColumnIndex = toColumn;
              state.selectedCard = { columnIndex: toColumn, position: targetPosition };
              state.pendingFocus = `board-card-list-${toColumn}`;
            }
          })))
        
        ]}
        bottomNav={createButton("board-move-cancel", "Cancel", () => closeBoardOverlay(state))}
      />
    );
  }

  function priorityCardOverlay(): JSX.Element | null {
    if (state.overlay !== "priority-card") {
      return null;
    }

    const details = selectedCardDetails();

    if (!details) {
      return null;
    }

    const canMoveUp = details.position > 1;
    const canMoveDown = details.position < (details.column.cards || []).length;

    return (
      <AppOverlay trapFocus={true}
        content={[
          <Text>{`Change priority for "${details.title}"`}</Text>,
          canMoveUp ? createButton("board-priority-up", "Move up", () => {
            applyBoardResult(boardActions.prioritizeCard({
              columnIndex: details.columnIndex,
              position: details.position,
              toPosition: details.position - 1
            }), "Priority could not be changed. Try again.");
          }) : <Text>Move up unavailable</Text>,
          canMoveDown ? createButton("board-priority-down", "Move down", () => {
            applyBoardResult(boardActions.prioritizeCard({
              columnIndex: details.columnIndex,
              position: details.position,
              toPosition: details.position + 1
            }), "Priority could not be changed. Try again.");
          }) : <Text>Move down unavailable</Text>
        
        ]}
        bottomNav={createButton("board-priority-cancel", "Cancel", () => closeBoardOverlay(state))}
      />
    );
  }


  function boardDetailsOverlay(): JSX.Element | null {
    if (state.overlay !== "board-details") {
      return null;
    }

    const board = selectedBoardSummary();

    if (!board) {
      return null;
    }

    const headingWidth = cardDetailsHeadingWidth(boardOverlayContentWidth());

    return (
      <AppOverlay
        trapFocus={true}
        surfaceStyle={CARD_DETAILS_SURFACE_STYLE}
        content={
          <FocusScope>
            <ScrollView id="board-board-details-scroll" height={Math.max(1, boardOverlayContentHeight() - 1)}>
              <Text>{wrappedTerminalText(`Board: ${board.title}`, headingWidth)}</Text>
              <Hr width={headingWidth} />
              {board.description ? <Text>{board.description}</Text> : null}
            </ScrollView>
          </FocusScope>
        }
        bottomNav={[
          <Text></Text>,
          <View direction="row" gap={1}>
            {createButton("board-rename-board", "Rename", () => openRenameBoard(board.id))}
            {createButton("board-delete-board", "Delete board", () => openRemoveBoard(board.id), "error")}
            {createButton("board-board-details-close", "Close", () => closeBoardOverlay(state))}
          </View>
        ]}
      />
    );
  }

  function addBoardOverlay(): JSX.Element | null {
    if (state.overlay !== "add-board") {
      return null;
    }

    const form = normalizeTextFormState(state.addBoard);

    return (
      <AppOverlay trapFocus={true}
        content={[
          <FocusScope>
            <Text>Add board</Text>
            <Text>Title</Text>
            <Input
              id="board-add-board-title"
              value={form.title}
              placeholder="Board title"
              style="input.base"
              styles={{ focus: "input.focus" }}
              oninput={(event: TerminalInputChangeEventPayload) => {
                state.addBoard = { ...normalizeTextFormState(state.addBoard), title: event.value, error: "" };
              }}
              onsubmit={saveAddBoard}
            />
            <Text>Description</Text>
            <Editor
              id="board-add-board-description"
              value={form.description}
              placeholder="Optional description"
              height={boardOverlayEditorHeight()}
              style="editor.base"
              styles={{ focus: "editor.focus" }}
              oninput={(event: TerminalEditorChangeEventPayload) => {
                state.addBoard = { ...normalizeTextFormState(state.addBoard), description: event.value, error: "" };
              }}
              onsubmit={saveAddBoard}
              oncancel={() => closeBoardOverlay(state)}
            />
            {form.error ? <Text state="error">{form.error}</Text> : null}
          </FocusScope>
        
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("board-add-board-save", "Save", saveAddBoard)}
            {createButton("board-add-board-cancel", "Cancel", () => closeBoardOverlay(state))}
          </View>
        }
      />
    );
  }

  function renameBoardOverlay(): JSX.Element | null {
    if (state.overlay !== "rename-board") {
      return null;
    }

    const form = normalizeTextFormState(state.renameBoard);

    return (
      <AppOverlay trapFocus={true}
        content={[
          <FocusScope>
            <Text>Rename board</Text>
            <Text>Title</Text>
            <Input
              id="board-rename-board-title"
              value={form.title}
              placeholder="Board title"
              style="input.base"
              styles={{ focus: "input.focus" }}
              oninput={(event: TerminalInputChangeEventPayload) => {
                state.renameBoard = { ...normalizeTextFormState(state.renameBoard), title: event.value, error: "" };
              }}
              onsubmit={saveRenameBoard}
            />
            <Text>Description</Text>
            <Editor
              id="board-rename-board-description"
              value={form.description}
              placeholder="Optional description"
              height={boardOverlayEditorHeight()}
              style="editor.base"
              styles={{ focus: "editor.focus" }}
              oninput={(event: TerminalEditorChangeEventPayload) => {
                state.renameBoard = { ...normalizeTextFormState(state.renameBoard), description: event.value, error: "" };
              }}
              onsubmit={saveRenameBoard}
              oncancel={() => closeBoardOverlay(state)}
            />
            {form.error ? <Text state="error">{form.error}</Text> : null}
          </FocusScope>
        
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("board-rename-board-save", "Save", saveRenameBoard)}
            {createButton("board-rename-board-cancel", "Cancel", () => closeBoardOverlay(state))}
          </View>
        }
      />
    );
  }

  function removeBoardConfirmOverlay(): JSX.Element | null {
    if (state.overlay !== "remove-board-confirm") {
      return null;
    }

    const board = selectedBoardSummary();

    if (!board) {
      return null;
    }

    return (
      <AppOverlay trapFocus={true}
        content={[
          <Text>{`Delete board "${board.title}"? This cannot be undone.`}</Text>
        
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("board-remove-board-confirm", "Delete board", removeSelectedBoard, "error")}
            {createButton("board-remove-board-cancel", "Cancel", () => closeBoardOverlay(state))}
          </View>
        }
      />
    );
  }

  function columnDetailsOverlay(): JSX.Element | null {
    if (state.overlay !== "column-details") {
      return null;
    }

    const current = currentBoard();
    const columns = Array.isArray(current.columns) ? current.columns : [];
    const hasColumns = columns.length > 0;
    const column = selectedColumn();
    const index = state.selectedColumnIndex;

    if (!hasColumns) {
      return (
        <AppOverlay trapFocus={true}
        content={[
            <Text>Columns</Text>,
            <Text>No columns yet.</Text>
          
        ]}
        bottomNav={createButton("board-column-details-close", "Close", () => closeBoardOverlay(state))}
      />
      );
    }

    if (!column) {
      return null;
    }

    const selectedColumnDetails = column;
    const count = selectedColumnDetails.count || (Array.isArray(selectedColumnDetails.cards) ? selectedColumnDetails.cards.length : 0);
    const removeIsArmed = columnRemoveIsArmed(index);

    function armOrRemoveSelectedColumn(): void {
      if (count > 0) {
        state.actionError = "Move cards out of this column before removing it.";
        state.overlay = "card-action-error";
        return;
      }

      if (selectedColumnDetails.isDefault === true) {
        state.actionError = "Set another default column before removing this one.";
        state.overlay = "card-action-error";
        return;
      }

      if (!columnRemoveIsArmed(index)) {
        state.removeColumnArmedIndex = index;
        state.removeColumnArmedUntil = Date.now() + 4000;
        state.overlay = "column-details";
        state.pendingFocus = "board-remove-column";
        return;
      }

      applyBoardResult(boardActions.removeColumn({ columnIndex: index }), "Column could not be removed. Try again.");
    }

    return (
      <AppOverlay trapFocus={true}
        content={[
          <Text>{`Column: ${selectedColumnDetails.title}`}</Text>,
          removeIsArmed ? <Text state="warning">Select Delete column to confirm.</Text> : null
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("board-rename-column", "Rename", openRenameColumn)}
            {createButton("board-set-wip-limit", "WIP", openSetWipLimit)}
            {selectedColumnDetails.isDefault === true ? createButtonStatus("board-current-column", "Current") : createButton("board-set-default-column", "Default", setSelectedColumnAsDefault)}
            {createButton("board-remove-column", removeIsArmed ? "Delete column" : "Remove column", armOrRemoveSelectedColumn, removeIsArmed ? "error" : undefined)}
            {createButton("board-column-details-close", "Close", () => closeBoardOverlay(state))}
          </View>
        }
      />
    );
  }

  function addColumnOverlay(): JSX.Element | null {
    if (state.overlay !== "add-column") {
      return null;
    }

    const form = normalizeTitleFormState(state.addColumn);

    return (
      <AppOverlay trapFocus={true}
        content={[
          <FocusScope>
            <Text>Add column</Text>
            <Input
              id="board-add-column-title"
              value={form.title}
              placeholder="Column title"
              style="input.base"
              styles={{ focus: "input.focus" }}
              oninput={(event: TerminalInputChangeEventPayload) => {
                state.addColumn = { ...normalizeTitleFormState(state.addColumn), title: event.value, error: "" };
              }}
            />
            {form.error ? <Text state="error">{form.error}</Text> : null}
          </FocusScope>
        
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("board-add-column-save", "Save", () => {
              const nextForm = normalizeTitleFormState(state.addColumn);
              const title = nextForm.title.trim();

              if (!title) {
                state.addColumn = { ...nextForm, error: "Column title is required." };
                state.pendingFocus = "board-add-column-title";
                return;
              }

              applyBoardResult(boardActions.addColumn({ title }), "Column could not be saved. Try again.");
            })}
            {createButton("board-add-column-cancel", "Cancel", () => closeBoardOverlay(state))}
          </View>
        }
      />
    );
  }

  function renameColumnOverlay(): JSX.Element | null {
    if (state.overlay !== "rename-column") {
      return null;
    }

    const form = normalizeTitleFormState(state.renameColumn);

    return (
      <AppOverlay trapFocus={true}
        content={[
          <FocusScope>
            <Text>Rename column</Text>
            <Input
              id="board-rename-column-title"
              value={form.title}
              placeholder="Column title"
              style="input.base"
              styles={{ focus: "input.focus" }}
              oninput={(event: TerminalInputChangeEventPayload) => {
                state.renameColumn = { ...normalizeTitleFormState(state.renameColumn), title: event.value, error: "" };
              }}
            />
            {form.error ? <Text state="error">{form.error}</Text> : null}
          </FocusScope>
        
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("board-rename-column-save", "Save", () => {
              const nextForm = normalizeTitleFormState(state.renameColumn);
              const title = nextForm.title.trim();

              if (!title) {
                state.renameColumn = { ...nextForm, error: "Column title is required." };
                state.pendingFocus = "board-rename-column-title";
                return;
              }

              applyBoardResult(boardActions.renameColumn({ columnIndex: state.selectedColumnIndex, title }), "Column could not be renamed. Try again.");
            })}
            {createButton("board-rename-column-cancel", "Cancel", () => closeBoardOverlay(state))}
          </View>
        }
      />
    );
  }

  function setWipLimitOverlay(): JSX.Element | null {
    if (state.overlay !== "set-wip-limit") {
      return null;
    }

    const form = normalizeTitleFormState(state.wipLimit);
    const column = selectedColumn();

    return (
      <AppOverlay trapFocus={true}
        content={[
          <FocusScope>
            <Text>Set WIP limit</Text>
            <Text>{column ? `Column: ${column.title}` : "Choose a column first."}</Text>
            <NumberInput
              id="board-wip-limit"
              value={form.title}
              placeholder="0"
              min={0}
              style="input.base"
              styles={{ focus: "input.focus" }}
              oninput={(event: TerminalInputChangeEventPayload) => {
                state.wipLimit = { ...normalizeTitleFormState(state.wipLimit), title: event.value, error: "" };
              }}
              onsubmit={(event: TerminalNumberSubmitEventPayload) => saveWipLimit(event.rawValue)}
              {...{
                __onInvalidSubmit: (event: { value: string }) => saveWipLimit(event.value)
              }}
            />
            <Text>Use 0 for no limit.</Text>
            {form.error ? <Text state="error">{form.error}</Text> : null}
          </FocusScope>
        
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("board-set-wip-save", "Save", saveWipLimit)}
            {createButton("board-set-wip-cancel", "Cancel", () => closeBoardOverlay(state))}
          </View>
        }
      />
    );
  }

  function resetColumnsConfirmOverlay(): JSX.Element | null {
    if (state.overlay !== "reset-columns-confirm") {
      return null;
    }

    return (
      <AppOverlay trapFocus={true}
        content={[
          <Text>Reset columns to the default layout?</Text>,
          <Text>This only works on empty boards.</Text>
        
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("board-reset-columns-confirm", "Reset to default layout", resetColumns)}
            {createButton("board-reset-columns-cancel", "Cancel", () => closeBoardOverlay(state))}
          </View>
        }
      />
    );
  }

  function removeCardConfirmOverlay(): JSX.Element | null {
    if (state.overlay !== "remove-card-confirm") {
      return null;
    }

    const details = selectedCardDetails();

    if (!details) {
      return null;
    }

    return (
      <AppOverlay trapFocus={true}
        content={[
          <Text>{`Delete card "${details.title}"?`}</Text>,
          <Text>This cannot be undone.</Text>
        
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("board-remove-confirm", "Delete card", () => {
              applyBoardResult(boardActions.removeCard({ columnIndex: details.columnIndex, position: details.position }), "Card could not be deleted. Try again.");
            }, "error")}
            {createButton("board-remove-cancel", "Cancel", () => closeBoardOverlay(state))}
          </View>
        }
      />
    );
  }

  const boardPanelNodes = renderBoardNodes(board, state, { width, openCardDetails, openColumnDetails, switchBoard, openBoardDetails });

  return {
    activePanelNodes: boardPanelNodes,
    actionBar: createBoardActionBar(isActive, {
      openAddCard: () => openBoardAddCardModal(state),
      openAddColumn,
      openResetColumnsConfirm,
      openAddBoard
    }, { extraActions: options.utilityActions }) as JSX.Element | null,
    overlays: isActive ? [
      addCardOverlay(),
      cardActionErrorOverlay(),
      cardDetailsOverlay(),
      editCardOverlay(),
      moveCardOverlay(),
      priorityCardOverlay(),
      boardDetailsOverlay(),
      addBoardOverlay(),
      renameBoardOverlay(),
      removeBoardConfirmOverlay(),
      columnDetailsOverlay(),
      addColumnOverlay(),
      renameColumnOverlay(),
      setWipLimitOverlay(),
      resetColumnsConfirmOverlay(),
      removeCardConfirmOverlay()
    ] : []
  };
}
