import type {
  BoardColumn,
  BoardId,
  BoardSnapshot,
  BoardSummary,
  ClockSnapshot,
  ListItem,
  ListPanel,
  ListSummary,
  UiEntityId,
  UiSnapshot
} from "./types";
import * as todosModel from '../todos/model.ts';
import * as notesModel from '../notes/model.ts';
import * as boardsModel from '../scrumban/model.ts';
import clocksModel from '../clocks/model.ts';

const DEFAULT_LIMIT = 4;

type ReadEntity = {
  $id?: unknown;
  id?: unknown;
  index?: unknown;
  title?: unknown;
  description?: unknown;
  content?: unknown;
  done?: unknown;
  labels?: unknown;
  current?: unknown;
  [key: string]: unknown;
};

type ReadList = ReadEntity & {
  tasks?: unknown;
  notes?: unknown;
};

type ReadBoard = ReadEntity & {
  columns?: unknown;
  defaultColumnId?: unknown;
};

type ReadColumn = ReadEntity & {
  cards?: unknown;
  wipLimit?: unknown;
};

type ReadClock = {
  name?: unknown;
  timezone?: unknown;
};

type ReadModel<T> = {
  getCurrent?: () => T | null | undefined;
  getFirst?: () => T | null | undefined;
  find?: () => unknown;
};

type ReadModels = {
  todos: ReadModel<ReadList>;
  notes: ReadModel<ReadList>;
  boards: ReadModel<ReadBoard>;
  clocks: { find?: () => unknown };
};

type ReadSnapshotOptions = {
  models?: ReadModels;
  limit?: unknown;
  now?: unknown;
};

type ListPanelOptions = {
  model: ReadModel<ReadList>;
  itemKey: "tasks" | "notes";
  descriptionKeys: string[];
  emptyTitle: string;
  unavailableMessage: string;
};

function loadModels(): ReadModels {
  return {
    todos: todosModel,
    notes: notesModel,
    boards: boardsModel,
    clocks: clocksModel
  };
}

function safeText(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function hasOwnField(value: unknown, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactContentText(item: ReadEntity, key: string): string | null {
  if (!hasOwnField(item, key)) {
    return null;
  }

  const value = item[key];
  return typeof value === 'string' ? value : null;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function labelText(label: unknown): string {
  if (typeof label === 'string') {
    return safeText(label);
  }

  if (label && typeof label === 'object') {
    return safeText((label as ReadEntity).title);
  }

  return '';
}

function safeLabels(value: unknown): string[] {
  return asArray(value).map(labelText).filter((label) => label.length > 0);
}

function entityId(value: unknown, fallback: UiEntityId | null = null): UiEntityId | null {
  if (typeof value !== 'object' || value === null) {
    return fallback;
  }

  const source = value as ReadEntity;

  if (typeof source.$id === 'number' || typeof source.$id === 'string') {
    return source.$id;
  }

  if (typeof source.id === 'number' || typeof source.id === 'string') {
    return source.id;
  }

  if (Number.isInteger(source.index) && Number(source.index) > 0) {
    return source.index as number;
  }

  return fallback;
}

function selectCurrentOrFirst<T>(model: ReadModel<T>): T | null {
  const current = typeof model.getCurrent === 'function' ? model.getCurrent() : null;
  if (current) {
    return current;
  }

  return typeof model.getFirst === 'function' ? model.getFirst() ?? null : null;
}

function itemText(item: unknown): string {
  if (typeof item === 'string') {
    return safeText(item, 'Untitled');
  }

  if (!item || typeof item !== 'object') {
    return 'Untitled';
  }

  const source = item as ReadEntity;
  return safeText(source.title, safeText(source.description, 'Untitled'));
}

function itemDescription(item: unknown, keys: string[] = ['description']): string {
  if (typeof item !== 'object' || item === null) {
    return '';
  }

  const source = item as ReadEntity;

  for (const key of keys) {
    if (key === 'content') {
      const content = exactContentText(source, key);

      if (content !== null) {
        return content;
      }

      continue;
    }

    const value = safeText(source[key]);

    if (value.length > 0) {
      return value;
    }
  }

  return '';
}

function itemSnapshot(item: unknown, index: number, descriptionKeys: string[]): ListItem {
  return {
    id: entityId(item, index + 1),
    position: index + 1,
    text: itemText(item),
    description: itemDescription(item, descriptionKeys),
    done: Boolean(item && typeof item === 'object' && (item as ReadEntity).done === true),
    labels: item && typeof item === 'object' ? safeLabels((item as ReadEntity).labels) : []
  };
}

function sameEntityId(left: UiEntityId | null, right: UiEntityId | null): boolean {
  return left !== null && right !== null && left === right;
}

function listSummaries(model: ReadModel<ReadList>, currentList: ReadList | null): ListSummary[] {
  const lists = typeof model.find === 'function' ? asArray<ReadList>(model.find()) : currentList ? [currentList] : [];
  const currentId = entityId(currentList);

  return lists
    .map((list): ListSummary => {
      const id = entityId(list);

      return {
        id,
        title: safeText(list && list.title, 'Untitled list'),
        current: list === currentList || sameEntityId(id, currentId) || Boolean(list && list.current === true)
      };
    })
    .filter((list) => list.id !== null || list.title.length > 0);
}

function buildListPanel({model, itemKey, descriptionKeys, emptyTitle, unavailableMessage}: ListPanelOptions): ListPanel {
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
      items: items.map((item, index) => itemSnapshot(item, index, descriptionKeys)),
      remaining: 0
    };
  } catch (_error: unknown) {
    void _error;
    return {title: emptyTitle, currentListId: null, lists: [], items: [], remaining: 0, error: unavailableMessage};
  }
}

function normalizeWipLimit(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

function normalizeLimit(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : DEFAULT_LIMIT;
}

function columnId(column: unknown): BoardId | null {
  if (typeof column !== 'object' || column === null) {
    return null;
  }

  const source = column as ReadColumn;

  if (typeof source.id === 'number' || typeof source.id === 'string') {
    return source.id;
  }

  return null;
}

function cardSnapshot(card: unknown, index: number): { title: string; description: string; position: number } {
  return {
    title: itemText(card),
    description: itemDescription(card),
    position: index + 1
  };
}

function boardId(board: unknown): BoardId | null {
  return entityId(board);
}

function boardSummaries(model: ReadModel<ReadBoard>, currentBoard: ReadBoard | null): BoardSummary[] {
  const boards = typeof model.find === 'function' ? asArray<ReadBoard>(model.find()) : currentBoard ? [currentBoard] : [];
  const currentId = boardId(currentBoard);

  return boards
    .map((board): BoardSummary => {
      const description = itemDescription(board);
      const summary: BoardSummary = {
        id: boardId(board),
        title: safeText(board && board.title, 'Untitled board'),
        current: sameEntityId(boardId(board), currentId) || Boolean(board && board.current === true)
      };

      if (description.length > 0) {
        summary.description = description;
      }

      return summary;
    })
    .filter((board) => board.id !== null || board.title.length > 0);
}

function buildBoardPanel(model: ReadModel<ReadBoard>, _limit: number): BoardSnapshot {
  const emptyTitle = 'No board yet';

  try {
    const board = selectCurrentOrFirst(model);
    const boards = boardSummaries(model, board);

    if (!board) {
      return {title: emptyTitle, boards, columns: [], totalCards: 0};
    }

    const boardColumns = asArray<ReadColumn>(board.columns);
    const columns = boardColumns.map((column, index): BoardColumn & { remaining: number } => {
      const cards = asArray(column.cards);

      const id = columnId(column);

      return {
        ...(id !== null ? { id } : {}),
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
      totalCards: boardColumns.reduce((count: number, column) => count + asArray(column.cards).length, 0),
      remainingColumns: 0
    };
  } catch (_error: unknown) {
    void _error;
    return {title: emptyTitle, boards: [], columns: [], totalCards: 0, error: 'Board is unavailable right now.'};
  }
}

function formatClockTime(clock: ReadClock, now: Date): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      hourCycle: 'h23',
      timeZone: safeText(clock && clock.timezone)
    }).format(now);
  } catch (_error: unknown) {
    void _error;
    return 'Time unavailable';
  }
}

function buildClocksPanel(model: { find?: () => unknown }, _limit: number, now: Date): ClockSnapshot {
  try {
    const clocks = typeof model.find === 'function' ? asArray<ReadClock>(model.find()) : [];

    return {
      items: clocks.map((clock, index) => ({
        name: safeText(clock && clock.name, 'Clock'),
        timezone: safeText(clock && clock.timezone),
        position: index + 1,
        time: formatClockTime(clock, now)
      })),
      remaining: 0
    };
  } catch (_error: unknown) {
    void _error;
    return {items: [], remaining: 0, error: 'Clocks are unavailable right now.'};
  }
}

function buildTodoSnapshot(models: ReadModels): ListPanel {
  return buildListPanel({
    model: models.todos,
    itemKey: 'tasks',
    emptyTitle: 'No todo list yet',
    descriptionKeys: ['description'],
    unavailableMessage: 'Todo is unavailable right now.'
  });
}

function buildNotesSnapshot(models: ReadModels): ListPanel {
  return buildListPanel({
    model: models.notes,
    itemKey: 'notes',
    emptyTitle: 'No notes list yet',
    descriptionKeys: ['content', 'description'],
    unavailableMessage: 'Notes are unavailable right now.'
  });
}

function buildReadSnapshot(options: ReadSnapshotOptions = {}): UiSnapshot {
  const models = options.models || loadModels();
  const limit = normalizeLimit(options.limit);
  const now = options.now instanceof Date ? options.now : new Date();

  return {
    todo: buildTodoSnapshot(models),
    notes: buildNotesSnapshot(models),
    board: buildBoardPanel(models.boards, limit),
    clocks: buildClocksPanel(models.clocks, limit, now)
  };
}

function buildReadSnapshotDomain(domain: unknown, options: ReadSnapshotOptions = {}): Partial<UiSnapshot> | null {
  const models = options.models || loadModels();
  const limit = normalizeLimit(options.limit);
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

export { buildReadSnapshot, buildReadSnapshotDomain, loadModels };
export default {
  buildReadSnapshot,
  buildReadSnapshotDomain,
  loadModels
};
