import { Button, Text, View } from "@valyrianjs/terminal";
import type { AppState } from "../types";
import { CONTROL_BUTTON_STYLE } from "../theme";

type TopNavOptions = {
  onSelect?: (tab: string) => void;
};

export function createNavButton(state: AppState, tab: string, options: TopNavOptions = {}): JSX.Element {
  return (
    <Button
      id={`tab-${tab.toLowerCase()}`}
      label={tab}
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

export function createTopNav(state: AppState, tabs: readonly string[], options: TopNavOptions = {}): JSX.Element {
  const primaryTabs = tabs.slice(0, 4);
  const utilityTabs = tabs.slice(4);

  return (
    <View direction="row" gap={1}>
      {primaryTabs.map((tab) => createNavButton(state, tab, options))}
      {utilityTabs.length > 0 ? <Text>|</Text> : null}
      {utilityTabs.map((tab) => createNavButton(state, tab, options))}
    </View>
  );
}
