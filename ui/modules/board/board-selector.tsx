import { Button, View } from "@valyrianjs/terminal";
import type { BoardId, BoardSnapshot, BoardSummary } from "../../types";
import { CONTROL_BUTTON_STYLE } from "../../theme";

type BoardSelectorHandlers = {
  switchBoard?: (id: BoardId) => void;
  openBoardDetails?: (id: BoardId) => void;
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

export function renderBoardSelector(board: BoardSnapshot, handlers: BoardSelectorHandlers = {}): JSX.Element {
  const boards = boardSelectorItems(board);

  return (
    <View direction="row" gap={1}>
      {boards.map((item: BoardSummary, index: number) => {
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
