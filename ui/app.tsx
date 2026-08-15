import { Text } from "@valyrianjs/terminal";
import type {
  TerminalCommand,
  TerminalCommandContext,
  TerminalSession,
  TerminalTheme
} from "@valyrianjs/terminal";
import type { BabelActionResult, UiSnapshot, UiSnapshotDomain } from "./types";
import type { AppOptions, AppRuntimeState, HeadlessSession, LayoutOptions, NotifySyncHook, Runtime, RuntimeLayout, SessionActions, SnapshotRef, Tab, TerminalRuntimeModule } from "./app-runtime";
import { DEFAULT_STATE, HELP_LINES_BY_TAB, TABS, normalizeSyncStatus, normalizeTab, positiveInteger, resolveRuntimeLayout, syncTerminalTitle, terminalTitleForTab } from "./app-runtime";
import { findFocusedNode, findNodeById, isFocusedTextEntry, pasteTextIntoFocusedEntry } from "./app-headless-tree";
import * as valyrian from "valyrian.js";
import { closeAppOverlays, createKeymap, handleCommand } from "./app-keymap";
import { createSnapshotRef } from "./app-snapshot";
import { createTuiSyncClient } from "../sync/tui-sync-client";
import notifySyncHook from "../sync/ilu-hooks";
import syncIndex from "../sync";
import { onDataRecovery as defaultOnDataRecovery } from '../sync/iludb-recovery';
import { createAppShell } from "./components/AppShell";
import { FOOTER_STYLE, footerLine, footerSegments } from "./components/Footer";
import { createButton } from "./components/Button";
import { AppOverlay } from "./components/Overlay";
import { createTopNav } from "./components/TopNav";
import { PANEL_STYLE, TERMINAL_THEME } from "./theme";
import {
  createActiveModuleView,
  createActiveUtilityOverlay,
  createDefaultModuleActions,
  createInitialRegisteredState,
  handleModuleCommand,
  initialFocusForActiveModule,
  isUtilityTab,
  openRegisteredBoardAddCard,
  pendingFocusForActiveModule,
  prepareActiveModuleState,
  prepareActiveUtilityApp,
  setPendingFocusForTab,
  clearPendingFocusForActiveModule
} from "./module-registry";
import { createAppSyncLifecycle } from "./app-sync";

const { prepareTuiSyncRunner, enableSyncStatusUpdates } = createAppSyncLifecycle({ notifySyncHook: notifySyncHook as NotifySyncHook, createTuiSyncClient, syncIndex });
// Runtime import is intentional: tests and direct render helpers can load the
// terminal package through a different module entry before a headless session
// starts. Keeping the mounted runtime on the async entry prevents split module
// state from dropping button and list press handlers in TTS flows.
const terminalImport: Promise<TerminalRuntimeModule> = import("@valyrianjs/terminal");

async function loadTerminalRuntime(): Promise<Runtime> {
  const terminal = await terminalImport;
  return { terminal, valyrian: valyrian as Runtime["valyrian"] };
}

function createTerminalTheme(terminal: TerminalRuntimeModule): TerminalTheme {
  return terminal.mergeTerminalTheme(TERMINAL_THEME);
}

const overlayFocusSignatures = new WeakMap<AppRuntimeState, string>();
const trackedFocusIds = new WeakMap<AppRuntimeState, string>();

function closeAllOverlays(state: AppRuntimeState): void {
  closeAppOverlays(state);
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

function overlayInitialFocusId(state: AppRuntimeState): string | null {
  if (state.overlay === "help") {
    return "help-close";
  }

  return initialFocusForActiveModule(state);
}

function enableClockFooterTicker(session: TerminalSession, snapshotRef: SnapshotRef): TerminalSession {
  const destroySession = session.destroy.bind(session);
  let destroyed = false;
  const interval = setInterval(() => {
    if (destroyed) {
      return;
    }

    snapshotRef.refresh("clocks");
    session?.update();
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
  const registeredState = createInitialRegisteredState(source);
  const next: AppRuntimeState = {
    ...DEFAULT_STATE,
    ...registeredState
  };

  next.activeTab = normalizeTab(source.activeTab);
  next.overlay = source.overlay === "help" ? "help" : null;
  next.running = source.running !== false;
  next.syncStatus = normalizeSyncStatus(source.syncStatus);
  return next;
}

function resolveLayoutOptions(options: LayoutOptions = {}): RuntimeLayout {
  return resolveRuntimeLayout(options);
}

function createApp(
  runtime: Runtime,
  state: AppRuntimeState = createInitialState(),
  snapshotRef: SnapshotRef = createSnapshotRef(),
  layout: Partial<RuntimeLayout> = {},
  actions: SessionActions = {}
): JSX.Element {
  const { v } = runtime.valyrian;
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
    setPendingFocusForTab(state, normalizeTab(tab));
    prepareActiveUtilityApp(state, actions, requestRender);
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
          ...helpLines.map((line: string) => <Text>{line}</Text>),
          <Text>Esc closes Help.</Text>
        ]}
        bottomNav={createButton("help-close", "Close", () => { state.overlay = null; })}
      />
    );
  }

  function App(): JSX.Element {
    const snapshot = currentSnapshot();
    const utilityActions: JSX.Element[] = [];
    const activeView = createActiveModuleView({ state, snapshot, actions, refreshSnapshot, requestRender, utilityActions, width: currentWidth() });
    const activeUtilityOverlay = isUtilityTab(state.activeTab)
      ? createActiveUtilityOverlay({ state, actions, layout: { width: currentWidth(), rows: currentRows() }, requestRender })
      : null;
    const footerControlMode = activeUtilityOverlay !== null ? "overlay" : "global";

    return createAppShell({
      activePanelNodes: activeView.activePanelNodes,
      actionBar: activeView.actionBar,
      children: [activeUtilityOverlay, ...activeView.overlays, helpOverlay()],
      footerStyle: FOOTER_STYLE,
      footerText: footerLine(currentWidth(), snapshot, state.activeTab, state.syncStatus, footerControlMode),
      footerSegments: footerSegments(currentWidth(), snapshot, state.activeTab, state.syncStatus, footerControlMode),
      panelStyle: PANEL_STYLE,
      topNav: createTopNav(state, TABS, { onSelect: selectTab, width: currentWidth() }),
      width: currentWidth()
    });
  }

  return v(App);
}

function applyPendingFocus(session: TerminalSession | null, state: AppRuntimeState): boolean {
  if (!session || typeof session.focus !== "function") {
    return false;
  }

  const explicitPendingFocus = pendingFocusForActiveModule(state);

  if (explicitPendingFocus) {
    const focused = session.focus(explicitPendingFocus);

    if (focused) {
      clearPendingFocusForActiveModule(state);
      overlayFocusSignatures.set(state, overlayFocusSignature(state));
      trackedFocusIds.set(state, explicitPendingFocus);
      session.update();
      return true;
    }

    return false;
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
    session?.update();
  }

  return focused;
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


function shouldPrepareUtilityAfterCommand(command: TerminalCommand, state: AppRuntimeState): boolean {
  if ((command.id === "ilu.help" || command.id === "ilu.escape") && state.utilities.activeOverlay !== null) {
    return false;
  }

  return true;
}

function createSessionActions(options: AppOptions, snapshotRef: SnapshotRef, requestRender?: () => void): SessionActions {
  return {
    ...createDefaultModuleActions(options),
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
  prepareActiveModuleState(state, snapshotRef.current);
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
  prepareActiveModuleState(state, snapshotRef.current);
  prepareActiveUtilityApp(state, sessionActions, requestRender);
  const layout = resolveLayoutOptions({ cols: options.cols || 80, rows: options.rows || 24 });
  sessionActions.currentLayout = () => session?.size() || layout;
  const app = createApp(runtime, state, snapshotRef, layout, sessionActions);
  const keymap = createKeymap(state, (command: TerminalCommand) => {
    if (state.running === false) {
      if (session) {
        session.destroy();
      }

      return;
    }

    prepareActiveModuleState(state, snapshotRef.current);

    if (shouldPrepareUtilityAfterCommand(command, state)) {
      prepareActiveUtilityApp(state, sessionActions, requestRender);
    }

    if (session) {
      applyPendingFocus(session, state);
    }
  }, (command: TerminalCommand, context: TerminalCommandContext) => {
    return handleModuleCommand(command, state, context, sessionActions, snapshotRef);
  });

  session = runtime.terminal.mountTerminal(app, {
    runtime: "headless",
    cols: options.cols || 80,
    rows: options.rows || 24,
    keymap,
    clipboard: false,
    theme: createTerminalTheme(runtime.terminal)
  });
  sessionActions.copyTextToClipboard = (text: string) => copyTextWithSessionClipboard(session, text);
  session = enableClockFooterTicker(session, snapshotRef);
  applyPendingFocus(session, state);
  const activeSession = session;

  return {
    dispatchKey(key: string) {
      const output = activeSession.dispatchKey(key);
      prepareActiveModuleState(state, snapshotRef.current);
      applyPendingFocus(activeSession, state);
      return output;
    },
    dispatchText(value: unknown) {
      const text = String(value);
      const tree = activeSession.tree();
      const focused = findFocusedNode(tree);
      const trackedFocused = findNodeById(tree, trackedFocusIds.get(state));
      const hasFocusedTextEntry = isFocusedTextEntry(focused) || isFocusedTextEntry(trackedFocused);

      if (hasFocusedTextEntry && text.length > 1) {
        const output = pasteTextIntoFocusedEntry(activeSession, text);
        prepareActiveModuleState(state, snapshotRef.current);
        applyPendingFocus(activeSession, state);
        return output;
      }

      if (!hasFocusedTextEntry && text.length > 1) {
        return activeSession.output();
      }

      let output = "";
      for (const char of text) {
        output = activeSession.dispatchKey(char);
      }
      prepareActiveModuleState(state, snapshotRef.current);
      applyPendingFocus(activeSession, state);
      return output;
    },
    focus(id: string) {
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
    click(id: string) {
      const output = activeSession.click(id);

      if (typeof id === "string" && findNodeById(activeSession.tree(), id)) {
        trackedFocusIds.set(state, id);
      }

      if (output === activeSession.output() && !hasActiveOverlay(state) && handleHeadlessChromeClick(id, state)) {
        activeSession.update();
      }

      prepareActiveModuleState(state, snapshotRef.current);
      applyPendingFocus(activeSession, state);
      return activeSession.output();
    },
    clickAt(x: number, y: number) {
      const output = activeSession.clickAt(x, y);
      prepareActiveModuleState(state, snapshotRef.current);
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
      setPendingFocusForTab(state, nextTab);
      return true;
    }
  }

  if (id === "board-add-card") {
    return openRegisteredBoardAddCard(state);
  }

  return false;
}

async function mountInteractiveSession(options: AppOptions = {}): Promise<TerminalSession> {
  const runtime = await loadTerminalRuntime();
  const state = createInitialState(options.state);
  let session: TerminalSession | null = null;
  const stdout = options.stdout || process.stdout;
  const preparedSyncRunner = await prepareTuiSyncRunner();
  if (preparedSyncRunner !== null) {
    state.syncStatus = preparedSyncRunner.state;
  }
  const snapshotRef = createSnapshotRef(options);
  const requestRender = () => {
    if (session) {
      session.update();
      applyPendingFocus(session, state);
    }
  };
  const sessionActions = createSessionActions(options, snapshotRef, requestRender);
  sessionActions.syncTerminalTitle = () => syncTerminalTitle(session, state);
  prepareActiveModuleState(state, snapshotRef.current);
  prepareActiveUtilityApp(state, sessionActions, requestRender);
  const layout = resolveLayoutOptions({ ...options, stdout });
  sessionActions.currentLayout = () => session?.size() || layout;
  const app = createApp(runtime, state, snapshotRef, layout, sessionActions);
  const keymap = createKeymap(state, (command: TerminalCommand) => {
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
  }, (command: TerminalCommand, context: TerminalCommandContext) => {
    return handleModuleCommand(command, state, context, sessionActions, snapshotRef);
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
  const cleanupSyncRunner = preparedSyncRunner?.activate();
  session = enableSyncStatusUpdates(session, state, cleanupSyncRunner);
  let recoveryActive = true;
  const unsubscribeRecovery = defaultOnDataRecovery((event) => {
    if (recoveryActive === false) {
      return;
    }

    const domain = event.domain === "todos" ? "todo" : event.domain === "notes" ? "notes" : event.domain === "boards" ? "board" : null;
    if (domain !== null) {
      snapshotRef.refresh(domain);
    }
    const message = event.error !== null
      ? "Data recovery could not finish safely. The current file was preserved."
      : event.result?.status === "reconciled"
        ? "Remote changes were integrated. Repeat the action."
        : "Local data was reloaded. Repeat the action.";
    if (domain === "todo") {
      state.todo.actionError = message;
    } else if (domain === "notes") {
      state.notesState.actionError = message;
    } else if (domain === "board") {
      state.board.actionError = message;
      state.board.overlay = "card-action-error";
    }
    if (session !== null) {
      session.update();
    }
  });
  const destroyWithRecovery = session.destroy.bind(session);
  session.destroy = () => {
    recoveryActive = false;
    unsubscribeRecovery();
    return destroyWithRecovery();
  };
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

export { action, createApp, createHeadlessSession, createInitialState, createKeymap, handleCommand, loadTerminalRuntime, mountInteractiveSession, resolveLayoutOptions, renderSmoke };
export default {
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
