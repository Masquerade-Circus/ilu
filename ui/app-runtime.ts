import type {
  TerminalMountOptions,
  TerminalOutputStream,
  TerminalSession
} from "@valyrianjs/terminal";
import type {
  AppState,
  BabelActionResult,
  BabelActions,
  BoardActions,
  ClockActions,
  NoteActions,
  RefreshSnapshot,
  SyncActions,
  SyncStatusState,
  TodoActions,
  TtsActions,
  UiSnapshot,
  UiSnapshotDomain
} from "./types";

export type TerminalRuntimeModule = typeof import("@valyrianjs/terminal");
export type ValyrianRuntime = { v: (tag: unknown, props?: Record<string, unknown>, ...children: unknown[]) => JSX.Element };
export type Runtime = { terminal: TerminalRuntimeModule; valyrian: ValyrianRuntime };
export type SyncStatusEvent = { state?: unknown; message?: unknown; context?: unknown };
export type TuiSyncRunnerClient = { notifyLocalMutation: (context?: unknown) => Promise<unknown>; flush?: () => Promise<unknown>; shutdown?: () => Promise<unknown>; dispose?: () => void; hasPendingWork?: () => boolean; onEvent?: (listener: (event: SyncStatusEvent) => void) => () => void };
export type NotifySyncHook = ((context?: unknown) => void) & { onSyncStatus?: (listener: (event: SyncStatusEvent) => void) => () => void; flushPending?: () => boolean | Promise<boolean>; configureSyncRunner?: (runner: TuiSyncRunnerClient | null) => () => void };
export type Tab = "Todo" | "Notes" | "Board" | "Clocks" | "Sync" | "Translate" | "Speech";
export type AppRuntimeState = AppState & {
  activeTab: Tab;
  overlay: string | null;
  running: boolean;
  syncStatus: SyncStatusState;
};

export type SnapshotRef = {
  current: UiSnapshot;
  refresh: (domain?: UiSnapshotDomain) => UiSnapshot;
};

export type SnapshotOptions = Record<string, unknown>;
export type BuildSnapshot = (domain?: UiSnapshotDomain) => UiSnapshot | Partial<UiSnapshot>;

export type AppOptions = {
  state?: Partial<AppRuntimeState> & Record<string, unknown>;
  snapshot?: UiSnapshot;
  buildSnapshot?: BuildSnapshot;
  snapshotOptions?: SnapshotOptions;
  cols?: number;
  rows?: number;
  boardActions?: BoardActions;
  todoActions?: TodoActions;
  noteActions?: NoteActions;
  clockActions?: ClockActions;
  syncActions?: SyncActions;
  babelActions?: BabelActions;
  ttsActions?: TtsActions;
  stdin?: TerminalMountOptions["stdin"];
  stdout?: TerminalOutputStream;
};

export type LayoutOptions = {
  cols?: number;
  rows?: number;
  stdout?: TerminalOutputStream;
};

export type RuntimeLayout = {
  cols: number;
  rows: number;
};

export type SessionActions = {
  boardActions?: BoardActions;
  todoActions?: TodoActions;
  noteActions?: NoteActions;
  clockActions?: ClockActions;
  syncActions?: SyncActions;
  babelActions?: BabelActions;
  ttsActions?: TtsActions;
  refreshSnapshot?: RefreshSnapshot;
  requestRender?: () => void;
  syncTerminalTitle?: () => void;
  copyTextToClipboard?: (text: string) => BabelActionResult;
  currentLayout?: () => Partial<RuntimeLayout>;
};

export type HeadlessSession = {
  dispatchKey: (key: string) => string;
  dispatchText: (value: unknown) => string;
  focus: (id: string) => boolean;
  focusedId: () => string | null;
  output: () => string;
  ansiOutput: () => string;
  click: (id: string) => string;
  clickAt: (x: number, y: number) => string;
  clipboard: () => string;
  state: () => AppRuntimeState;
  destroy: () => void | Promise<void>;
};

export const TABS = Object.freeze(["Todo", "Notes", "Board", "Clocks", "Sync", "Translate", "Speech"] as const);
export const HELP_LINES_BY_TAB: Readonly<Record<Tab, readonly string[]>> = Object.freeze({
  Todo: Object.freeze([
    "Use ↑/↓ to choose a task. Use Enter/Space to toggle it.",
    "Use Shift+↑/↓ to reorder.",
    "Use Actions to manage tasks."
  ]),
  Notes: Object.freeze([
    "Use ↑/↓ to choose a note. Use Enter to open it.",
    "Use Shift+↑/↓ to reorder.",
    "Use Actions to manage notes."
  ]),
  Board: Object.freeze([
    "Use ↑/↓ to choose a card. Use Enter/Space to select it.",
    "Use O to open card or column details.",
    "Use ←/→ to move cards or columns.",
    "Use Shift+↑/↓ to change priority.",
    "Use Actions to add cards, columns, or boards."
  ]),
  Clocks: Object.freeze([
    "Use ↑/↓ to choose a clock.",
    "Use Actions to manage clocks."
  ]),
  Sync: Object.freeze([
    "Use Actions to manage sync.",
    "Setup asks for the remote, branch, and confirmation."
  ]),
  Translate: Object.freeze([
    "Write the text, source, and target.",
    "Use Actions to translate.",
    "Use Actions to copy the result."
  ]),
  Speech: Object.freeze([
    "Set the input, output, and voice.",
    "Use Actions to convert text.",
    "Use Actions to choose a voice."
  ])
});
export const DEFAULT_STATE: Omit<AppRuntimeState, "board" | "utilities" | "todo" | "notesState" | "clocksState"> = Object.freeze({
  activeTab: "Todo",
  overlay: null,
  running: true,
  syncStatus: "idle"
});

export function isTab(value: unknown): value is Tab {
  return typeof value === "string" && (TABS as readonly string[]).includes(value);
}

export function normalizeTab(tab: unknown): Tab {
  return isTab(tab) ? tab : DEFAULT_STATE.activeTab;
}

export function terminalTitleForTab(tab: Tab): string {
  return `Ilu - ${tab}`;
}

export function syncTerminalTitle(session: TerminalSession | null, state: AppRuntimeState): void {
  if (!session || typeof session.setTitle !== "function") {
    return;
  }

  session.setTitle(terminalTitleForTab(state.activeTab));
}

export function isSyncStatusState(value: unknown): value is SyncStatusState {
  return typeof value === "string" && ["idle", "syncing", "pending", "synced", "failed", "setup"].includes(value);
}

export function normalizeSyncStatus(value: unknown): SyncStatusState {
  return isSyncStatusState(value) ? value : "idle";
}

export function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function resolveRuntimeLayout(options: LayoutOptions = {}): RuntimeLayout {
  const stdout = options.stdout || process.stdout;
  const rows = positiveInteger(options.rows) ? options.rows : stdout && positiveInteger(stdout.rows) ? stdout.rows : undefined;
  const cols = positiveInteger(options.cols) ? options.cols : stdout && positiveInteger(stdout.columns) ? stdout.columns : 80;

  return { cols, rows: positiveInteger(rows) ? rows : 24 };
}
