import { Button } from "@valyrianjs/terminal";
import type { TerminalStateStyles, TerminalStyleValue, TerminalVisualState } from "@valyrianjs/terminal";
import { CONTROL_BUTTON_STYLE, DANGER_BUTTON_STYLE } from "../theme";

function buttonStateStyles(state?: TerminalVisualState): TerminalStateStyles {
  if (state === "error") {
    return {
      error: DANGER_BUTTON_STYLE,
      focus: DANGER_BUTTON_STYLE,
      hover: DANGER_BUTTON_STYLE,
      pressed: DANGER_BUTTON_STYLE,
      selected: DANGER_BUTTON_STYLE
    };
  }

  return { selected: "button.focus", focus: "button.focus", hover: "button.hover" };
}

export function createButton(
  id: string,
  label: string,
  onpress: () => void,
  state?: TerminalVisualState,
  style: TerminalStyleValue = CONTROL_BUTTON_STYLE
): JSX.Element {
  return (
    <Button
      id={id}
      label={label}
      style={style}
      styles={buttonStateStyles(state)}
      state={state}
      onpress={onpress}
    />
  );
}

export function createButtonStatus(
  id: string,
  label: string,
  state?: TerminalVisualState,
  style: TerminalStyleValue = CONTROL_BUTTON_STYLE
): JSX.Element {
  return (
    <Button
      id={id}
      label={label}
      focusable={false}
      style={style}
      styles={buttonStateStyles(state)}
      state={state}
    />
  );
}
