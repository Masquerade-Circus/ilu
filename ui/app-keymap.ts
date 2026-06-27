import type { TerminalCommand, TerminalCommandContext, TerminalKeyBinding, TerminalKeymapOptions } from "@valyrianjs/terminal";
import type { AppRuntimeState } from "./app-runtime";
import { normalizeTab } from "./app-runtime";
import { closeRegisteredOverlays, closeUtilityOverlay, createModuleKeyBindings, setPendingFocusForTab } from "./module-registry";

export function closeAppOverlays(state: AppRuntimeState): void {
  state.overlay = null;
  closeRegisteredOverlays(state);
}

export function handleCommand(command: TerminalCommand, state: AppRuntimeState): boolean {
  if (command.id === "ilu.add") {
    return true;
  }

  if (command.id === "ilu.board") {
    closeAppOverlays(state);
    state.activeTab = "Board";
    setPendingFocusForTab(state, "Board");
    return true;
  }

  if (command.id === "ilu.tab") {
    closeAppOverlays(state);
    state.activeTab = normalizeTab(command.text);
    setPendingFocusForTab(state, state.activeTab);
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

export function createKeymap(
  state: AppRuntimeState,
  afterCommand?: (command: TerminalCommand, state: AppRuntimeState) => void,
  handleLocalCommand?: (command: TerminalCommand, context: TerminalCommandContext) => boolean
): TerminalKeymapOptions {
  const bindings: TerminalKeyBinding[] = [
    ...createModuleKeyBindings(),
    { key: "CTRL_1", command: { id: "ilu.tab", text: "Todo" }, scope: "global" },
    { key: "CTRL_2", command: { id: "ilu.tab", text: "Notes" }, scope: "global" },
    { key: "CTRL_3", command: { id: "ilu.tab", text: "Board" }, scope: "global" },
    { key: "CTRL_4", command: { id: "ilu.tab", text: "Clocks" }, scope: "global" },
    { key: "CTRL_5", command: { id: "ilu.tab", text: "Sync" }, scope: "global" },
    { key: "CTRL_6", command: { id: "ilu.tab", text: "Translate" }, scope: "global" },
    { key: "CTRL_7", command: { id: "ilu.tab", text: "Speech" }, scope: "global" },
    { key: "CTRL_K", command: { id: "ilu.help" }, scope: "global" },
    { key: "ESCAPE", command: { id: "ilu.escape" }, scope: "global" },
    { key: "CTRL_C", command: { id: "input.copy" }, scope: "input", when: { focusedTag: "terminal-input" } },
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

module.exports = {
  closeAppOverlays,
  createKeymap,
  handleCommand
};
