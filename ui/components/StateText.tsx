import { Text } from "@valyrianjs/terminal";

import type { TerminalStyleValue } from "@valyrianjs/terminal";
import { UI_COLORS } from "../theme";

type UiStateTone = "empty" | "error" | "loading" | "muted" | "warning" | "success";

const STATE_TEXT_STYLES: Record<UiStateTone, TerminalStyleValue> = Object.freeze({
  empty: Object.freeze({ color: UI_COLORS.muted }),
  error: Object.freeze({ color: UI_COLORS.textStrong, background: UI_COLORS.danger }),
  loading: Object.freeze({ color: UI_COLORS.borderActive }),
  muted: Object.freeze({ color: UI_COLORS.muted }),
  warning: Object.freeze({ color: UI_COLORS.warning }),
  success: Object.freeze({ color: UI_COLORS.success })
});

export function stateText(tone: UiStateTone, message: string): JSX.Element {
  return <Text state={tone} styles={{ [tone]: STATE_TEXT_STYLES[tone] }}>{message}</Text>;
}

export function emptyStateText(message: string): JSX.Element {
  return stateText("empty", message);
}

export function errorStateText(message: string): JSX.Element {
  return stateText("error", message);
}

export function loadingStateText(message: string): JSX.Element {
  return stateText("loading", message);
}
