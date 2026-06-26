import type { TerminalCommand, TerminalCommandContext, TerminalKeyBinding } from "@valyrianjs/terminal";
import type { AppOptions, AppRuntimeState, SessionActions, SnapshotRef, Tab } from "./app-runtime";
import type { BabelActions, BoardActions, ClockActions, NoteActions, RefreshSnapshot, SyncActions, TodoActions, TtsActions, UiSnapshot, UtilityRuntimeState } from "./types";
import {
  clearBoardUiOverlay,
  createBoardKeyBindings,
  createBoardMainView,
  createInitialBoardState,
  getBoardPendingFocus,
  handleBoardCommand,
  openBoardAddCardModal
} from "./modules/board/MainView";
import {
  createClocksMainView,
  createInitialClockState,
  handleClockCommand,
  initialFocusForClockOverlay,
  prepareClockViewState
} from "./modules/clocks/MainView";
import {
  createInitialNotesState,
  createNotesKeyBindings,
  createNotesMainView,
  handleNotesCommand,
  initialFocusForNotesOverlay,
  prepareNotesViewState
} from "./modules/notes/MainView";
import {
  createInitialTodoState,
  createTodoKeyBindings,
  createTodoMainView,
  handleTodoCommand,
  initialFocusForTodoOverlay,
  prepareTodoViewState
} from "./modules/todos/MainView";
import {
  clearBabelUtilityTransientState,
  createBabelMainView,
  createInitialBabelState,
  createTranslateActionBar
} from "./modules/babel/MainView";
import {
  clearSyncUtilityTransientState,
  createInitialSyncState,
  createSyncActionBar,
  createSyncInitOverlay,
  createSyncMainView,
  prepareSyncViewState
} from "./modules/sync/MainView";
import {
  clearTtsUtilityTransientState,
  createInitialTtsState,
  createTtsActionBar,
  createTtsMainView,
  createTtsVoiceOverlay,
  prepareTtsViewState
} from "./modules/tts/MainView";

const { createBoardActions }: { createBoardActions: (options?: Record<string, unknown>) => BoardActions } = require("./modules/board/actions");
const { createClockActions }: { createClockActions: (options?: Record<string, unknown>) => ClockActions } = require("./modules/clocks/actions");
const { createNoteActions }: { createNoteActions: (options?: Record<string, unknown>) => NoteActions } = require("./modules/notes/actions");
const { createTodoActions }: { createTodoActions: (options?: Record<string, unknown>) => TodoActions } = require("./modules/todos/actions");
const { createBabelActions }: { createBabelActions: (options?: Record<string, unknown>) => BabelActions } = require("./modules/babel/actions");
const { createSyncActions }: { createSyncActions: (options?: Record<string, unknown>) => SyncActions } = require("./modules/sync/actions");
const { createTtsActions }: { createTtsActions: (options?: Record<string, unknown>) => TtsActions } = require("./modules/tts/actions");

type RegisteredView = {
  activePanelNodes: JSX.Element[];
  actionBar: JSX.Element | null;
  overlays: Array<JSX.Element | null>;
};

type ActiveViewOptions = {
  state: AppRuntimeState;
  snapshot: UiSnapshot;
  actions: SessionActions;
  refreshSnapshot: RefreshSnapshot;
  requestRender: () => void;
  utilityActions: JSX.Element[];
  width: number;
};

type UtilityOverlayOptions = {
  state: AppRuntimeState;
  actions: SessionActions;
  layout: { width: number; rows: number };
  requestRender?: () => void;
};

export function createDefaultModuleActions(options: AppOptions = {}): SessionActions {
  return {
    boardActions: options.boardActions || createBoardActions(),
    todoActions: options.todoActions || createTodoActions(),
    noteActions: options.noteActions || createNoteActions(),
    clockActions: options.clockActions || createClockActions(),
    syncActions: options.syncActions || createSyncActions(),
    babelActions: options.babelActions || createBabelActions(),
    ttsActions: options.ttsActions || createTtsActions()
  };
}

export function createInitialRegisteredState(source: Record<string, unknown>): Pick<AppRuntimeState, "todo" | "notesState" | "board" | "clocksState" | "utilities"> {
  const boardSource = typeof source.board === "object" && source.board !== null ? source.board as Record<string, unknown> : source;

  return {
    todo: createInitialTodoState(typeof source.todo === "object" && source.todo !== null ? source.todo as Record<string, unknown> : source),
    notesState: createInitialNotesState(typeof source.notesState === "object" && source.notesState !== null ? source.notesState as Record<string, unknown> : source),
    board: createInitialBoardState(boardSource),
    clocksState: createInitialClockState(typeof source.clocksState === "object" && source.clocksState !== null ? source.clocksState as Record<string, unknown> : source),
    utilities: createInitialUtilityState(typeof source.utilities === "object" && source.utilities !== null ? source.utilities as Record<string, unknown> : source)
  };
}

export function createInitialUtilityState(source: Record<string, unknown> = {}): UtilityRuntimeState {
  const activeOverlay = isUtilityOverlayId(source.activeOverlay) ? source.activeOverlay : null;

  return {
    activeOverlay,
    sync: createInitialSyncState(source),
    babel: createInitialBabelState(source),
    tts: createInitialTtsState(source)
  };
}

export function clearUtilityTransientState(state: UtilityRuntimeState): void {
  clearSyncUtilityTransientState(state);
  clearBabelUtilityTransientState(state);
  clearTtsUtilityTransientState(state);
}

export function closeUtilityOverlay(state: UtilityRuntimeState): boolean {
  if (state.activeOverlay === null) {
    return false;
  }

  state.activeOverlay = null;
  clearUtilityTransientState(state);
  return true;
}

export function closeRegisteredOverlays(state: AppRuntimeState): void {
  state.todo.overlay = null;
  state.todo.actionError = "";
  state.notesState.overlay = null;
  state.notesState.actionError = "";
  state.clocksState.overlay = null;
  state.clocksState.actionError = "";
  state.clocksState.addClock.error = "";
  clearBoardUiOverlay(state.board);
  state.utilities.activeOverlay = null;
  clearUtilityTransientState(state.utilities);
}

export function createModuleKeyBindings(): TerminalKeyBinding[] {
  return [
    ...createTodoKeyBindings(),
    ...createNotesKeyBindings(),
    ...createBoardKeyBindings()
  ];
}

export function createActiveModuleView(options: ActiveViewOptions): RegisteredView {
  const { state, snapshot, actions, refreshSnapshot, requestRender, utilityActions, width } = options;
  const boardActions: BoardActions = actions.boardActions || createBoardActions();
  const todoActions: TodoActions = actions.todoActions || createTodoActions();
  const noteActions: NoteActions = actions.noteActions || createNoteActions();
  const clockActions: ClockActions = actions.clockActions || createClockActions();
  const syncActions = actions.syncActions || createSyncActions();
  const babelActions = actions.babelActions || createBabelActions();
  const ttsActions = actions.ttsActions || createTtsActions();

  if (state.activeTab === "Todo") {
    return createTodoMainView({ panel: snapshot.todo, state: state.todo, isActive: true, todoActions, refreshSnapshot, utilityActions });
  }

  if (state.activeTab === "Notes") {
    return createNotesMainView({ panel: snapshot.notes, state: state.notesState, isActive: true, noteActions, refreshSnapshot, utilityActions });
  }

  if (state.activeTab === "Clocks") {
    return createClocksMainView({ clocks: snapshot.clocks, state: state.clocksState, isActive: true, clockActions, refreshSnapshot, utilityActions });
  }

  if (state.activeTab === "Board") {
    return createBoardMainView({ board: snapshot.board, state: state.board, isActive: true, width, boardActions, refreshSnapshot, utilityActions });
  }

  if (state.activeTab === "Sync") {
    return {
      activePanelNodes: createSyncMainView(state.utilities, syncActions, requestRender),
      actionBar: createSyncActionBar(state.utilities, syncActions, requestRender),
      overlays: []
    };
  }

  if (state.activeTab === "Translate") {
    return {
      activePanelNodes: createBabelMainView(state.utilities, babelActions, requestRender),
      actionBar: createTranslateActionBar(state.utilities, babelActions, (text: string) => {
        if (typeof actions.copyTextToClipboard === "function") {
          return actions.copyTextToClipboard(text);
        }

        return { ok: false, error: "Could not copy the translation." };
      }, requestRender),
      overlays: []
    };
  }

  if (state.activeTab === "Speech") {
    return {
      activePanelNodes: createTtsMainView(state.utilities, ttsActions, requestRender),
      actionBar: createTtsActionBar(state.utilities, ttsActions, requestRender),
      overlays: []
    };
  }

  return { activePanelNodes: [], actionBar: null, overlays: [] };
}

export function handleModuleCommand(
  command: TerminalCommand,
  state: AppRuntimeState,
  context: TerminalCommandContext,
  actions: SessionActions,
  snapshotRef: SnapshotRef
): boolean {
  if (handleTodoCommand(command, state.todo, state.activeTab === "Todo", context, actions.todoActions, snapshotRef.current.todo, actions.refreshSnapshot)) {
    return true;
  }

  if (handleNotesCommand(command, state.notesState, state.activeTab === "Notes", context, snapshotRef.current.notes, actions.noteActions, actions.refreshSnapshot)) {
    return true;
  }

  if (handleClockCommand(command, state.clocksState, state.activeTab === "Clocks", context)) {
    return true;
  }

  return handleBoardCommand(command, state.board, snapshotRef, actions.boardActions || createBoardActions(), state.activeTab === "Board", context);
}

export function setPendingFocusForTab(state: AppRuntimeState, tab: Tab): void {
  state.board.pendingFocus = tab === "Board" ? getBoardPendingFocus(state.board) : null;
}

export function pendingFocusForActiveModule(state: AppRuntimeState): string | null {
  if (state.activeTab !== "Board") {
    return null;
  }

  const pendingFocus = state.board.pendingFocus;

  if (typeof pendingFocus !== "string" || pendingFocus.length === 0) {
    return null;
  }

  return pendingFocus;
}

export function clearPendingFocusForActiveModule(state: AppRuntimeState): void {
  if (state.activeTab === "Board") {
    state.board.pendingFocus = null;
  }
}

export function initialFocusForActiveModule(state: AppRuntimeState): string | null {
  if (state.activeTab === "Todo") {
    return initialFocusForTodoOverlay(state.todo);
  }

  if (state.activeTab === "Notes") {
    return initialFocusForNotesOverlay(state.notesState);
  }

  if (state.activeTab === "Clocks") {
    return initialFocusForClockOverlay(state.clocksState);
  }

  return initialFocusForUtilityTab(state);
}

export function openRegisteredBoardAddCard(state: AppRuntimeState): boolean {
  if (state.activeTab !== "Board") {
    return false;
  }

  openBoardAddCardModal(state.board);
  return true;
}

export function prepareActiveModuleState(state: AppRuntimeState, snapshot: UiSnapshot): void {
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

export function prepareActiveUtilityApp(state: AppRuntimeState, actions: SessionActions, requestRender?: () => void): void {
  const syncActions = actions.syncActions || createSyncActions();
  const ttsActions = actions.ttsActions || createTtsActions();
  prepareUtilityPageState(state, state.activeTab, syncActions, ttsActions, requestRender);
}

export function prepareUtilityPageState(state: AppRuntimeState, tab: string, syncActions: SyncActions, ttsActions: TtsActions, requestRender?: () => void): void {
  state.utilities.activeOverlay = null;

  if (tab === "Sync") {
    prepareSyncViewState(state.utilities, syncActions, requestRender);
    return;
  }

  if (tab === "Speech") {
    prepareTtsViewState(state.utilities, ttsActions);
  }
}

export function createActiveUtilityOverlay(options: UtilityOverlayOptions): JSX.Element | null {
  const { state, actions, layout, requestRender } = options;
  const syncActions = actions.syncActions || createSyncActions();
  const ttsActions = actions.ttsActions || createTtsActions();

  if (state.activeTab === "Sync") {
    return createSyncInitOverlay(state.utilities, syncActions, layout, requestRender);
  }

  if (state.activeTab === "Speech") {
    return createTtsVoiceOverlay(state.utilities, ttsActions, layout, requestRender);
  }

  return null;
}

export function initialFocusForUtilityTab(state: AppRuntimeState): string | null {
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

export function isUtilityTab(tab: string): boolean {
  return tab === "Sync" || tab === "Translate" || tab === "Speech";
}

function isUtilityOverlayId(value: unknown): value is UtilityRuntimeState["activeOverlay"] {
  return value === "sync-init" || value === "tts-voice";
}
