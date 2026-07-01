import type { BoardId, UiEntityId } from "./types";

export type UiActionResult = { ok: true; [key: string]: unknown } | { ok: false; error: string };
export type ActionFactoryOptions = Record<string, unknown>;
export type FileSystemIo = {
  existsSync: (path: string) => boolean;
  statSync: (path: string) => { isFile: () => boolean };
};
export type SyncCommandIo = {
  status: () => unknown | Promise<unknown>;
  retry: () => unknown | Promise<unknown>;
  enable: () => unknown | Promise<unknown>;
  disable: () => unknown | Promise<unknown>;
  init: (args: unknown[], options: { remote: string; branch: string }) => unknown | Promise<unknown>;
};
export type SyncActionFactoryOptions = {
  commands?: SyncCommandIo;
};
export type TranslateProviderIo = (values: { text: string; source: string; target: string }) => unknown | Promise<unknown>;
export type BabelActionFactoryOptions = {
  provider?: TranslateProviderIo | null;
  fetchImpl?: typeof fetch;
  log?: { cross: (message: string, color?: string) => void };
};
export type TtsServiceIo = {
  action: (args: { inputFile: string; outputFile: string; voice: string }) => { outputFile?: string } | Promise<{ outputFile?: string }>;
  voiceAction: (args: { voice: string }, options: { voice: string }) => { voice?: string } | Promise<{ voice?: string }>;
};
export type TtsActionFactoryOptions = {
  service?: TtsServiceIo;
  readStoredApiKey?: () => string | null;
  getDefaultVoice?: (options?: { fallback?: string }) => string;
  voices?: string[];
  fs?: FileSystemIo;
};

export type TodoActionResult = UiActionResult;
export type NoteActionResult = UiActionResult;
export type BoardActionResult = UiActionResult;
export type ClockActionResult = UiActionResult;
export type SyncActionResult = UiActionResult & { label?: string; details?: string[] };
export type BabelActionResult = UiActionResult & { translation?: string; source?: string; target?: string; dictionaryEntries?: string[]; message?: string };
export type TtsActionResult = UiActionResult & { outputFile?: string; voice?: string; message?: string };

export interface TodoActions {
  addTask: (values: { title: string; description?: string }) => TodoActionResult;
  editTask: (values: { position: number | null; title: string; description?: string }) => TodoActionResult;
  markTaskDone: (values: { position: number | null }) => TodoActionResult;
  markTaskOpen: (values: { position: number | null }) => TodoActionResult;
  removeTask: (values: { position: number | null }) => TodoActionResult;
  moveTask: (values: { position: number | null; direction?: "up" | "down"; toPosition?: number | null }) => TodoActionResult;
  useList: (values: { listId: UiEntityId | null }) => TodoActionResult;
  addList: (values: { title: string; description?: string }) => TodoActionResult;
  renameList: (values: { listId: UiEntityId | null; title: string; description?: string }) => TodoActionResult;
  removeList: (values: { listId: UiEntityId | null }) => TodoActionResult;
}

export interface NoteActions {
  addNote: (values: { title: string; content?: string }) => NoteActionResult;
  editNote: (values: { position: number | null; title: string; content?: string }) => NoteActionResult;
  removeNote: (values: { position: number | null }) => NoteActionResult;
  moveNote: (values: { position: number | null; direction?: "up" | "down"; toPosition?: number | null }) => NoteActionResult;
  useList: (values: { listId: UiEntityId | null }) => NoteActionResult;
  addList: (values: { title: string; description?: string }) => NoteActionResult;
  renameList: (values: { listId: UiEntityId | null; title: string; description?: string }) => NoteActionResult;
  removeList: (values: { listId: UiEntityId | null }) => NoteActionResult;
}

export interface ClockActions {
  addClock: (values: { name: string; timezone: string }) => ClockActionResult;
  removeClocks: (values: { positions: number[] }) => ClockActionResult;
  moveClock: (values: { fromPosition: number; toPosition: number }) => ClockActionResult;
  searchTimezoneChoices?: (values?: { search?: unknown }) => Array<{ name: string; value: string }>;
}

export interface SyncActions {
  status: () => SyncActionResult | Promise<SyncActionResult>;
  retry: () => SyncActionResult | Promise<SyncActionResult>;
  enable: () => SyncActionResult | Promise<SyncActionResult>;
  disable: () => SyncActionResult | Promise<SyncActionResult>;
  init: (values: { remoteUrl: string; branch: string; confirmed: boolean }) => SyncActionResult | Promise<SyncActionResult>;
}

export interface BabelActions {
  translate: (values: { text: string; source: string; target: string }) => BabelActionResult | Promise<BabelActionResult>;
  copyResult: (values: { translation: string }) => BabelActionResult | Promise<BabelActionResult>;
}

export interface TtsActions {
  voices?: string[];
  getDefaultVoice?: () => string;
  createAudio: (values: { inputFile: string; outputFile: string; voice: string; onProgress?: (message: string) => void }) => TtsActionResult | Promise<TtsActionResult>;
  setDefaultVoice: (values: { voice: string }) => TtsActionResult | Promise<TtsActionResult>;
}

export interface BoardActions {
  addCard: (values: { title: string; description: string }) => BoardActionResult;
  editCard: (values: { columnIndex: number; position: number; title: string; description: string }) => BoardActionResult;
  moveCard: (values: { fromColumn: number; fromPosition: number; toColumn: number }) => BoardActionResult;
  prioritizeCard: (values: { columnIndex: number; position: number; toPosition: number }) => BoardActionResult;
  removeCard: (values: { columnIndex: number; position: number }) => BoardActionResult;
  addColumn: (values: { title: string }) => BoardActionResult;
  renameColumn: (values: { columnIndex: number; title: string }) => BoardActionResult;
  moveColumnLeft: (values: { columnIndex: number }) => BoardActionResult;
  moveColumnRight: (values: { columnIndex: number }) => BoardActionResult;
  removeColumn: (values: { columnIndex: number }) => BoardActionResult;
  useBoard?: (values: { id: BoardId }) => BoardActionResult;
  addBoard?: (values: { title: string; description?: string }) => BoardActionResult;
  renameBoard?: (values: { boardId: BoardId | null; title: string; description?: string }) => BoardActionResult;
  removeBoard?: (values: { boardId: BoardId | null }) => BoardActionResult;
  resetDefaultColumns?: () => BoardActionResult;
  setWipLimit?: (values: { columnIndex: number; wipLimit: string | number | null }) => BoardActionResult;
  setDefaultColumn?: (values: { columnIndex: number }) => BoardActionResult;
}
