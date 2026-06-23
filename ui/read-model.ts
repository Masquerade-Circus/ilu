const DEFAULT_LIMIT = 4;

function loadModels() {
  return {
    todos: require('../todos/model'),
    notes: require('../notes/model'),
    boards: require('../scrumban/model'),
    clocks: require('../clocks/model')
  };
}

function safeText(value: any, fallback: any = '') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function hasOwnField(value: any, key: any) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactContentText(item: any, key: any) {
  if (!hasOwnField(item, key)) {
    return null;
  }

  const value = item[key];
  return typeof value === 'string' ? value : null;
}

function asArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function labelText(label: any) {
  if (typeof label === 'string') {
    return safeText(label);
  }

  if (label && typeof label === 'object') {
    return safeText(label.title);
  }

  return '';
}

function safeLabels(value: any) {
  return asArray(value).map(labelText).filter((label: any) => label.length > 0);
}

function entityId(value: any, fallback: any = null) {
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  if (typeof value.$id === 'number' || typeof value.$id === 'string') {
    return value.$id;
  }

  if (typeof value.id === 'number' || typeof value.id === 'string') {
    return value.id;
  }

  if (Number.isInteger(value.index) && value.index > 0) {
    return value.index;
  }

  return fallback;
}

function selectCurrentOrFirst(model: any) {
  const current = typeof model.getCurrent === 'function' ? model.getCurrent() : null;
  if (current) {
    return current;
  }

  return typeof model.getFirst === 'function' ? model.getFirst() : null;
}

function limitedItems(items: any, limit: any) {
  const safeItems = asArray(items);
  return {
    visible: safeItems.slice(0, limit),
    remaining: Math.max(safeItems.length - limit, 0)
  };
}

function itemText(item: any) {
  if (typeof item === 'string') {
    return safeText(item, 'Untitled');
  }

  if (!item || typeof item !== 'object') {
    return 'Untitled';
  }

  return safeText(item.title, safeText(item.description, 'Untitled'));
}

function itemDescription(item: any, keys: any = ['description']) {
  if (!item || typeof item !== 'object') {
    return '';
  }

  for (const key of keys) {
    if (key === 'content') {
      const content = exactContentText(item, key);

      if (content !== null) {
        return content;
      }

      continue;
    }

    const value = safeText(item[key]);

    if (value.length > 0) {
      return value;
    }
  }

  return '';
}

function itemSnapshot(item: any, index: any, descriptionKeys: any) {
  return {
    id: entityId(item, index + 1),
    position: index + 1,
    text: itemText(item),
    description: itemDescription(item, descriptionKeys),
    done: Boolean(item && typeof item === 'object' && item.done === true),
    labels: item && typeof item === 'object' ? safeLabels(item.labels) : []
  };
}

function sameEntityId(left: any, right: any) {
  return left !== null && right !== null && left === right;
}

function listSummaries(model: any, currentList: any) {
  const lists = typeof model.find === 'function' ? asArray(model.find()) : currentList ? [currentList] : [];
  const currentId = entityId(currentList);

  return lists
    .map((list: any, index: any) => {
      const id = entityId(list, index + 1);

      return {
        id,
        title: safeText(list && list.title, 'Untitled list'),
        current: sameEntityId(id, currentId) || Boolean(list && list.current === true)
      };
    })
    .filter((list: any) => list.id !== null || list.title.length > 0);
}

function buildListPanel({model, itemKey, descriptionKeys, emptyTitle, unavailableMessage}: any) {
  try {
    const list = selectCurrentOrFirst(model);
    const lists = listSummaries(model, list);

    if (!list) {
      return {title: emptyTitle, currentListId: null, lists, items: [], remaining: 0};
    }

    const items = asArray(list[itemKey]);

    return {
      title: safeText(list.title, emptyTitle),
      currentListId: entityId(list),
      lists,
      items: items.map((item: any, index: any) => itemSnapshot(item, index, descriptionKeys)),
      remaining: 0
    };
  } catch (error: any) {
    return {title: emptyTitle, currentListId: null, lists: [], items: [], remaining: 0, error: unavailableMessage};
  }
}

function normalizeWipLimit(value: any) {
  return Number.isInteger(value) && value >= 1 ? value : null;
}

function columnId(column: any) {
  if (!column || typeof column !== 'object') {
    return null;
  }

  if (typeof column.id === 'number' || typeof column.id === 'string') {
    return column.id;
  }

  return null;
}

function cardSnapshot(card: any, index: any) {
  return {
    title: itemText(card),
    description: itemDescription(card),
    position: index + 1
  };
}

function boardId(board: any) {
  return entityId(board);
}

function boardSummaries(model: any, currentBoard: any) {
  const boards = typeof model.find === 'function' ? asArray(model.find()) : currentBoard ? [currentBoard] : [];
  const currentId = boardId(currentBoard);

  return boards
    .map((board: any) => {
      const description = itemDescription(board);
      const summary: any = {
        id: boardId(board),
        title: safeText(board && board.title, 'Untitled board'),
        current: sameEntityId(boardId(board), currentId) || Boolean(board && board.current === true)
      };

      if (description.length > 0) {
        summary.description = description;
      }

      return summary;
    })
    .filter((board: any) => board.id !== null || board.title.length > 0);
}

function buildBoardPanel(model: any, limit: any) {
  const emptyTitle = 'No board yet';

  try {
    const board = selectCurrentOrFirst(model);
    const boards = boardSummaries(model, board);

    if (!board) {
      return {title: emptyTitle, boards, columns: [], totalCards: 0};
    }

    const boardColumns = asArray(board.columns);
    const columns = boardColumns.map((column: any, index: any) => {
      const cards = asArray(column && column.cards);

      const id = columnId(column);

      return {
        id,
        index: index + 1,
        title: safeText(column && column.title, 'Untitled column'),
        count: cards.length,
        wipLimit: normalizeWipLimit(column && column.wipLimit),
        isDefault: id !== null && board && board.defaultColumnId === id,
        cards: cards.map(cardSnapshot),
        remaining: 0
      };
    });

    return {
      id: boardId(board),
      defaultColumnId: typeof board.defaultColumnId === 'number' || typeof board.defaultColumnId === 'string' ? board.defaultColumnId : null,
      title: safeText(board.title, emptyTitle),
      boards,
      columns,
      totalCards: boardColumns.reduce((count: any, column: any) => count + asArray(column && column.cards).length, 0),
      remainingColumns: 0
    };
  } catch (error: any) {
    return {title: emptyTitle, boards: [], columns: [], totalCards: 0, error: 'Board is unavailable right now.'};
  }
}

function formatClockTime(clock: any, now: any) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      hourCycle: 'h23',
      timeZone: safeText(clock && clock.timezone)
    }).format(now);
  } catch (error: any) {
    return 'Time unavailable';
  }
}

function buildClocksPanel(model: any, _limit: any, now: any) {
  try {
    const clocks = typeof model.find === 'function' ? asArray(model.find()) : [];

    return {
      items: clocks.map((clock: any, index: any) => ({
        name: safeText(clock && clock.name, 'Clock'),
        timezone: safeText(clock && clock.timezone),
        position: index + 1,
        time: formatClockTime(clock, now)
      })),
      remaining: 0
    };
  } catch (error: any) {
    return {items: [], remaining: 0, error: 'Clocks are unavailable right now.'};
  }
}

function buildTodoSnapshot(models: any) {
  return buildListPanel({
    model: models.todos,
    itemKey: 'tasks',
    emptyTitle: 'No todo list yet',
    descriptionKeys: ['description'],
    unavailableMessage: 'Todo is unavailable right now.'
  });
}

function buildNotesSnapshot(models: any) {
  return buildListPanel({
    model: models.notes,
    itemKey: 'notes',
    emptyTitle: 'No notes list yet',
    descriptionKeys: ['content', 'description'],
    unavailableMessage: 'Notes are unavailable right now.'
  });
}

function buildReadSnapshot(options: any = {}) {
  const models = options.models || loadModels();
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  const now = options.now instanceof Date ? options.now : new Date();

  return {
    todo: buildTodoSnapshot(models),
    notes: buildNotesSnapshot(models),
    board: buildBoardPanel(models.boards, limit),
    clocks: buildClocksPanel(models.clocks, limit, now)
  };
}

function buildReadSnapshotDomain(domain: any, options: any = {}) {
  const models = options.models || loadModels();
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  const now = options.now instanceof Date ? options.now : new Date();

  if (domain === 'todo') {
    return {todo: buildTodoSnapshot(models)};
  }

  if (domain === 'notes') {
    return {notes: buildNotesSnapshot(models)};
  }

  if (domain === 'board') {
    return {board: buildBoardPanel(models.boards, limit)};
  }

  if (domain === 'clocks') {
    return {clocks: buildClocksPanel(models.clocks, limit, now)};
  }

  return null;
}

module.exports = {
  buildReadSnapshot,
  buildReadSnapshotDomain,
  loadModels
};
