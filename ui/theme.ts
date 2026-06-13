import type { TerminalStyleValue } from "@valyrianjs/terminal";

export const UI_COLORS = Object.freeze({
  text: "#d8dee9",
  textStrong: "#ffffff",
  surface: "#0d1117",
  surfaceRaised: "#111111",
  surfaceControl: "#1f2328",
  surfaceOverlay: "#05070a",
  surfaceDetails: "#1f2937",
  border: "#4b5563",
  borderActive: "#8ab4f8",
  accent: "#315f9e",
  hover: "#2b3137",
  danger: "#8f1d2c",
  success: "#238636",
  warning: "#d29922",
  muted: "#8b949e"
});

export const CONTROL_BUTTON_STYLE: TerminalStyleValue = Object.freeze({
  color: UI_COLORS.text,
  background: UI_COLORS.surfaceControl,
  padding: { left: 2, right: 2 }
});

export const DANGER_BUTTON_STYLE: TerminalStyleValue = Object.freeze({
  color: UI_COLORS.textStrong,
  background: UI_COLORS.danger,
  padding: { left: 2, right: 2 }
});

export const PANEL_STYLE: TerminalStyleValue = Object.freeze({
  color: UI_COLORS.text,
  background: UI_COLORS.surface,
  padding: { left: 1, right: 1 }
});

export const FOOTER_STYLE: TerminalStyleValue = Object.freeze({
  color: UI_COLORS.text,
  background: UI_COLORS.surfaceRaised
});

export const OVERLAY_STYLE: TerminalStyleValue = Object.freeze({
  color: UI_COLORS.text,
  background: UI_COLORS.surfaceOverlay
});

export const OVERLAY_SURFACE_STYLE: TerminalStyleValue = Object.freeze({
  color: UI_COLORS.text,
  background: UI_COLORS.surfaceOverlay,
  border: { top: true, right: true, bottom: true, left: true, style: "solid", color: UI_COLORS.borderActive },
  padding: { left: 1, right: 1 }
});

export const CARD_DETAILS_SURFACE_STYLE: TerminalStyleValue = Object.freeze({
  color: UI_COLORS.text,
  background: UI_COLORS.surfaceDetails,
  border: { top: true, right: true, bottom: true, left: true, style: "solid", color: UI_COLORS.borderActive },
  padding: { left: 1, right: 1 }
});

export const CARD_DETAILS_HEADING_STYLE: TerminalStyleValue = Object.freeze({
  border: { bottom: true, style: "solid", color: UI_COLORS.text }
});


export const CLOCK_FOOTER_COLORS = Object.freeze([
  "#f87171",
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#c084fc",
  "#fb7185"
]);
