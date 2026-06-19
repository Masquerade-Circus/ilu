import { Text } from "@valyrianjs/terminal";
import type {
  TerminalCommand,
  TerminalCommandContext,
  TerminalElementNode,
  TerminalKeyBinding,
  TerminalKeymapOptions,
  TerminalMountOptions,
  TerminalNode,
  TerminalOutputStream,
  TerminalSession,
  TerminalTheme
} from "@valyrianjs/terminal";
import type { AppState, BabelActionResult, BabelActions, BoardActions, ClockActions, NoteActions, RefreshSnapshot, SyncActions, SyncStatusState, TodoActions, TtsActions, UiSnapshot, UiSnapshotDomain } from "./types";

type TerminalRuntimeModule = typeof import("@valyrianjs/terminal");
type ValyrianRuntime = { v: (tag: unknown, props?: Record<string, unknown>, ...children: unknown[]) => JSX.Element };
type Runtime = { terminal: TerminalRuntimeModule; valyrian: ValyrianRuntime };
type SyncStatusEvent = { state?: unknown; message?: unknown; context?: unknown };
type TuiSyncRunnerClient = { notifyLocalMutation: (context?: unknown) => Promise<unknown>; flush?: () => Promise<unknown>; shutdown?: () => Promise<unknown>; dispose?: () => void; hasPendingWork?: () => boolean; onEvent?: (listener: (event: SyncStatusEvent) => void) => () => void };
type NotifySyncHook = ((context?: unknown) => void) & { onSyncStatus?: (listener: (event: SyncStatusEvent) => void) => () => void; flushPending?: () => boolean | Promise<boolean>; configureSyncRunner?: (runner: TuiSyncRunnerClient | null) => () => void };
type Tab = "Todo" | "Notes" | "Board" | "Clocks" | "Sync" | "Translate" | "Speech";
type AppRuntimeState = AppState & {
  activeTab: Tab;
  overlay: string | null;
  running: boolean;
  syncStatus: SyncStatusState;
};

type SnapshotRef = {
  current: UiSnapshot;
  refresh: (domain?: UiSnapshotDomain) => UiSnapshot;
};

type SnapshotOptions = Record<string, unknown>;
type BuildSnapshot = (domain?: UiSnapshotDomain) => UiSnapshot | Partial<UiSnapshot>;

type AppOptions = {
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

type LayoutOptions = {
  cols?: number;
  rows?: number;
  stdout?: TerminalOutputStream;
};

type RuntimeLayout = {
  cols: number;
  rows: number;
};

type SessionActions = {
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

type HeadlessSession = {
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

const terminalImport: Promise<TerminalRuntimeModule> = import("@valyrianjs/terminal");
const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";

const { buildReadSnapshot, buildReadSnapshotDomain }: { buildReadSnapshot: (options?: SnapshotOptions) => UiSnapshot; buildReadSnapshotDomain: (domain?: UiSnapshotDomain, options?: SnapshotOptions) => Partial<UiSnapshot> | null } = require("./read-model");
const { createBoardActions }: { createBoardActions: (options?: Record<string, unknown>) => BoardActions } = require("./board-actions");
const { createTodoActions }: { createTodoActions: (options?: Record<string, unknown>) => TodoActions } = require("./todo-actions");
const { createNoteActions }: { createNoteActions: (options?: Record<string, unknown>) => NoteActions } = require("./note-actions");
const { createClockActions }: { createClockActions: (options?: Record<string, unknown>) => ClockActions } = require("./clock-actions");
const { createSyncActions }: { createSyncActions: (options?: Record<string, unknown>) => SyncActions } = require("./sync-actions");
const { createTuiSyncClient }: { createTuiSyncClient: (options?: Record<string, unknown>) => TuiSyncRunnerClient } = require("../sync/tui-sync-client");
const { createBabelActions }: { createBabelActions: (options?: Record<string, unknown>) => BabelActions } = require("./babel-actions");
const { createTtsActions }: { createTtsActions: (options?: Record<string, unknown>) => TtsActions } = require("./tts-actions");
const notifySyncHook: NotifySyncHook = require("../sync/ilu-hooks");
const { createAppShell }: typeof import("./components/AppShell") = require("./components/AppShell.tsx");
const { FOOTER_STYLE, footerLine, footerSegments }: typeof import("./components/Footer") = require("./components/Footer.tsx");
const { createButton }: typeof import("./components/Button") = require("./components/Button.tsx");
const { AppOverlay }: typeof import("./components/Overlay") = require("./components/Overlay.tsx");
const { createTopNav }: typeof import("./components/TopNav") = require("./components/TopNav.tsx");
const {
  closeUtilityOverlay,
  createInitialUtilityState,
  createSyncActionBar,
  createTranslateActionBar,
  createTtsActionBar,
  createUtilityOverlay,
  createUtilityPanel,
  prepareUtilityApp
}: typeof import("./components/UtilityHost") = require("./components/UtilityHost.tsx");
const { PANEL_STYLE, TERMINAL_THEME }: typeof import("./theme") = require("./theme.ts");
const {
  clearBoardUiOverlay,
  createBoardKeyBindings,
  createBoardMainView,
  createInitialBoardState,
  getBoardPendingFocus,
  handleBoardCommand,
  openBoardAddCardModal
}: typeof import("./pages/board/MainView") = require("./pages/board/MainView.tsx");
const {
  createClocksMainView,
  createInitialClockState,
  handleClockCommand,
  renderClockNodes,
  prepareClockViewState
}: typeof import("./pages/clocks/MainView") = require("./pages/clocks/MainView.tsx");
const {
  createInitialNotesState,
  createNotesKeyBindings,
  createNotesMainView,
  handleNotesCommand,
  renderNotesNodes,
  prepareNotesViewState
}: typeof import("./pages/notes/MainView") = require("./pages/notes/MainView.tsx");
const {
  createInitialTodoState,
  createTodoKeyBindings,
  createTodoMainView,
  handleTodoCommand,
  renderTodoNodes,
  prepareTodoViewState
}: typeof import("./pages/todos/MainView") = require("./pages/todos/MainView.tsx");

const TABS = Object.freeze(["Todo", "Notes", "Board", "Clocks", "Sync", "Translate", "Speech"] as const);
const HELP_LINES_BY_TAB: Readonly<Record<Tab, readonly string[]>> = Object.freeze({
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
const DEFAULT_STATE: Omit<AppRuntimeState, "board" | "utilities" | "todo" | "notesState" | "clocksState"> = Object.freeze({
  activeTab: "Todo",
  overlay: null,
  running: true,
  syncStatus: "idle"
});

function isTab(value: unknown): value is Tab {
  return typeof value === "string" && (TABS as readonly string[]).includes(value);
}

async function loadTerminalRuntime(): Promise<Runtime> {
  const terminal = await terminalImport;
  const valyrian = require("valyrian.js");

  return { terminal, valyrian };
}

function createTerminalTheme(terminal: TerminalRuntimeModule): TerminalTheme {
  return terminal.mergeTerminalTheme(TERMINAL_THEME);
}

function normalizeTab(tab: unknown): Tab {
  return isTab(tab) ? tab : DEFAULT_STATE.activeTab;
}

function terminalTitleForTab(tab: Tab): string {
  return `Ilu - ${tab}`;
}

function syncTerminalTitle(session: TerminalSession | null, state: AppRuntimeState): void {
  if (!session || typeof session.setTitle !== "function") {
    return;
  }

  session.setTitle(terminalTitleForTab(state.activeTab));
}

function isSyncStatusState(value: unknown): value is SyncStatusState {
  return typeof value === "string" && ["idle", "syncing", "pending", "synced", "failed", "setup"].includes(value);
}

function normalizeSyncStatus(value: unknown): SyncStatusState {
  return isSyncStatusState(value) ? value : "idle";
}

const overlayFocusSignatures = new WeakMap<AppRuntimeState, string>();
const trackedFocusIds = new WeakMap<AppRuntimeState, string>();

function closeAllOverlays(state: AppRuntimeState): void {
  state.overlay = null;
  state.todo.overlay = null;
  state.todo.actionError = "";
  state.notesState.overlay = null;
  state.notesState.actionError = "";
  state.clocksState.overlay = null;
  state.clocksState.actionError = "";
  state.clocksState.addClock.error = "";
  clearBoardUiOverlay(state.board);
  state.utilities.activeOverlay = null;
  state.utilities.sync.error = "";
  state.utilities.sync.initForm.error = "";
  state.utilities.babel.error = "";
  state.utilities.babel.message = "";
  state.utilities.tts.error = "";
  state.utilities.tts.message = "";
}

function overlayFocusSignature(state: AppRuntimeState): string {
  return [
    state.activeTab,
    state.overlay || "",
    state.todo.overlay || "",
    state.notesState.overlay || "",
    state.clocksState.overlay || "",
    state.board.overlay || "",
    state.utilities.activeOverlay || ""
  ].join("|");
}

function utilityInitialFocusId(state: AppRuntimeState): string | null {
  if (state.utilities.activeOverlay === "sync-init") {
    return "sync-init-remote";
  }

  if (state.utilities.activeOverlay === "tts-voice") {
    return "tts-voice-list";
  }

  if (state.activeTab === "Sync") {
    return "sync-retry";
  }

  if (state.activeTab === "Translate") {
    return "translate-text";
  }

  if (state.activeTab === "Speech") {
    return "tts-input-file";
  }

  return null;
}

function overlayInitialFocusId(state: AppRuntimeState): string | null {
  if (state.overlay === "help") {
    return "help-close";
  }

  if (state.activeTab === "Todo") {
    const overlay = state.todo.overlay;

    if (overlay === "add-task") return "todo-add-title";
    if (overlay === "edit-task") return "todo-edit-title";
    if (overlay === "task-details") return "todo-details-scroll";
    if (overlay === "remove-task-confirm") return "todo-remove-confirm";
    if (overlay === "manage-lists") return "todo-lists";
    if (overlay === "add-list") return "todo-add-list-title";
    if (overlay === "rename-list") return "todo-rename-list-title";
    if (overlay === "remove-list-confirm") return "todo-remove-list-confirm";
  }

  if (state.activeTab === "Notes") {
    const overlay = state.notesState.overlay;

    if (overlay === "add-note") return "note-add-title";
    if (overlay === "edit-note") return "note-edit-title";
    if (overlay === "note-details") return "note-details-scroll";
    if (overlay === "remove-note-confirm") return "note-remove-confirm";
    if (overlay === "manage-lists") return "note-lists";
    if (overlay === "add-list") return "note-add-list-title";
    if (overlay === "rename-list") return "note-rename-list-title";
    if (overlay === "remove-list-confirm") return "note-remove-list-confirm";
  }

  if (state.activeTab === "Clocks") {
    const overlay = state.clocksState.overlay;

    if (overlay === "add-clock") return "clock-add-name";
    if (overlay === "remove-clock-confirm") return "clock-remove-confirm";
  }

  return utilityInitialFocusId(state);
}

function applySyncStatus(state: AppRuntimeState, event: SyncStatusEvent): boolean {
  const nextStatus = normalizeSyncStatus(event.state);

  if (state.syncStatus === nextStatus) {
    return false;
  }

  state.syncStatus = nextStatus;
  return true;
}

function subscribeToSyncStatus(state: AppRuntimeState, getSession: () => TerminalSession | null): () => void {
  if (typeof notifySyncHook.onSyncStatus !== "function") {
    return () => {};
  }

  return notifySyncHook.onSyncStatus((event: SyncStatusEvent) => {
    const changed = applySyncStatus(state, event);
    const session = getSession();

    if (changed && session && typeof session.update === "function") {
      session.update();
    }
  });
}

function flushPendingSync(): false | Promise<unknown> {
  if (typeof notifySyncHook.flushPending !== "function") {
    return false;
  }

  try {
    const result = notifySyncHook.flushPending();

    if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
      return Promise.resolve(result).catch(() => false);
    }
  } catch (_) {
    return false;
  }

  return false;
}

function enableSyncStatusUpdates(session: TerminalSession, state: AppRuntimeState, cleanupSyncRunner?: () => void | Promise<unknown>): TerminalSession {
  let destroyRequested = false;
  let unsubscribed = false;
  const unsubscribe = subscribeToSyncStatus(state, () => session);
  const destroySession = session.destroy.bind(session);

  function unsubscribeStatus(): void {
    if (!unsubscribed) {
      unsubscribed = true;
      unsubscribe();
    }
  }

  function finishDestroy(): void | Promise<void> {
    if (typeof cleanupSyncRunner !== "function") {
      unsubscribeStatus();
      destroySession();
      return;
    }

    let cleanupResult: void | Promise<unknown>;

    try {
      cleanupResult = cleanupSyncRunner();
    } catch (_) {
      cleanupResult = undefined;
    }

    if (cleanupResult && typeof cleanupResult === "object" && "then" in cleanupResult && typeof cleanupResult.then === "function") {
      return Promise.resolve(cleanupResult)
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          unsubscribeStatus();
          destroySession();
        });
    }

    unsubscribeStatus();
    destroySession();
  }

  session.destroy = () => {
    if (destroyRequested) {
      return;
    }

    destroyRequested = true;
    const pendingFlush = flushPendingSync();

    if (pendingFlush && typeof pendingFlush.then === "function") {
      return pendingFlush.finally(finishDestroy);
    }

    return finishDestroy();
  };

  return session;
}

function shouldUseTuiSyncRunner(): boolean {
  try {
    const syncIndex = require("../sync");
    const config = syncIndex && typeof syncIndex.getSyncConfig === "function" ? syncIndex.getSyncConfig() : null;
    return Boolean(
      config
        && config.enabled === true
        && config.autoSync !== false
        && typeof config.remoteUrl === "string"
        && config.remoteUrl.trim().length > 0
    );
  } catch (_) {
    return false;
  }
}

function createTuiSyncRunnerCleanup(): () => void | Promise<unknown> {
  if (typeof notifySyncHook.configureSyncRunner !== "function" || !shouldUseTuiSyncRunner()) {
    return () => {};
  }

  const client = createTuiSyncClient();
  const restoreRunner = notifySyncHook.configureSyncRunner(client);

  return () => {
    restoreRunner();

    if (typeof client.shutdown === "function") {
      return client.shutdown().catch(() => {
        if (typeof client.dispose === "function") {
          client.dispose();
        }
      });
    }

    if (typeof client.dispose === "function") {
      client.dispose();
    }
  };
}

function enableClockFooterTicker(session: TerminalSession, snapshotRef: SnapshotRef): TerminalSession {
  const destroySession = session.destroy.bind(session);
  let destroyed = false;
  const interval = setInterval(() => {
    if (destroyed) {
      return;
    }

    snapshotRef.refresh("clocks");
    session.update();
  }, 1000);

  session.destroy = () => {
    if (destroyed) {
      return;
    }

    destroyed = true;
    clearInterval(interval);
    return destroySession();
  };

  return session;
}

function createInitialState(overrides: Partial<AppRuntimeState> & Record<string, unknown> = {}): AppRuntimeState {
  const source = typeof overrides === "object" && overrides !== null ? overrides as Record<string, unknown> : {};
  const boardSource = typeof source.board === "object" && source.board !== null ? source.board as Record<string, unknown> : source;
  const next: AppRuntimeState = {
    ...DEFAULT_STATE,
    todo: createInitialTodoState(typeof source.todo === "object" && source.todo !== null ? source.todo as Record<string, unknown> : source),
    notesState: createInitialNotesState(typeof source.notesState === "object" && source.notesState !== null ? source.notesState as Record<string, unknown> : source),
    board: createInitialBoardState(boardSource),
    clocksState: createInitialClockState(typeof source.clocksState === "object" && source.clocksState !== null ? source.clocksState as Record<string, unknown> : source),
    utilities: createInitialUtilityState(typeof source.utilities === "object" && source.utilities !== null ? source.utilities as Record<string, unknown> : source)
  };

  next.activeTab = normalizeTab(source.activeTab);
  next.overlay = source.overlay === "help" ? "help" : null;
  next.running = source.running !== false;
  next.syncStatus = normalizeSyncStatus(source.syncStatus);
  return next;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function resolveLayoutOptions(options: LayoutOptions = {}): RuntimeLayout {
  const stdout = options.stdout || process.stdout;
  const rows = positiveInteger(options.rows) ? options.rows : stdout && positiveInteger(stdout.rows) ? stdout.rows : undefined;
  const cols = positiveInteger(options.cols) ? options.cols : stdout && positiveInteger(stdout.columns) ? stdout.columns : 80;

  return { cols, rows: positiveInteger(rows) ? rows : 24 };
}

function createApp(
  runtime: Runtime,
  state: AppRuntimeState = createInitialState(),
  snapshotRef: SnapshotRef = createSnapshotRef(),
  layout: Partial<RuntimeLayout> = {},
  actions: SessionActions = {}
): JSX.Element {
  const { v } = runtime.valyrian;
  const boardActions: BoardActions = actions.boardActions || createBoardActions();
  const todoActions: TodoActions = actions.todoActions || createTodoActions();
  const noteActions: NoteActions = actions.noteActions || createNoteActions();
  const clockActions: ClockActions = actions.clockActions || createClockActions();
  const syncActions: SyncActions = actions.syncActions || createSyncActions();
  const babelActions: BabelActions = actions.babelActions || createBabelActions();
  const ttsActions: TtsActions = actions.ttsActions || createTtsActions();
  const refreshSnapshot = typeof actions.refreshSnapshot === "function" ? actions.refreshSnapshot : () => {};
  const requestRender = typeof actions.requestRender === "function" ? actions.requestRender : () => {};
  const syncActiveTerminalTitle = typeof actions.syncTerminalTitle === "function" ? actions.syncTerminalTitle : () => {};

  function currentLayout(): RuntimeLayout {
    const liveLayout = typeof actions.currentLayout === "function" ? actions.currentLayout() : null;
    const cols = liveLayout && positiveInteger(liveLayout.cols) ? liveLayout.cols : layout.cols;
    const rows = liveLayout && positiveInteger(liveLayout.rows) ? liveLayout.rows : layout.rows;

    return {
      cols: positiveInteger(cols) ? cols : 80,
      rows: positiveInteger(rows) ? rows : 24
    };
  }

  function currentWidth(): number {
    return currentLayout().cols;
  }

  function currentRows(): number {
    return currentLayout().rows;
  }

  function currentSnapshot(): UiSnapshot {
    return snapshotRef.current;
  }

  function selectTab(tab: string): void {
    closeAllOverlays(state);
    state.board.pendingFocus = tab === "Board" ? getBoardPendingFocus(state.board) : null;
    prepareUtilityApp(state.utilities, tab, syncActions, ttsActions, requestRender);
    syncActiveTerminalTitle();
  }

  function helpOverlay(): JSX.Element | null {
    if (state.overlay !== "help") {
      return null;
    }
    const helpLines = HELP_LINES_BY_TAB[state.activeTab] || [];

    return (
      <AppOverlay
        title={<Text>{`${state.activeTab} help`}</Text>}
        content={[
          <Text>Tab moves focus.</Text>,
          <Text>Enter activates.</Text>,
          ...helpLines.map((line) => <Text>{line}</Text>),
          <Text>Esc closes Help.</Text>
        ]}
        bottomNav={createButton("help-close", "Close", () => { state.overlay = null; })}
      />
    );
  }

  function App(): JSX.Element {
    const snapshot = currentSnapshot();
    const utilityActions: JSX.Element[] = [];
    let activePanelNodes: JSX.Element[];
    let actionBar: JSX.Element | null = null;
    let activePageOverlays: Array<JSX.Element | null> = [];

    if (state.activeTab === "Todo") {
      const todoView = createTodoMainView({
        panel: snapshot.todo,
        state: state.todo,
        isActive: true,
        todoActions,
        refreshSnapshot,
        utilityActions
      });
      activePanelNodes = todoView.activePanelNodes;
      actionBar = todoView.actionBar;
      activePageOverlays = todoView.overlays;
    } else if (state.activeTab === "Notes") {
      const notesView = createNotesMainView({
        panel: snapshot.notes,
        state: state.notesState,
        isActive: true,
        noteActions,
        refreshSnapshot,
        utilityActions
      });
      activePanelNodes = notesView.activePanelNodes;
      actionBar = notesView.actionBar;
      activePageOverlays = notesView.overlays;
    } else if (state.activeTab === "Clocks") {
      const clocksView = createClocksMainView({
        clocks: snapshot.clocks,
        state: state.clocksState,
        isActive: true,
        clockActions,
        refreshSnapshot,
        utilityActions
      });
      activePanelNodes = clocksView.activePanelNodes;
      actionBar = clocksView.actionBar;
      activePageOverlays = clocksView.overlays;
    } else if (state.activeTab === "Board") {
      const boardView = createBoardMainView({
        board: snapshot.board,
        state: state.board,
        isActive: true,
        width: currentWidth(),
        boardActions,
        refreshSnapshot,
        utilityActions
      });
      activePanelNodes = boardView.activePanelNodes;
      actionBar = boardView.actionBar;
      activePageOverlays = boardView.overlays;
    } else {
      activePanelNodes = createUtilityPanel(state.activeTab, state.utilities, syncActions, babelActions, ttsActions, requestRender);

      if (state.activeTab === "Sync") {
        actionBar = createSyncActionBar(state.utilities, syncActions, requestRender);
      } else if (state.activeTab === "Translate") {
        actionBar = createTranslateActionBar(state.utilities, babelActions, (text: string) => {
          if (typeof actions.copyTextToClipboard === "function") {
            return actions.copyTextToClipboard(text);
          }

          return { ok: false, error: "Could not copy the translation." };
        }, requestRender);
      } else if (state.activeTab === "Speech") {
        actionBar = createTtsActionBar(state.utilities, ttsActions, requestRender);
      }
    }
    const activeUtilityOverlay = state.activeTab === "Sync" || state.activeTab === "Translate" || state.activeTab === "Speech"
      ? createUtilityOverlay(state.utilities, syncActions, babelActions, ttsActions, { width: currentWidth(), rows: currentRows() }, requestRender)
      : null;

    return createAppShell({
      activePanelNodes,
      actionBar,
      children: [activeUtilityOverlay, ...activePageOverlays, helpOverlay()],
      footerStyle: FOOTER_STYLE,
      footerText: footerLine(currentWidth(), snapshot, state.activeTab, state.syncStatus),
      footerSegments: footerSegments(currentWidth(), snapshot, state.activeTab, state.syncStatus),
      panelStyle: PANEL_STYLE,
      topNav: createTopNav(state, TABS, { onSelect: selectTab, width: currentWidth() }),
      width: currentWidth()
    });
  }

  return v(App);
}

function handleCommand(command: TerminalCommand, state: AppRuntimeState): boolean {
  if (command.id === "ilu.add") {
    return true;
  }

  if (command.id === "ilu.board") {
    closeAllOverlays(state);
    state.activeTab = "Board";
    state.board.pendingFocus = getBoardPendingFocus(state.board);
    return true;
  }

  if (command.id === "ilu.tab") {
    closeAllOverlays(state);
    state.activeTab = normalizeTab(command.text);
    state.board.pendingFocus = state.activeTab === "Board" ? getBoardPendingFocus(state.board) : null;
    state.utilities.activeOverlay = null;
    return true;
  }

  if (command.id === "ilu.help") {
    state.overlay = state.overlay === "help" ? null : "help";
    return true;
  }

  if (command.id === "ilu.escape") {
    if (state.overlay === "help") {
      state.overlay = null;
      return true;
    }

    if (closeUtilityOverlay(state.utilities)) {
      return true;
    }

    return true;
  }

  if (command.id === "ilu.cancel") {
    if (state.overlay === "help") {
      state.running = false;
      return true;
    }

    if (closeUtilityOverlay(state.utilities)) {
      return true;
    }

    state.running = false;
    return true;
  }

  return false;
}

function createKeymap(
  state: AppRuntimeState,
  afterCommand?: (command: TerminalCommand, state: AppRuntimeState) => void,
  handleLocalCommand?: (command: TerminalCommand, context: TerminalCommandContext) => boolean
): TerminalKeymapOptions {
  const bindings: TerminalKeyBinding[] = [
    ...createTodoKeyBindings(),
    ...createNotesKeyBindings(),
    ...createBoardKeyBindings(),
    { key: "CTRL_1", command: { id: "ilu.tab", text: "Todo" }, scope: "global" },
    { key: "CTRL_2", command: { id: "ilu.tab", text: "Notes" }, scope: "global" },
    { key: "CTRL_3", command: { id: "ilu.tab", text: "Board" }, scope: "global" },
    { key: "CTRL_4", command: { id: "ilu.tab", text: "Clocks" }, scope: "global" },
    { key: "CTRL_5", command: { id: "ilu.tab", text: "Sync" }, scope: "global" },
    { key: "CTRL_6", command: { id: "ilu.tab", text: "Translate" }, scope: "global" },
    { key: "CTRL_7", command: { id: "ilu.tab", text: "Speech" }, scope: "global" },
    { key: "CTRL_K", command: { id: "ilu.help" }, scope: "global" },
    { key: "ESCAPE", command: { id: "ilu.escape" }, scope: "global" },
    { key: "CTRL_C", command: { id: "ilu.cancel" }, scope: "global" }
  ];

  return {
    bindings,
    onCommand(command: TerminalCommand, context: TerminalCommandContext) {
      const handled = typeof handleLocalCommand === "function" && handleLocalCommand(command, context) ? true : handleCommand(command, state);

      if (handled && typeof afterCommand === "function") {
        afterCommand(command, state);
      }

      return handled;
    }
  };
}

function createSnapshotRef(options: AppOptions = {}): SnapshotRef {
  if (options.snapshot) {
    return {
      current: options.snapshot,
      refresh() {
        return options.snapshot!;
      }
    };
  }

  const hasCustomBuildSnapshot = typeof options.buildSnapshot === "function";
  const buildSnapshot: BuildSnapshot = hasCustomBuildSnapshot
    ? options.buildSnapshot!
    : () => buildReadSnapshot(options.snapshotOptions);
  const ref = {
    current: (hasCustomBuildSnapshot ? buildSnapshot() : buildReadSnapshot(options.snapshotOptions)) as UiSnapshot,
    refresh(domain?: UiSnapshotDomain) {
      if (domain === "todo" || domain === "notes" || domain === "board" || domain === "clocks") {
        const nextDomainSnapshot = hasCustomBuildSnapshot
          ? buildSnapshot(domain)
          : buildReadSnapshotDomain(domain, options.snapshotOptions);

        if (nextDomainSnapshot !== null && typeof nextDomainSnapshot === "object" && domain in nextDomainSnapshot) {
          ref.current = { ...ref.current, [domain]: nextDomainSnapshot[domain] } as UiSnapshot;
          return ref.current;
        }
      }

      ref.current = buildSnapshot() as UiSnapshot;
      return ref.current;
    }
  };

  return ref;
}

function applyPendingFocus(session: TerminalSession | null, state: AppRuntimeState): boolean {
  const explicitPendingFocus = state.activeTab === "Board" ? state.board.pendingFocus : null;

  if (!session || typeof session.focus !== "function") {
    return false;
  }

  if (explicitPendingFocus) {
    const focused = session.focus(explicitPendingFocus);

    if (focused) {
      state.board.pendingFocus = null;
      overlayFocusSignatures.set(state, overlayFocusSignature(state));
      trackedFocusIds.set(state, explicitPendingFocus);
      session.update();
    }

    return focused;
  }

  const signature = overlayFocusSignature(state);

  if (overlayFocusSignatures.get(state) === signature) {
    return false;
  }

  const initialFocusId = overlayInitialFocusId(state);

  if (!initialFocusId) {
    overlayFocusSignatures.set(state, signature);
    return false;
  }

  const focused = session.focus(initialFocusId);

  if (focused) {
    overlayFocusSignatures.set(state, signature);
    trackedFocusIds.set(state, initialFocusId);
    session.update();
  }

  return focused;
}

function isTerminalElementNode(node: TerminalNode): node is TerminalElementNode {
  return node.type === "element";
}

function findFocusedNode(nodes: TerminalNode[]): TerminalElementNode | null {
  for (const node of nodes) {
    if (!isTerminalElementNode(node)) {
      continue;
    }

    if (node.props.__focused) {
      return node;
    }

    const child = findFocusedNode(node.children);

    if (child) {
      return child;
    }
  }

  return null;
}

function findNodeById(nodes: TerminalNode[], id: string | null | undefined): TerminalElementNode | null {
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }

  for (const node of nodes) {
    if (!isTerminalElementNode(node)) {
      continue;
    }

    if (node.props.id === id) {
      return node;
    }

    const child = findNodeById(node.children, id);

    if (child) {
      return child;
    }
  }

  return null;
}

function isFocusedTextEntry(node: TerminalElementNode | null): boolean {
  return node?.tag === "terminal-input" || node?.tag === "terminal-editor";
}

function normalizeHeadlessPasteText(value: string): string {
  let output = "";
  let cursor = 0;

  while (cursor < value.length) {
    const start = value.indexOf(BRACKETED_PASTE_START, cursor);

    if (start < 0) {
      output += value.slice(cursor);
      break;
    }

    if (start === cursor && value.indexOf(BRACKETED_PASTE_END, start + BRACKETED_PASTE_START.length) < 0) {
      break;
    }

    output += value.slice(cursor, start);
    const textStart = start + BRACKETED_PASTE_START.length;
    const end = value.indexOf(BRACKETED_PASTE_END, textStart);

    if (end < 0) {
      break;
    }

    output += value.slice(textStart, end).replace(/\r\n?/g, "\n");
    cursor = end + BRACKETED_PASTE_END.length;
  }

  return output;
}

function pasteTextIntoFocusedEntry(session: TerminalSession, text: string): string {
  const previousClipboard = session.clipboard();

  session.setClipboard(text);
  const output = session.dispatchKey("CTRL_V");
  session.setClipboard(previousClipboard);
  return output;
}

function copyTextWithSessionClipboard(session: TerminalSession | null, text: string): BabelActionResult {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, error: "Could not copy the translation." };
  }

  if (!session || typeof session.setClipboard !== "function") {
    return { ok: false, error: "Could not copy the translation." };
  }

  session.setClipboard(text);
  return { ok: true, message: "Copied." };
}


function prepareActivePageState(state: AppRuntimeState, snapshot: UiSnapshot): void {
  if (state.activeTab === "Todo") {
    prepareTodoViewState(snapshot.todo, state.todo);
    return;
  }

  if (state.activeTab === "Notes") {
    prepareNotesViewState(snapshot.notes, state.notesState);
    return;
  }

  if (state.activeTab === "Clocks") {
    prepareClockViewState(snapshot.clocks, state.clocksState);
  }
}

function prepareActiveUtilityApp(state: AppRuntimeState, actions: SessionActions, requestRender?: () => void): void {
  const syncActions = actions.syncActions || createSyncActions();
  const ttsActions = actions.ttsActions || createTtsActions();
  prepareUtilityApp(state.utilities, state.activeTab, syncActions, ttsActions, requestRender);
}

function shouldPrepareUtilityAfterCommand(command: TerminalCommand, state: AppRuntimeState): boolean {
  if ((command.id === "ilu.help" || command.id === "ilu.escape") && state.utilities.activeOverlay !== null) {
    return false;
  }

  return true;
}

function createSessionActions(options: AppOptions, snapshotRef: SnapshotRef, requestRender?: () => void): SessionActions {
  return {
    boardActions: options.boardActions || createBoardActions(),
    todoActions: options.todoActions || createTodoActions(),
    noteActions: options.noteActions || createNoteActions(),
    clockActions: options.clockActions || createClockActions(),
    syncActions: options.syncActions || createSyncActions(),
    babelActions: options.babelActions || createBabelActions(),
    ttsActions: options.ttsActions || createTtsActions(),
    refreshSnapshot: (domain?: UiSnapshotDomain) => snapshotRef.refresh(domain),
    requestRender
  };
}

async function renderSmoke(options: AppOptions = {}): Promise<string> {
  const runtime = await loadTerminalRuntime();
  const state = createInitialState(options.state);
  const snapshotRef = createSnapshotRef(options);
  const cols = options.cols || 80;
  const rows = options.rows || 24;
  const layout = resolveLayoutOptions({ cols, rows });
  const sessionActions = createSessionActions(options, snapshotRef);
  prepareActivePageState(state, snapshotRef.current);
  prepareActiveUtilityApp(state, sessionActions);
  const app = createApp(runtime, state, snapshotRef, layout, sessionActions);
  const session = runtime.terminal.mountTerminal(app, { runtime: "headless", cols, rows, theme: createTerminalTheme(runtime.terminal) });
  const output = session.output();
  session.destroy();

  return output;
}

async function createHeadlessSession(options: AppOptions = {}): Promise<HeadlessSession> {
  const runtime = await loadTerminalRuntime();
  const state = createInitialState(options.state);
  let session: TerminalSession | null = null;
  const snapshotRef = createSnapshotRef(options);
  const requestRender = () => {
    if (session) {
      session.update();
      applyPendingFocus(session, state);
    }
  };
  const sessionActions = createSessionActions(options, snapshotRef, requestRender);
  prepareActivePageState(state, snapshotRef.current);
  prepareActiveUtilityApp(state, sessionActions, requestRender);
  const layout = resolveLayoutOptions({ cols: options.cols || 80, rows: options.rows || 24 });
  sessionActions.currentLayout = () => session?.size() || layout;
  const app = createApp(runtime, state, snapshotRef, layout, sessionActions);
  const keymap = createKeymap(state, (command) => {
    if (state.running === false) {
      if (session) {
        session.destroy();
      }

      return;
    }

    prepareActivePageState(state, snapshotRef.current);

    if (shouldPrepareUtilityAfterCommand(command, state)) {
      prepareActiveUtilityApp(state, sessionActions, requestRender);
    }

    if (session) {
      applyPendingFocus(session, state);
    }
  }, (command, context) => {
    if (handleTodoCommand(command, state.todo, state.activeTab === "Todo", context, sessionActions.todoActions, snapshotRef.current.todo, sessionActions.refreshSnapshot)) {
      return true;
    }

    if (handleNotesCommand(command, state.notesState, state.activeTab === "Notes", context, snapshotRef.current.notes, sessionActions.noteActions, sessionActions.refreshSnapshot)) {
      return true;
    }

    if (handleClockCommand(command, state.clocksState, state.activeTab === "Clocks", context)) {
      return true;
    }

    return handleBoardCommand(command, state.board, snapshotRef, sessionActions.boardActions || createBoardActions(), state.activeTab === "Board", context);
  });

  session = runtime.terminal.mountTerminal(app, {
    runtime: "headless",
    cols: options.cols || 80,
    rows: options.rows || 24,
    keymap,
    theme: createTerminalTheme(runtime.terminal)
  });
  sessionActions.copyTextToClipboard = (text: string) => copyTextWithSessionClipboard(session, text);
  session = enableClockFooterTicker(session, snapshotRef);
  applyPendingFocus(session, state);
  const activeSession = session;

  return {
    dispatchKey(key) {
      const output = activeSession.dispatchKey(key);
      prepareActivePageState(state, snapshotRef.current);
      applyPendingFocus(activeSession, state);
      return output;
    },
    dispatchText(value) {
      const rawText = String(value);
      const text = normalizeHeadlessPasteText(rawText);
      const tree = activeSession.tree();
      const focused = findFocusedNode(tree);
      const trackedFocused = findNodeById(tree, trackedFocusIds.get(state));
      const isBracketedPaste = rawText.startsWith(BRACKETED_PASTE_START);
      const hasFocusedTextEntry = isFocusedTextEntry(focused) || isFocusedTextEntry(trackedFocused);

      if (isBracketedPaste && !hasFocusedTextEntry) {
        return activeSession.output();
      }

      if ((isFocusedTextEntry(focused) || isBracketedPaste) && hasFocusedTextEntry && text.length > 1) {
        const output = pasteTextIntoFocusedEntry(activeSession, text);
        prepareActivePageState(state, snapshotRef.current);
        applyPendingFocus(activeSession, state);
        return output;
      }

      let output = "";
      for (const char of text) {
        output = activeSession.dispatchKey(char);
      }
      prepareActivePageState(state, snapshotRef.current);
      applyPendingFocus(activeSession, state);
      return output;
    },
    focus(id) {
      const focused = activeSession.focus(id);

      if (focused) {
        trackedFocusIds.set(state, id);
      }

      activeSession.update();
      return focused;
    },
    focusedId() {
      const focused = findFocusedNode(activeSession.tree());
      return focused && focused.props ? focused.props.id : trackedFocusIds.get(state) || null;
    },
    output() {
      return activeSession.output();
    },
    ansiOutput() {
      return activeSession.ansiOutput();
    },
    click(id) {
      const output = activeSession.click(id);

      if (output === activeSession.output() && !hasActiveOverlay(state) && handleHeadlessChromeClick(id, state)) {
        activeSession.update();
      }

      prepareActivePageState(state, snapshotRef.current);
      applyPendingFocus(activeSession, state);
      return activeSession.output();
    },
    clickAt(x, y) {
      const output = activeSession.clickAt(x, y);
      prepareActivePageState(state, snapshotRef.current);
      applyPendingFocus(activeSession, state);
      return output;
    },
    clipboard() {
      return activeSession.clipboard();
    },
    state() {
      return { ...state, todo: { ...state.todo }, notesState: { ...state.notesState }, board: { ...state.board }, clocksState: { ...state.clocksState }, utilities: { ...state.utilities, sync: { ...state.utilities.sync, initForm: { ...state.utilities.sync.initForm }, details: [...state.utilities.sync.details] }, babel: { ...state.utilities.babel, dictionaryEntries: [...state.utilities.babel.dictionaryEntries] }, tts: { ...state.utilities.tts, voices: [...state.utilities.tts.voices] } } };
    },
    destroy() {
      return (activeSession.destroy as () => void | Promise<void>)();
    }
  };
}

function hasActiveOverlay(state: AppRuntimeState): boolean {
  return Boolean(
    state.overlay ||
    state.todo.overlay ||
    state.notesState.overlay ||
    state.clocksState.overlay ||
    state.board.overlay ||
    state.utilities.activeOverlay
  );
}

function handleHeadlessChromeClick(id: string, state: AppRuntimeState): boolean {
  const tabMatch = id.match(/^tab-(todo|notes|board|clocks|sync|translate|speech)$/);

  if (tabMatch) {
    const tab = tabMatch[1];
    const tabById: Record<string, Tab> = {
      todo: "Todo",
      notes: "Notes",
      board: "Board",
      clocks: "Clocks",
      sync: "Sync",
      translate: "Translate",
      speech: "Speech"
    };
    const nextTab = tabById[tab];

    if (nextTab) {
      closeAllOverlays(state);
      state.activeTab = nextTab;
      state.board.pendingFocus = nextTab === "Board" ? getBoardPendingFocus(state.board) : null;
      return true;
    }
  }

  if (id === "board-add-card" && state.activeTab === "Board") {
    openBoardAddCardModal(state.board);
    return true;
  }

  return false;
}

async function mountInteractiveSession(options: AppOptions = {}): Promise<TerminalSession> {
  const runtime = await loadTerminalRuntime();
  const state = createInitialState(options.state);
  let session: TerminalSession | null = null;
  const stdout = options.stdout || process.stdout;
  const snapshotRef = createSnapshotRef(options);
  const requestRender = () => {
    if (session) {
      session.update();
      applyPendingFocus(session, state);
    }
  };
  const sessionActions = createSessionActions(options, snapshotRef, requestRender);
  sessionActions.syncTerminalTitle = () => syncTerminalTitle(session, state);
  prepareActivePageState(state, snapshotRef.current);
  prepareActiveUtilityApp(state, sessionActions, requestRender);
  const layout = resolveLayoutOptions({ ...options, stdout });
  sessionActions.currentLayout = () => session?.size() || layout;
  const app = createApp(runtime, state, snapshotRef, layout, sessionActions);
  const keymap = createKeymap(state, (command) => {
    if (state.running === false) {
      if (session) {
        session.destroy();
      }

      return;
    }

    if (shouldPrepareUtilityAfterCommand(command, state)) {
      prepareActiveUtilityApp(state, sessionActions, requestRender);
    }

    if (session) {
      syncTerminalTitle(session, state);
      applyPendingFocus(session, state);
    }
  }, (command, context) => {
    if (handleTodoCommand(command, state.todo, state.activeTab === "Todo", context, sessionActions.todoActions, snapshotRef.current.todo, sessionActions.refreshSnapshot)) {
      return true;
    }

    if (handleNotesCommand(command, state.notesState, state.activeTab === "Notes", context, snapshotRef.current.notes, sessionActions.noteActions, sessionActions.refreshSnapshot)) {
      return true;
    }

    if (handleClockCommand(command, state.clocksState, state.activeTab === "Clocks", context)) {
      return true;
    }

    return handleBoardCommand(command, state.board, snapshotRef, sessionActions.boardActions || createBoardActions(), state.activeTab === "Board", context);
  });

  session = runtime.terminal.mountTerminal(app, {
    keymap,
    stdin: options.stdin || process.stdin,
    stdout,
    cols: layout.cols,
    rows: layout.rows,
    terminalTitle: terminalTitleForTab(state.activeTab),
    theme: createTerminalTheme(runtime.terminal)
  });
  sessionActions.copyTextToClipboard = (text: string) => copyTextWithSessionClipboard(session, text);
  const cleanupSyncRunner = createTuiSyncRunnerCleanup();
  session = enableSyncStatusUpdates(session, state, cleanupSyncRunner);
  session = enableClockFooterTicker(session, snapshotRef);
  applyPendingFocus(session, state);

  return session;
}

async function action(): Promise<void> {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    await mountInteractiveSession();
    return;
  }

  const output = await renderSmoke();
  process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
}

module.exports = {
  action,
  createApp,
  createHeadlessSession,
  createInitialState,
  createKeymap,
  handleCommand,
  loadTerminalRuntime,
  mountInteractiveSession,
  resolveLayoutOptions,
  renderSmoke
};
