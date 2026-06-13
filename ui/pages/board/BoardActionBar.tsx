import { createActionBar } from "../../components/ActionBar";
import { createButton } from "../../components/Button";
import type { BoardActionHandlers, OptionalTerminalChild } from "../../types";

type BoardActionBarOptions = {
  extraActions?: JSX.Element[];
};

export function createBoardActionBar(
  isActive: boolean,
  handlers: BoardActionHandlers,
  options: BoardActionBarOptions = {}
): OptionalTerminalChild {
  const extraActions = Array.isArray(options.extraActions) ? options.extraActions : [];

  return createActionBar({
    isActive,
    actions: [
      createButton("board-add-card", "Add card", handlers.openAddCard),
      createButton("board-add-column-action", "Add column", handlers.openAddColumn),
      createButton("board-reset-default-columns", "Reset to default layout", handlers.openResetColumnsConfirm),
      createButton("board-add-board", "Add board", handlers.openAddBoard),
      ...extraActions
    ]
  });
}
