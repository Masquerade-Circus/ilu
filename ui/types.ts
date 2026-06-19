import type { TerminalStyleValue } from "@valyrianjs/terminal";

export type TerminalChild = JSX.Element;
export type OptionalTerminalChild = JSX.Element | null;

export interface Selection {
  columnIndex: number;
  position: number;
}

export interface CardFormState {
  title: string;
  description: string;
  error: string;
}

export interface TitleFormState {
  title: string;
  error: string;
}

export interface TextFormState {
  title: string;
  description: string;
  error: string;
}

export type SyncStatusState = "idle" | "syncing" | "pending" | "synced" | "failed" | "setup";

export interface TodoRuntimeState {
  selectedTaskPosition: number | null;
  selectedListId: UiEntityId | null;
  addTask: TextFormState;
  editTask: TextFormState;
  addList: TextFormState;
  renameList: TextFormState;
  overlay: string | null;
  actionError: string;
}

export interface NotesRuntimeState {
  selectedNotePosition: number | null;
  selectedListId: UiEntityId | null;
  addNote: TextFormState;
  editNote: TextFormState;
  addList: TextFormState;
  renameList: TextFormState;
  overlay: string | null;
  actionError: string;
}

export interface ClockFormState {
  name: string;
  timezone: string;
  timezoneSearch: string;
  error: string;
}

export interface ClockRuntimeState {
  selectedClockPosition: number | null;
  removeClockPositions: number[];
  addClock: ClockFormState;
  overlay: string | null;
  actionError: string;
}

export interface BoardRuntimeState {
  selectedCard: Selection | null;
  selectedColumnIndex: number;
  selectedBoardId: BoardId | null;
  addCard: CardFormState;
  editCard: CardFormState;
  addColumn: TitleFormState;
  renameColumn: TitleFormState;
  addBoard: TextFormState;
  renameBoard: TextFormState;
  wipLimit: TitleFormState;
  overlay: string | null;
  actionError: string;
  pendingFocus: string | null;
  removeCardArmedUntil: number;
  removeCardArmedSelection: Selection | null;
  removeColumnArmedUntil: number;
  removeColumnArmedIndex: number | null;
}

export type UtilityOverlayId = "sync-init" | "tts-voice" | null;

export interface SyncInitFormState {
  remoteUrl: string;
  branch: string;
  confirmed: boolean;
  error: string;
}

export interface SyncUtilityState {
  label: string;
  details: string[];
  error: string;
  operation: string | null;
  statusLoaded: boolean;
  initForm: SyncInitFormState;
}


export interface BabelUtilityState {
  text: string;
  source: string;
  target: string;
  translation: string;
  dictionaryEntries: string[];
  error: string;
  message: string;
  operation: string | null;
  inputVersion: number;
}

export interface TtsUtilityState {
  inputFile: string;
  outputFile: string;
  voice: string;
  voices: string[];
  error: string;
  message: string;
  operation: string | null;
}

export interface UtilityRuntimeState {
  activeOverlay: UtilityOverlayId;
  sync: SyncUtilityState;
  babel: BabelUtilityState;
  tts: TtsUtilityState;
}

export interface AppState {
  activeTab: string;
  todo: TodoRuntimeState;
  notesState: NotesRuntimeState;
  board: BoardRuntimeState;
  clocksState: ClockRuntimeState;
  utilities: UtilityRuntimeState;
}

export type UiEntityId = string | number;

export interface ListSummary {
  id: UiEntityId;
  title: string;
  current?: boolean;
}

export interface ListItem {
  id?: UiEntityId;
  position?: number;
  done?: boolean;
  text: string;
  description?: string;
  labels?: string[];
}

export interface ListPanel {
  title: string;
  currentListId?: UiEntityId;
  lists?: ListSummary[];
  items?: ListItem[];
  remaining?: number;
  error?: string;
}

export interface ClockItem {
  name?: string;
  time: string;
  timezone?: string;
  position?: number;
}

export interface ClockSnapshot {
  error?: string;
  items?: ClockItem[];
  remaining?: number;
}


export interface BoardCard {
  title?: string;
  description?: string;
  position?: number;
  [key: string]: unknown;
}

export interface BoardColumn {
  id?: BoardId;
  index?: number;
  title?: string;
  count?: number;
  wipLimit?: number | null;
  isDefault?: boolean;
  cards?: Array<BoardCard | string | null | undefined>;
}

export type BoardId = string | number;

export interface BoardSummary {
  id: BoardId;
  title: string;
  description?: string;
  current?: boolean;
}

export interface BoardSnapshot {
  id?: BoardId;
  defaultColumnId?: BoardId;
  error?: string;
  title: string;
  boards?: BoardSummary[];
  columns?: BoardColumn[];
  totalCards?: number;
  remainingColumns?: number;
}

export type UiSnapshotDomain = "todo" | "notes" | "board" | "clocks";
export type RefreshSnapshot = (domain?: UiSnapshotDomain) => void;

export interface UiSnapshot {
  todo: ListPanel;
  notes: ListPanel;
  board: BoardSnapshot;
  clocks: ClockSnapshot;
}

export interface BoardLayout {
  width: number;
  openCardDetails?: (selection: Selection) => void;
  openColumnDetails?: (columnIndex: number) => void;
  switchBoard?: (id: BoardId) => void;
  openBoardDetails?: (id: BoardId) => void;
}

export type BoardCardListItem = BoardCard | string | null | undefined;

export type UiActionResult = { ok: true; [key: string]: unknown } | { ok: false; error: string };

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

export interface BoardActionHandlers {
  openAddCard: () => void;
  openAddColumn: () => void;
  openResetColumnsConfirm: () => void;
  openAddBoard: () => void;
}

export interface FooterSegment {
  text: string;
  style?: TerminalStyleValue;
}

export interface AppShellOptions {
  activePanelNodes: TerminalChild[];
  actionBar?: OptionalTerminalChild;
  boardActionBar?: OptionalTerminalChild;
  children?: OptionalTerminalChild[];
  footerText: string;
  footerSegments?: FooterSegment[];
  footerStyle: TerminalStyleValue;
  panelStyle: TerminalStyleValue;
  topNav: TerminalChild;
  width: number;
}
