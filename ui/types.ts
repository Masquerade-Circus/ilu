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
  id: UiEntityId | null;
  title: string;
  current?: boolean;
}

export interface ListItem {
  id?: UiEntityId | null;
  position?: number;
  done?: boolean;
  text: string;
  description?: string;
  labels?: string[];
}

export interface ListPanel {
  title: string;
  currentListId?: UiEntityId | null;
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
  id: BoardId | null;
  title: string;
  description?: string;
  current?: boolean;
}

export interface BoardSnapshot {
  id?: BoardId | null;
  defaultColumnId?: BoardId | null;
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

export type {
  BabelActionResult,
  BabelActions,
  BoardActionResult,
  BoardActions,
  ClockActionResult,
  ClockActions,
  NoteActionResult,
  NoteActions,
  SyncActionResult,
  SyncActions,
  TodoActionResult,
  TodoActions,
  TtsActionResult,
  TtsActions,
  UiActionResult
} from "./action-contracts";

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
