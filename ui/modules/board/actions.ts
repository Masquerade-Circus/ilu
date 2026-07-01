import type { ActionFactoryOptions, BoardActions } from "../../action-contracts";
import BoardModel from '../../../scrumban/model';
import type { BoardId, BoardItem } from '../../../scrumban/model';

type ActionResult = {ok: true; [key: string]: unknown} | {ok: false; error: string};

type BoardValues = Record<string, unknown>;
type BoardTitleValues = BoardValues & {title?: unknown; description?: unknown};
type BoardIdValues = BoardValues & {id?: unknown; boardId?: unknown};
type ColumnIndexValues = BoardValues & {columnIndex?: unknown};
type ColumnTitleValues = ColumnIndexValues & {title?: unknown};
type WipLimitValues = ColumnIndexValues & {wipLimit?: unknown};
type CardValues = BoardValues & {columnIndex?: unknown; position?: unknown; title?: unknown; description?: unknown};
type MoveCardValues = BoardValues & {fromColumn?: unknown; fromPosition?: unknown; toColumn?: unknown};
type PriorityValues = CardValues & {toPosition?: unknown};

type WipLimitResult = {ok: true; value: number | null} | {ok: false; error: string};

type BoardColumnActionsIo = {
  add: (values: {title: string}) => unknown;
  edit: (columnIndex: number, values: {title?: string; wipLimit?: number | null}) => unknown;
  setDefault: (columnIndex: number) => unknown;
  reorder: (values: {fromIndex: number; toIndex: number}) => unknown;
  remove: (columnIndex: number) => unknown;
  resetSimpleDefault: () => unknown;
};

type BoardCardActionsIo = {
  add: (values: {title: string; description: string}) => unknown;
  edit: (values: {columnIndex: number; position: number; values: {title: string; description: string}}) => unknown;
  move: (values: {fromColumn: number; fromPosition: number; toColumn: number; toPosition?: number}) => unknown;
  remove: (values: {columnIndex: number; positions: number[]}) => unknown;
};

type BoardModelIo = {
  get?: (id: BoardId) => BoardItem | null;
  find?: () => BoardItem[];
  getCurrent?: () => BoardItem | null;
  getFirst?: () => BoardItem | null;
  use?: (id: BoardId) => unknown;
  add?: (values: {title: string; description: string}) => unknown;
  save?: (board: BoardItem) => unknown;
  remove?: (board: BoardItem) => unknown;
  columns?: Partial<BoardColumnActionsIo>;
  cards?: Partial<BoardCardActionsIo>;
};

function loadBoardModel(): BoardModelIo {
  return BoardModel;
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeBoardId(value: unknown): BoardId | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isActionResult(value: unknown): value is ActionResult {
  return typeof value === 'object' && value !== null && 'ok' in value;
}

function normalizeWipLimitInput(value: unknown): WipLimitResult {
  if (typeof value === 'number') {
    if (value === 0) {
      return {ok: true, value: null};
    }

    if (Number.isInteger(value) && value > 0) {
      return {ok: true, value};
    }

    return {ok: false, error: 'Choose a WIP limit of 0 or higher.'};
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (trimmed === '0' || trimmed.length === 0) {
      return {ok: true, value: null};
    }

    if (/^[1-9]\d*$/.test(trimmed)) {
      return {ok: true, value: Number.parseInt(trimmed, 10)};
    }

    return {ok: false, error: 'Choose a WIP limit of 0 or higher.'};
  }

  if (value === null) {
    return {ok: true, value: null};
  }

  return {ok: false, error: 'Choose a WIP limit of 0 or higher.'};
}

function boardHasCards(board: BoardItem | null): boolean {
  const columns = board && Array.isArray(board.columns) ? board.columns : [];

  return columns.some((column) => Array.isArray(column && column.cards) && column.cards.length > 0);
}

function findBoardById(model: BoardModelIo, id: BoardId): BoardItem | null {
  if (typeof model.get === 'function') {
    return model.get(id);
  }

  if (typeof model.find === 'function') {
    return model.find().find((board: BoardItem) => board.$id === id || board.id === id || board.index === id) ?? null;
  }

  return null;
}

function ensureCurrentBoardAfterRemove(model: BoardModelIo): void {
  const current = typeof model.getCurrent === 'function' ? model.getCurrent() : null;

  if (current) {
    return;
  }

  const first = typeof model.getFirst === 'function' ? model.getFirst() : null;

  if (first && typeof model.use === 'function') {
    const id = typeof first.$id === 'number' || typeof first.$id === 'string' ? first.$id : first.id;

    if (typeof id === 'number' || typeof id === 'string') {
      model.use(id);
    }
  }
}

function safeModelError(fallback: string): ActionResult {
  return {ok: false, error: fallback};
}

function requireColumnAction<Name extends keyof BoardColumnActionsIo>(model: BoardModelIo, name: Name): BoardColumnActionsIo[Name] {
  const action = model.columns?.[name];

  if (typeof action !== 'function') {
    throw new Error(`Missing board column action: ${name}`);
  }

  return action as BoardColumnActionsIo[Name];
}

function requireCardAction<Name extends keyof BoardCardActionsIo>(model: BoardModelIo, name: Name): BoardCardActionsIo[Name] {
  const action = model.cards?.[name];

  if (typeof action !== 'function') {
    throw new Error(`Missing board card action: ${name}`);
  }

  return action as BoardCardActionsIo[Name];
}

function createBoardActions(options: ActionFactoryOptions = {}): BoardActions {
  const injectedModel = options.model as BoardModelIo | undefined;
  const modelFor = () => injectedModel || loadBoardModel();

  function withCurrentBoard(callback: (model: BoardModelIo, current: BoardItem) => unknown, missingMessage: string, failureMessage: string): ActionResult {
    try {
      const model = modelFor();
      const current = typeof model.getCurrent === 'function' ? model.getCurrent() : null;

      if (!current) {
        return {ok: false, error: missingMessage};
      }

      return {ok: true, value: callback(model, current)};
    } catch {
      return safeModelError(failureMessage);
    }
  }

  return {
    useBoard(values: BoardIdValues = {}) {
      const id = safeBoardId(values.id);

      if (id === null) {
        return {ok: false, error: 'Choose a board first.'};
      }

      try {
        const model = modelFor();

        if (typeof model.use !== 'function') {
          return {ok: false, error: 'We couldn’t open this board. Try again.'};
        }

        return {ok: true, board: model.use(id)};
      } catch {
        return safeModelError('We couldn’t open this board. Try again.');
      }
    },

    addBoard(values: BoardTitleValues = {}) {
      const title = safeString(values.title);
      const description = safeString(values.description);

      if (!title) {
        return {ok: false, error: 'Title is required.'};
      }

      try {
        const model = modelFor();

        if (typeof model.add !== 'function') {
          return {ok: false, error: 'Board could not be saved. Try again.'};
        }

        return {ok: true, board: model.add({title, description})};
      } catch {
        return safeModelError('Board could not be saved. Try again.');
      }
    },

    renameBoard(values: BoardIdValues & BoardTitleValues = {}) {
      const boardId = safeBoardId(values.boardId);
      const title = safeString(values.title);
      const description = safeString(values.description);

      if (boardId === null) {
        return {ok: false, error: 'Choose a board first.'};
      }

      if (!title) {
        return {ok: false, error: 'Title is required.'};
      }

      try {
        const model = modelFor();
        const board = findBoardById(model, boardId);

        if (!board || typeof model.save !== 'function') {
          return {ok: false, error: 'Board could not be renamed. Try again.'};
        }

        board.title = title;
        board.description = description;
        return {ok: true, board: model.save(board)};
      } catch {
        return safeModelError('Board could not be renamed. Try again.');
      }
    },

    removeBoard(values: BoardIdValues = {}) {
      const boardId = safeBoardId(values.boardId);

      if (boardId === null) {
        return {ok: false, error: 'Choose a board first.'};
      }

      try {
        const model = modelFor();
        const board = findBoardById(model, boardId);

        if (!board || typeof model.remove !== 'function') {
          return {ok: false, error: 'Board could not be deleted. Try again.'};
        }

        const removed = model.remove(board);
        ensureCurrentBoardAfterRemove(model);
        return {ok: true, board: removed};
      } catch {
        return safeModelError('Board could not be deleted. Try again.');
      }
    },

    resetDefaultColumns() {
      const result = withCurrentBoard(
        (model: BoardModelIo) => {
          const current = typeof model.getCurrent === 'function' ? model.getCurrent() : null;

          if (!current) {
            return {ok: false, error: 'Choose a board before resetting columns.'};
          }

          if (boardHasCards(current)) {
            return {ok: false, error: 'Move or remove cards before resetting columns.'};
          }

          if (!model.columns || typeof model.columns.resetSimpleDefault !== 'function') {
            return {ok: false, error: 'Columns could not be reset. Try again.'};
          }

          return {ok: true, board: model.columns.resetSimpleDefault()};
        },
        'Choose a board before resetting columns.',
        'Columns could not be reset. Try again.'
      );

      if (!result.ok) {
        return result;
      }

      if (isActionResult(result.value)) {
        return result.value.ok ? {ok: true, board: result.value.board} : result.value;
      }

      return {ok: true, board: result.value};
    },

    setWipLimit(values: WipLimitValues = {}) {
      const columnIndex = values.columnIndex;
      const wipLimit = normalizeWipLimitInput(values.wipLimit);

      if (!positiveInteger(columnIndex)) {
        return {ok: false, error: 'Choose a column first.'};
      }

      if (!wipLimit.ok) {
        return wipLimit;
      }

      const result = withCurrentBoard(
        (model: BoardModelIo) => requireColumnAction(model, 'edit')(columnIndex, {wipLimit: wipLimit.value}),
        'Choose a board before setting WIP limit.',
        'Column WIP limit could not be changed. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    setDefaultColumn(values: ColumnIndexValues = {}) {
      const columnIndex = values.columnIndex;

      if (!positiveInteger(columnIndex)) {
        return {ok: false, error: 'Choose a column first.'};
      }

      const result = withCurrentBoard(
        (model: BoardModelIo) => requireColumnAction(model, 'setDefault')(columnIndex),
        'Choose a board before changing the default column.',
        'Default column could not be changed. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    addCard(values: BoardTitleValues = {}) {
      const title = safeString(values.title);
      const description = safeString(values.description);

      if (!title) {
        return {ok: false, error: 'Title is required.'};
      }

      const result = withCurrentBoard(
        (model: BoardModelIo) => requireCardAction(model, 'add')({title, description}),
        'Choose a board before adding a card.',
        'Card could not be saved. Try again.'
      );

      return result.ok ? {ok: true, card: result.value} : result;
    },

    editCard(values: CardValues = {}) {
      const columnIndex = values.columnIndex;
      const position = values.position;
      const title = safeString(values.title);
      const description = safeString(values.description);

      if (!positiveInteger(columnIndex) || !positiveInteger(position)) {
        return {ok: false, error: 'Choose a card first.'};
      }

      if (!title) {
        return {ok: false, error: 'Title is required.'};
      }

      const result = withCurrentBoard(
        (model: BoardModelIo) => requireCardAction(model, 'edit')({columnIndex, position, values: {title, description}}),
        'Choose a board before editing a card.',
        'Card could not be updated. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    moveCard(values: MoveCardValues = {}) {
      const fromColumn = values.fromColumn;
      const fromPosition = values.fromPosition;
      const toColumn = values.toColumn;

      if (!positiveInteger(fromColumn) || !positiveInteger(fromPosition) || !positiveInteger(toColumn)) {
        return {ok: false, error: 'Choose a card and destination first.'};
      }

      const result = withCurrentBoard(
        (model: BoardModelIo) => requireCardAction(model, 'move')({fromColumn, fromPosition, toColumn}),
        'Choose a board before moving a card.',
        'Card could not be moved. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    prioritizeCard(values: PriorityValues = {}) {
      const columnIndex = values.columnIndex;
      const position = values.position;
      const toPosition = values.toPosition;

      if (!positiveInteger(columnIndex) || !positiveInteger(position) || !positiveInteger(toPosition)) {
        return {ok: false, error: 'Choose a card and position first.'};
      }

      const result = withCurrentBoard(
        (model: BoardModelIo) => requireCardAction(model, 'move')({fromColumn: columnIndex, fromPosition: position, toColumn: columnIndex, toPosition}),
        'Choose a board before changing priority.',
        'Priority could not be changed. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    removeCard(values: CardValues = {}) {
      const columnIndex = values.columnIndex;
      const position = values.position;

      if (!positiveInteger(columnIndex) || !positiveInteger(position)) {
        return {ok: false, error: 'Choose a card first.'};
      }

      const result = withCurrentBoard(
        (model: BoardModelIo) => requireCardAction(model, 'remove')({columnIndex, positions: [position]}),
        'Choose a board before removing a card.',
        'Card could not be removed. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    addColumn(values: BoardTitleValues = {}) {
      const title = safeString(values.title);

      if (!title) {
        return {ok: false, error: 'Column title is required.'};
      }

      const result = withCurrentBoard(
        (model: BoardModelIo) => requireColumnAction(model, 'add')({title}),
        'Choose a board before adding a column.',
        'Column could not be saved. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    renameColumn(values: ColumnTitleValues = {}) {
      const columnIndex = values.columnIndex;
      const title = safeString(values.title);

      if (!positiveInteger(columnIndex)) {
        return {ok: false, error: 'Choose a column first.'};
      }

      if (!title) {
        return {ok: false, error: 'Column title is required.'};
      }

      const result = withCurrentBoard(
        (model: BoardModelIo) => requireColumnAction(model, 'edit')(columnIndex, {title}),
        'Choose a board before renaming a column.',
        'Column could not be renamed. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    moveColumnLeft(values: ColumnIndexValues = {}) {
      const columnIndex = values.columnIndex;

      if (!positiveInteger(columnIndex) || columnIndex <= 1) {
        return {ok: false, error: 'Column cannot move left.'};
      }

      const result = withCurrentBoard(
        (model: BoardModelIo) => requireColumnAction(model, 'reorder')({fromIndex: columnIndex, toIndex: columnIndex - 1}),
        'Choose a board before moving a column.',
        'Column could not be moved. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    moveColumnRight(values: ColumnIndexValues = {}) {
      const columnIndex = values.columnIndex;

      if (!positiveInteger(columnIndex)) {
        return {ok: false, error: 'Choose a column first.'};
      }

      const result = withCurrentBoard(
        (model: BoardModelIo) => requireColumnAction(model, 'reorder')({fromIndex: columnIndex, toIndex: columnIndex + 1}),
        'Choose a board before moving a column.',
        'Column could not be moved. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    removeColumn(values: ColumnIndexValues = {}) {
      const columnIndex = values.columnIndex;

      if (!positiveInteger(columnIndex)) {
        return {ok: false, error: 'Choose a column first.'};
      }

      const result = withCurrentBoard(
        (model: BoardModelIo) => requireColumnAction(model, 'remove')(columnIndex),
        'Choose a board before removing a column.',
        'Column could not be removed. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    }
  };
}

export { createBoardActions };
export default {
  createBoardActions
};
