import type { UiEntityId } from "./types";

type ListActionItem = {
  $id?: unknown;
  id?: unknown;
  index?: unknown;
  [key: string]: unknown;
};

type ListActionModel = {
  getCurrent?: () => ListActionItem | null | undefined;
  getFirst?: () => ListActionItem | null | undefined;
  find?: () => unknown;
  get?: (id: UiEntityId) => ListActionItem | null | undefined;
  use?: (id: UiEntityId | null) => void;
};

type CurrentListResult =
  | { ok: true; list: ListActionItem }
  | { ok: false; error: string };

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeContent(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function safeEntityId(value: unknown): UiEntityId | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}

function entityId(item: unknown, fallback: UiEntityId | null = null): UiEntityId | null {
  if (typeof item !== 'object' || item === null) {
    return fallback;
  }

  const source = item as ListActionItem;

  if (typeof source.$id === 'number' || typeof source.$id === 'string') {
    return source.$id;
  }

  if (typeof source.id === 'number' || typeof source.id === 'string') {
    return source.id;
  }

  if (positiveInteger(source.index)) {
    return source.index;
  }

  return fallback;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function currentList(model: ListActionModel, missingMessage: string): CurrentListResult {
  const current = typeof model.getCurrent === 'function' ? model.getCurrent() : null;

  if (current) {
    return {ok: true, list: current};
  }

  const first = typeof model.getFirst === 'function' ? model.getFirst() : null;

  if (first) {
    return {ok: true, list: first};
  }

  return {ok: false, error: missingMessage};
}

function findList(model: ListActionModel, listId: unknown): ListActionItem | null {
  const id = safeEntityId(listId);

  if (id === null) {
    return null;
  }

  const lists = typeof model.find === 'function' ? asArray<ListActionItem>(model.find()) : [];
  const match = lists.find((item, index) => entityId(item, index + 1) === id || item.index === id);

  if (match) {
    return match;
  }

  if (typeof model.get === 'function') {
    return model.get(id) || null;
  }

  return null;
}

function useFallbackListIfNeeded(model: ListActionModel): void {
  const current = typeof model.getCurrent === 'function' ? model.getCurrent() : null;

  if (current) {
    return;
  }

  const first = typeof model.getFirst === 'function' ? model.getFirst() : null;

  if (first && typeof model.use === 'function') {
    model.use(entityId(first));
  }
}

export { asArray, currentList, entityId, findList, positiveInteger, safeContent, safeString, useFallbackListIfNeeded };
export default {
  asArray,
  currentList,
  entityId,
  findList,
  positiveInteger,
  safeContent,
  safeString,
  useFallbackListIfNeeded
};
