import { Box, Button, Fixed, List, Pane } from "@valyrianjs/terminal";
import type { TerminalListActiveEventPayload, TerminalListPressEventPayload, TerminalListSelectEventPayload } from "@valyrianjs/terminal";
import type { BoardCardListItem, BoardColumn, BoardRuntimeState, Selection } from "../../types";
import { UI_COLORS } from "../../theme";
import { positiveInteger } from "./number-guards";

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

function visibleLength(value: unknown): number {
  return String(value).length;
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

  if (visibleLength(counter) <= contentWidth) {
    return counter;
  }

  return "";
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

function boardCardListDisplayItems(cardItems: BoardCardListItem[], columnIndex: number, selectedCard?: Selection | null): BoardCardListItem[] {
  return cardItems.map((card: any, cardOffset: any) => {
    const displayItem = typeof card === "object" && card !== null
      ? { ...card }
      : {};

    return {
      ...displayItem,
      toString() {
        return renderBoardCardListItem(card, cardOffset, columnIndex, selectedCard);
      }
    } as BoardCardListItem;
  });
}

type BoardCardListEvent = TerminalListActiveEventPayload<BoardCardListItem> | TerminalListPressEventPayload<BoardCardListItem> | TerminalListSelectEventPayload<BoardCardListItem>;

function selectCardFromListEvent(
  state: BoardRuntimeState,
  event: BoardCardListEvent,
  columnIndex: number
): Selection {
  const selection = selectionFromCard(columnIndex, event.value, event.index);

  state.selectedCard = selection;
  state.selectedColumnIndex = selection.columnIndex;
  return selection;
}

function openCardDetailsFromListEvent(
  state: BoardRuntimeState,
  event: BoardCardListEvent,
  columnIndex: number,
  openCardDetails?: (selection: Selection) => void
): void {
  const selection = selectCardFromListEvent(state, event, columnIndex);

  if (typeof openCardDetails === "function") {
    openCardDetails(selection);
  }
}

export function createBoardColumnNode(
  column: BoardColumn,
  columnOffset: number,
  columnWidth: number,
  state: BoardRuntimeState,
  openCardDetails?: (selection: Selection) => void,
  openColumnDetails?: (columnIndex: number) => void
): JSX.Element {
  const columnIndex = column.index ?? columnOffset + 1;
  const columnContentWidth = Math.max(1, columnWidth - 2);
  const headerLabel = formatBoardColumnHeader(column, columnContentWidth);
  const cardItems = boardCardListDisplayItems(boardCardListItems(column), columnIndex, state.selectedCard);
  const headerHeight = 2;
  function selectColumnFromHeader(): void {
    state.selectedColumnIndex = columnIndex;
  }

  function openColumnDetailsFromHeader(): void {
    selectColumnFromHeader();

    if (typeof openColumnDetails === "function") {
      openColumnDetails(columnIndex);
    }
  }

  const headerStyle = state.selectedColumnIndex === columnIndex ? BOARD_COLUMN_HEADER_ACTIVE_STYLE : BOARD_COLUMN_HEADER_STYLE;

  return (
    <Pane fill={true} style={BOARD_COLUMN_STYLE}>
      <Fixed position="top" size={headerHeight}>
        <Box height={headerHeight} style={headerStyle}>
          <Button
            id={`board-column-header-${columnIndex}`}
            label={headerLabel}
            style={headerStyle}
            styles={{ focus: BOARD_COLUMN_HEADER_ACTIVE_STYLE, hover: BOARD_COLUMN_HEADER_ACTIVE_STYLE, pressed: BOARD_COLUMN_HEADER_ACTIVE_STYLE, selected: BOARD_COLUMN_HEADER_ACTIVE_STYLE }}
            state={state.selectedColumnIndex === columnIndex ? "selected" : undefined}
            onpress={selectColumnFromHeader}
            ondoublepress={openColumnDetailsFromHeader}
          />
        </Box>
      </Fixed>
      <List
        id={`board-card-list-${columnIndex}`}
        items={cardItems}
        virtualized={true}
        width={columnContentWidth}
        fill={true}
        wrap={true}
        itemKey={(item: BoardCardListItem, index: number) => `${columnIndex}:${boardCardPosition(item, index)}`}
        showActive={false}
        onactive={(event: TerminalListActiveEventPayload<BoardCardListItem>) => {
          selectCardFromListEvent(state, event, columnIndex);
        }}
        onselect={(event: TerminalListSelectEventPayload<BoardCardListItem>) => {
          selectCardFromListEvent(state, event, columnIndex);
        }}
        onpress={(event: TerminalListPressEventPayload<BoardCardListItem>) => {
          selectCardFromListEvent(state, event, columnIndex);
        }}
        ondoublepress={(event: TerminalListPressEventPayload<BoardCardListItem>) => openCardDetailsFromListEvent(state, event, columnIndex, openCardDetails)}
      >
        {(card: BoardCardListItem) => String(card)}
      </List>
    </Pane>
  );
}
