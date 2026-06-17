import type { ClockItem, ClockSnapshot, FooterSegment, SyncStatusState, UiSnapshot } from "../types";
import { CLOCK_FOOTER_COLORS, FOOTER_STYLE, UI_COLORS } from "../theme";

export { FOOTER_STYLE };

function positiveWidth(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function clipText(value: unknown, width: number): string {
  const text = String(value);

  if (!positiveWidth(width) || text.length <= width) {
    return text;
  }

  if (width === 1) {
    return "…";
  }

  return `${text.slice(0, width - 1)}…`;
}

function formatClockTimeWithSeconds(value: unknown): string {
  const time = String(value ?? "").trim();

  if (/^\d{1,2}:\d{2}:\d{2}$/.test(time)) {
    return time;
  }

  if (/^\d{1,2}:\d{2}$/.test(time)) {
    return `${time}:00`;
  }

  return time.length > 0 ? time : "Time unavailable";
}

function clockDisplayName(clock: ClockItem): string {
  const name = typeof clock.name === "string" && clock.name.trim().length > 0 ? clock.name.trim() : "Clock";
  return name;
}

function clockColor(clock: ClockItem, index: number): string {
  const seed = positiveInteger(clock.position) ? clock.position - 1 : index;
  return CLOCK_FOOTER_COLORS[Math.abs(seed) % CLOCK_FOOTER_COLORS.length];
}

function formatClockLines(clocks: ClockSnapshot, options: { compact?: boolean } = {}): string[] {
  if (typeof clocks.error === "string" && clocks.error.length > 0) {
    return [clocks.error];
  }

  if (!Array.isArray(clocks.items) || clocks.items.length === 0) {
    return ["No clocks configured"];
  }

  const lines = clocks.items.map((clock) => {
    const time = formatClockTimeWithSeconds(clock.time);
    return options.compact === true ? `${clockDisplayName(clock)} ${time}` : `${clockDisplayName(clock)}: ${time}`;
  });

  if (Number.isInteger(clocks.remaining) && Number(clocks.remaining) > 0) {
    lines.push(`+${clocks.remaining} more`);
  }

  return lines;
}

type ClockEntry = FooterSegment & { length: number };

function compactClockEntriesForWidth(clocks: ClockSnapshot, width: number): ClockEntry[] {
  if (!positiveWidth(width)) {
    return [];
  }

  if (typeof clocks.error === "string" && clocks.error.length > 0) {
    const text = clipText(clocks.error, width);
    return text.length > 0 ? [{ text, length: text.length }] : [];
  }

  if (!Array.isArray(clocks.items) || clocks.items.length === 0) {
    return [];
  }

  const entries: ClockEntry[] = clocks.items.map((clock, index) => {
    const text = `${clockDisplayName(clock)} ${formatClockTimeWithSeconds(clock.time)}`;
    return {
      text,
      length: text.length,
      style: { color: clockColor(clock, index), background: UI_COLORS.surfaceRaised }
    };
  });

  if (Number.isInteger(clocks.remaining) && Number(clocks.remaining) > 0) {
    entries.push({ text: `+${clocks.remaining} more`, length: `+${clocks.remaining} more`.length });
  }

  for (let count = entries.length; count > 0; count -= 1) {
    const selected = entries.slice(0, count);
    const length = selected.reduce((total, entry) => total + entry.length, 0) + Math.max(0, selected.length - 1) * 2;

    if (length <= width) {
      return selected;
    }
  }

  return [];
}

function footerHints(_activeTab: string, _syncStatus: SyncStatusState = "idle"): string[] {
  return ["Ctrl+K: Help", "Ctrl+C: Exit"];
}

function footerLeft(activeTab: string, syncStatus: SyncStatusState): string {
  return footerHints(activeTab, syncStatus).join("  ");
}

export function footerSegments(width: number, snapshot: UiSnapshot, activeTab = "Todo", syncStatus: SyncStatusState = "idle"): FooterSegment[] {
  const safeWidth = positiveWidth(width) ? width : 80;
  const left = footerLeft(activeTab, syncStatus);

  if (left.length >= safeWidth) {
    return [{ text: clipText(left, safeWidth) }];
  }

  const clockBudget = safeWidth - left.length - 2;
  const clocks = compactClockEntriesForWidth(snapshot.clocks, clockBudget);

  if (clocks.length === 0) {
    return [{ text: left }];
  }

  const separatorWidth = 2;
  const clocksLength = clocks.reduce((total, entry) => total + entry.length, 0) + clocks.length * separatorWidth;
  const padding = " ".repeat(Math.max(0, safeWidth - left.length - clocksLength));

  return [{ text: `${left}${padding}` }, ...clocks.map((clock) => ({ text: clock.text, style: clock.style }))];
}

export function footerLine(width: number, snapshot: UiSnapshot, activeTab = "Todo", syncStatus: SyncStatusState = "idle"): string {
  return footerSegments(width, snapshot, activeTab, syncStatus).map((segment) => segment.text).join("");
}

export const __private = { formatClockLines };
