import type { ActionFactoryOptions, BoardActions } from "../../action-contracts";
import BoardModel from '../../../scrumban/model';

function loadBoardModel(): any {
  return BoardModel;
}

function safeString(value: any): any {
  return typeof value === 'string' ? value.trim() : '';
}

function safeBoardId(value: any): any {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function positiveInteger(value: any): any {
  return Number.isInteger(value) && value > 0;
}

function normalizeWipLimitInput(value: any): any {
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

function boardHasCards(board: any): any {
  const columns = board && Array.isArray(board.columns) ? board.columns : [];

  return columns.some((column: any) => Array.isArray(column && column.cards) && column.cards.length > 0);
}

function findBoardById(model: any, id: any): any {
  if (typeof model.get === 'function') {
    return model.get(id);
  }

  if (typeof model.find === 'function') {
    return model.find().find((board: any) => board && (board.$id === id || board.id === id || board.index === id));
  }

  return null;
}

function ensureCurrentBoardAfterRemove(model: any): any {
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

function safeModelError(fallback: any): any {
  return {ok: false, error: fallback};
}

function createBoardActions(options: ActionFactoryOptions = {}): BoardActions {
  const injectedModel = options.model;
  const modelFor = () => injectedModel || loadBoardModel();

  function withCurrentBoard(callback: any, missingMessage: any, failureMessage: any): any {
    try {
      const model = modelFor();
      const current = typeof model.getCurrent === 'function' ? model.getCurrent() : null;

      if (!current) {
        return {ok: false, error: missingMessage};
      }

      return {ok: true, value: callback(model, current)};
    } catch (error: any) {
      return safeModelError(failureMessage);
    }
  }

  return {
    useBoard(values: any = {}) {
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
      } catch (error: any) {
        return safeModelError('We couldn’t open this board. Try again.');
      }
    },

    addBoard(values: any = {}) {
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
      } catch (error: any) {
        return safeModelError('Board could not be saved. Try again.');
      }
    },

    renameBoard(values: any = {}) {
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
      } catch (error: any) {
        return safeModelError('Board could not be renamed. Try again.');
      }
    },

    removeBoard(values: any = {}) {
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
      } catch (error: any) {
        return safeModelError('Board could not be deleted. Try again.');
      }
    },

    resetDefaultColumns() {
      const result = withCurrentBoard(
        (model: any) => {
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

      return result.ok && result.value && typeof result.value === 'object' && result.value.ok === true
        ? {ok: true, board: result.value.board}
        : result.ok && result.value && typeof result.value === 'object' && result.value.ok === false
          ? result.value
          : result.ok
            ? {ok: true, board: result.value}
            : result;
    },

    setWipLimit(values: any = {}) {
      const columnIndex = values.columnIndex;
      const wipLimit = normalizeWipLimitInput(values.wipLimit);

      if (!positiveInteger(columnIndex)) {
        return {ok: false, error: 'Choose a column first.'};
      }

      if (!wipLimit.ok) {
        return wipLimit;
      }

      const result = withCurrentBoard(
        (model: any) => model.columns.edit(columnIndex, {wipLimit: wipLimit.value}),
        'Choose a board before setting WIP limit.',
        'Column WIP limit could not be changed. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    setDefaultColumn(values: any = {}) {
      const columnIndex = values.columnIndex;

      if (!positiveInteger(columnIndex)) {
        return {ok: false, error: 'Choose a column first.'};
      }

      const result = withCurrentBoard(
        (model: any) => model.columns.setDefault(columnIndex),
        'Choose a board before changing the default column.',
        'Default column could not be changed. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    addCard(values: any = {}) {
      const title = safeString(values.title);
      const description = safeString(values.description);

      if (!title) {
        return {ok: false, error: 'Title is required.'};
      }

      const result = withCurrentBoard(
        (model: any) => model.cards.add({title, description}),
        'Choose a board before adding a card.',
        'Card could not be saved. Try again.'
      );

      return result.ok ? {ok: true, card: result.value} : result;
    },

    editCard(values: any = {}) {
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
        (model: any) => model.cards.edit({columnIndex, position, values: {title, description}}),
        'Choose a board before editing a card.',
        'Card could not be updated. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    moveCard(values: any = {}) {
      const fromColumn = values.fromColumn;
      const fromPosition = values.fromPosition;
      const toColumn = values.toColumn;

      if (!positiveInteger(fromColumn) || !positiveInteger(fromPosition) || !positiveInteger(toColumn)) {
        return {ok: false, error: 'Choose a card and destination first.'};
      }

      const result = withCurrentBoard(
        (model: any) => model.cards.move({fromColumn, fromPosition, toColumn}),
        'Choose a board before moving a card.',
        'Card could not be moved. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    prioritizeCard(values: any = {}) {
      const columnIndex = values.columnIndex;
      const position = values.position;
      const toPosition = values.toPosition;

      if (!positiveInteger(columnIndex) || !positiveInteger(position) || !positiveInteger(toPosition)) {
        return {ok: false, error: 'Choose a card and position first.'};
      }

      const result = withCurrentBoard(
        (model: any) => model.cards.move({fromColumn: columnIndex, fromPosition: position, toColumn: columnIndex, toPosition}),
        'Choose a board before changing priority.',
        'Priority could not be changed. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    removeCard(values: any = {}) {
      const columnIndex = values.columnIndex;
      const position = values.position;

      if (!positiveInteger(columnIndex) || !positiveInteger(position)) {
        return {ok: false, error: 'Choose a card first.'};
      }

      const result = withCurrentBoard(
        (model: any) => model.cards.remove({columnIndex, positions: [position]}),
        'Choose a board before removing a card.',
        'Card could not be removed. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    addColumn(values: any = {}) {
      const title = safeString(values.title);

      if (!title) {
        return {ok: false, error: 'Column title is required.'};
      }

      const result = withCurrentBoard(
        (model: any) => model.columns.add({title}),
        'Choose a board before adding a column.',
        'Column could not be saved. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    renameColumn(values: any = {}) {
      const columnIndex = values.columnIndex;
      const title = safeString(values.title);

      if (!positiveInteger(columnIndex)) {
        return {ok: false, error: 'Choose a column first.'};
      }

      if (!title) {
        return {ok: false, error: 'Column title is required.'};
      }

      const result = withCurrentBoard(
        (model: any) => model.columns.edit(columnIndex, {title}),
        'Choose a board before renaming a column.',
        'Column could not be renamed. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    moveColumnLeft(values: any = {}) {
      const columnIndex = values.columnIndex;

      if (!positiveInteger(columnIndex) || columnIndex <= 1) {
        return {ok: false, error: 'Column cannot move left.'};
      }

      const result = withCurrentBoard(
        (model: any) => model.columns.reorder({fromIndex: columnIndex, toIndex: columnIndex - 1}),
        'Choose a board before moving a column.',
        'Column could not be moved. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    moveColumnRight(values: any = {}) {
      const columnIndex = values.columnIndex;

      if (!positiveInteger(columnIndex)) {
        return {ok: false, error: 'Choose a column first.'};
      }

      const result = withCurrentBoard(
        (model: any) => model.columns.reorder({fromIndex: columnIndex, toIndex: columnIndex + 1}),
        'Choose a board before moving a column.',
        'Column could not be moved. Try again.'
      );

      return result.ok ? {ok: true, board: result.value} : result;
    },

    removeColumn(values: any = {}) {
      const columnIndex = values.columnIndex;

      if (!positiveInteger(columnIndex)) {
        return {ok: false, error: 'Choose a column first.'};
      }

      const result = withCurrentBoard(
        (model: any) => model.columns.remove(columnIndex),
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
