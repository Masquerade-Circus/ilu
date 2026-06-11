import { Box, Button, List, View } from "@valyrianjs/terminal";
import type { TerminalListChangeEventPayload, TerminalListPressEventPayload } from "@valyrianjs/terminal";
import type { BoardCard, BoardCardListItem, BoardColumn, BoardRuntimeState, Selection } from "../../types";
import { UI_COLORS } from "../../theme";
import { positiveInteger } from "./BoardCard";

export const BOARD_COLUMN_STYLE = Object.freeze({
  color: UI_COLORS.text,
  border: { top: true, right: true, bottom: true, left: true, style: "solid", color: UI_COLORS.border },
  padding: { left: 0, right: 0 }
});

const BOARD_COLUMN_HEADER_STYLE = Object.freeze({
  color: UI_COLORS.text,
  background: UI_COLORS.surface,
  border: { bottom: true, style: "solid", color: UI_COLORS.border },
  padding: { left: 0, right: 0 }
});
const BOARD_COLUMN_HEADER_ACTIVE_STYLE = Object.freeze({
  color: UI_COLORS.textStrong,
  background: UI_COLORS.surface,
  border: { bottom: true, style: "solid", color: UI_COLORS.borderActive },
  padding: { left: 0, right: 0 }
});
const BOARD_CARD_LIST_STYLE = Object.freeze({ color: UI_COLORS.text });
const BOARD_CARD_LIST_ACTIVE_STYLE = Object.freeze({ color: UI_COLORS.textStrong });
const BOARD_CARD_DOUBLE_PRESS_WINDOW_MS = 500;
const boardCardPressState = new WeakMap<BoardRuntimeState, { selection: Selection; expiresAt: number }>();

function visibleLength(value: unknown): number {
  return String(value).length;
}

function clipText(value: unknown, width: number): string {
  const text = String(value);

  if (!positiveInteger(width) || text.length <= width) {
    return text;
  }

  if (width === 1) {
    return "…";
  }

  return `${text.slice(0, width - 1)}…`;
}

function boardColumnCounter(column: BoardColumn): string {
  const count = Number.isInteger(column.count) && Number(column.count) >= 0
    ? Number(column.count)
    : Array.isArray(column.cards)
      ? column.cards.length
      : 0;
  const wipLimit = Number.isInteger(column.wipLimit) && Number(column.wipLimit) >= 1 ? Number(column.wipLimit) : null;

  return wipLimit === null ? `(${count})` : `(${count}/${wipLimit})`;
}

export function formatBoardColumnHeader(column: BoardColumn, width: number): string {
  const counter = boardColumnCounter(column);
  const title = typeof column.title === "string" && column.title.trim().length > 0 ? column.title.trim() : "Untitled column";
  const contentWidth = Math.max(1, width);

  if (visibleLength(title) + visibleLength(counter) + 1 <= contentWidth) {
    return `${title}${" ".repeat(contentWidth - visibleLength(title) - visibleLength(counter))}${counter}`;
  }

  return clipText(`${title} ${counter}`, contentWidth);
}

export function splitColumnWidths(totalWidth: number, columnCount: number, gap: number): number[] {
  if (!positiveInteger(totalWidth) || !positiveInteger(columnCount)) {
    return [];
  }

  const available = Math.max(columnCount, totalWidth - Math.max(0, gap) * (columnCount - 1));
  const base = Math.floor(available / columnCount);
  const remainder = available % columnCount;

  return Array.from({ length: columnCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

function boardCardTitle(card: BoardCardListItem): string {
  if (typeof card === "object" && card !== null) {
    return typeof card.title === "string" && card.title.length > 0 ? card.title : "Untitled";
  }

  return typeof card === "string" && card.length > 0 ? card : "Untitled";
}

function boardCardPosition(card: BoardCardListItem, cardOffset: number): number {
  return typeof card === "object" && card !== null && positiveInteger(card.position) ? card.position : cardOffset + 1;
}

function selectionFromCard(columnIndex: number, card: BoardCardListItem, cardOffset: number): Selection {
  return { columnIndex, position: boardCardPosition(card, cardOffset) };
}

export function boardCardListItems(column: BoardColumn | null | undefined): BoardCardListItem[] {
  if (!column || !Array.isArray(column.cards)) {
    return [];
  }

  return column.cards as BoardCardListItem[];
}

function renderBoardCardListItem(card: BoardCardListItem, cardOffset: number, columnIndex: number, selectedCard?: Selection | null): string {
  const selection = selectionFromCard(columnIndex, card, cardOffset);
  const isSelected = Boolean(
    selectedCard
      && positiveInteger(selectedCard.columnIndex)
      && positiveInteger(selectedCard.position)
      && selectedCard.columnIndex === selection.columnIndex
      && selectedCard.position === selection.position
  );
  const title = boardCardTitle(card);

  return isSelected ? `› ${title}` : `• ${title}`;
}

function clearStaleDoublePressSuppress(state: BoardRuntimeState): void {
  state.suppressBoardCardDoublePressUntil = 0;
  state.suppressBoardCardDoublePressSelection = null;
}

function sameSelection(left: Selection | null | undefined, right: Selection): boolean {
  return Boolean(
    left
      && positiveInteger(left.columnIndex)
      && positiveInteger(left.position)
      && left.columnIndex === right.columnIndex
      && left.position === right.position
  );
}

function shouldIgnoreStaleDoublePress(state: BoardRuntimeState, selection: Selection): boolean {
  const suppressUntil = typeof state.suppressBoardCardDoublePressUntil === "number" ? state.suppressBoardCardDoublePressUntil : 0;

  if (suppressUntil <= 0) {
    return false;
  }

  if (Date.now() > suppressUntil) {
    clearStaleDoublePressSuppress(state);
    return false;
  }

  const shouldIgnore = sameSelection(state.suppressBoardCardDoublePressSelection, selection);

  if (shouldIgnore) {
    clearStaleDoublePressSuppress(state);
  }

  return shouldIgnore;
}

function activateCardDetails(
  state: BoardRuntimeState,
  selection: Selection,
  openCardDetails?: (selection: Selection) => void
): void {
  boardCardPressState.delete(state);

  if (shouldIgnoreStaleDoublePress(state, selection)) {
    return;
  }

  if (typeof openCardDetails === "function") {
    openCardDetails(selection);
  }
}

function activateCardFromDoublePress(
  state: BoardRuntimeState,
  event: TerminalListPressEventPayload<BoardCardListItem>,
  columnIndex: number,
  openCardDetails?: (selection: Selection) => void
): void {
  activateCardDetails(state, selectionFromCard(columnIndex, event.value, event.index), openCardDetails);
}

function selectCardFromPress(
  state: BoardRuntimeState,
  event: TerminalListPressEventPayload<BoardCardListItem>,
  columnIndex: number,
  openCardDetails?: (selection: Selection) => void
): void {
  const selection = selectionFromCard(columnIndex, event.value, event.index);

  state.selectedCard = selection;
  state.selectedColumnIndex = selection.columnIndex;

  if (shouldIgnoreStaleDoublePress(state, selection)) {
    boardCardPressState.delete(state);
    return;
  }

  const lastPress = boardCardPressState.get(state);

  if (lastPress && Date.now() <= lastPress.expiresAt && sameSelection(lastPress.selection, selection)) {
    activateCardDetails(state, selection, openCardDetails);
    return;
  }

  boardCardPressState.set(state, {
    selection,
    expiresAt: Date.now() + BOARD_CARD_DOUBLE_PRESS_WINDOW_MS
  });
}

export function createBoardColumnNode(
  column: BoardColumn,
  columnOffset: number,
  columnWidth: number,
  boardHeight: number,
  state: BoardRuntimeState,
  openCardDetails?: (selection: Selection) => void,
  openColumnDetails?: (columnIndex: number) => void
): JSX.Element {
  const columnIndex = column.index ?? columnOffset + 1;
  const columnContentWidth = Math.max(1, columnWidth - 2);
  const headerLabel = formatBoardColumnHeader(column, columnContentWidth);
  const columnContentHeight = Math.max(1, boardHeight - 2);
  const cardItems = boardCardListItems(column);
  const headerHeight = 2;
  const cardListHeight = Math.max(1, columnContentHeight - headerHeight);
  function selectColumn(): void {
    state.selectedColumnIndex = columnIndex;
  }

  function openColumnDetailsFromHeader(): void {
    state.selectedColumnIndex = columnIndex;

    if (typeof openColumnDetails === "function") {
      openColumnDetails(columnIndex);
    }
  }

  const headerStyle = state.selectedColumnIndex === columnIndex ? BOARD_COLUMN_HEADER_ACTIVE_STYLE : BOARD_COLUMN_HEADER_STYLE;

  return (
    <Box height={boardHeight} style={BOARD_COLUMN_STYLE}>
      <Box height={headerHeight} style={headerStyle}>
        <Button
          id={`board-column-header-${columnIndex}`}
          label={headerLabel}
          style={headerStyle}
          styles={{ focus: BOARD_COLUMN_HEADER_ACTIVE_STYLE, hover: BOARD_COLUMN_HEADER_ACTIVE_STYLE, pressed: BOARD_COLUMN_HEADER_ACTIVE_STYLE, selected: BOARD_COLUMN_HEADER_ACTIVE_STYLE }}
          state={state.selectedColumnIndex === columnIndex ? "selected" : undefined}
          onpress={selectColumn}
          ondoublepress={openColumnDetailsFromHeader}
        />
      </Box>
      <View height={cardListHeight}>
        <List
          id={`board-card-list-${columnIndex}`}
          items={cardItems}
          virtualized={true}
          height={cardListHeight}
          wrap={true}
          itemKey={(item: BoardCardListItem, index: number) => `${columnIndex}:${boardCardPosition(item, index)}`}
          showActive={false}
          style={BOARD_CARD_LIST_STYLE}
          styles={{ selected: BOARD_CARD_LIST_ACTIVE_STYLE, current: BOARD_CARD_LIST_ACTIVE_STYLE, hover: BOARD_CARD_LIST_ACTIVE_STYLE }}
          onchange={(event: TerminalListChangeEventPayload<BoardCardListItem>) => {
            const selection = selectionFromCard(columnIndex, event.value, event.index);
            state.selectedCard = selection;
            state.selectedColumnIndex = selection.columnIndex;
          }}
          onpress={(event: TerminalListPressEventPayload<BoardCardListItem>) => selectCardFromPress(state, event, columnIndex, openCardDetails)}
          ondoublepress={(event: TerminalListPressEventPayload<BoardCardListItem>) => activateCardFromDoublePress(state, event, columnIndex, openCardDetails)}
          renderItem={(item: BoardCardListItem, index: number) => renderBoardCardListItem(item, index, columnIndex, state.selectedCard)}
        />
      </View>
    </Box>
  );
}
