import { Button, Split, View } from "@valyrianjs/terminal";
import type { AppState, SyncStatusState } from "../types";
import { CONTROL_BUTTON_STYLE } from "../theme";

type TopNavOptions = {
  onSelect?: (tab: string) => void;
  width?: number;
};

type TopNavState = AppState & { syncStatus?: SyncStatusState };

function positiveWidth(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function renderedButtonWidth(label: string): number {
  return label.length + 4;
}

function syncStatusLabel(status: SyncStatusState | undefined): string {
  if (status === "syncing") {
    return "Syncing...";
  }

  if (status === "pending") {
    return "Sync pending";
  }

  if (status === "synced") {
    return "Synced";
  }

  if (status === "failed") {
    return "Sync failed";
  }

  if (status === "setup") {
    return "Set up sync";
  }

  return "Sync";
}

function createLabeledNavButton(state: AppState, tab: string, label: string, options: TopNavOptions = {}): JSX.Element {
  return (
    <Button
      id={`tab-${tab.toLowerCase()}`}
      label={label}
      style={CONTROL_BUTTON_STYLE}
      styles={{ selected: "button.focus", focus: "button.hover" }}
      state={state.activeTab === tab ? "selected" : undefined}
      onpress={() => {
        state.activeTab = tab;

        if (typeof options.onSelect === "function") {
          options.onSelect(tab);
        }
      }}
    />
  );
}

export function createNavButton(state: AppState, tab: string, options: TopNavOptions = {}): JSX.Element {
  return createLabeledNavButton(state, tab, tab, options);
}

export function createTopNav(state: TopNavState, tabs: readonly string[], options: TopNavOptions = {}): JSX.Element {
  const width = positiveWidth(options.width) ? options.width : 80;
  const syncTab = tabs.includes("Sync") ? "Sync" : null;
  const appTabs = tabs.filter((tab: string) => tab !== "Sync");

  if (syncTab === null) {
    return (
      <View direction="row" gap={1}>
        {appTabs.map((tab: string) => createNavButton(state, tab, options))}
      </View>
    );
  }

  const syncLabel = syncStatusLabel(state.syncStatus);
  const syncWidth = renderedButtonWidth(syncLabel);
  const appWidth = Math.max(1, width - syncWidth);

  return (
    <Split direction="row" gap={0} width={width} height={1} sizes={[appWidth, syncWidth]}>
      <View direction="row" gap={1}>
        {appTabs.map((tab: string) => createNavButton(state, tab, options))}
      </View>
      <View direction="row" gap={0}>
        {createLabeledNavButton(state, syncTab, syncLabel, options)}
      </View>
    </Split>
  );
}
