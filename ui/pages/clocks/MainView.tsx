import {
  FocusScope,
  Input,
  List,
  Text,
  View
} from "@valyrianjs/terminal";
import type {
  TerminalCommand,
  TerminalCommandContext,
  TerminalInputChangeEventPayload,
  TerminalListActiveEventPayload,
  TerminalListPressEventPayload
} from "@valyrianjs/terminal";
import type {
  ClockActions,
  ClockFormState,
  ClockItem,
  ClockRuntimeState,
  ClockSnapshot,
  UiActionResult,
  RefreshSnapshot
} from "../../types";
import { createActionBar } from "../../components/ActionBar";
import { createButton } from "../../components/Button";
import { AppOverlay } from "../../components/Overlay";
import { emptyStateText, errorStateText } from "../../components/StateText";

const { searchTimezoneChoices }: { searchTimezoneChoices: (search?: unknown) => TimezoneChoice[] } = require("../../clock-actions");

const CLOCK_OVERLAY_STATES = Object.freeze(["add-clock", "remove-clock-confirm"] as const);
const TIMEZONE_CHOICE_HEIGHT = 5;
const timezoneChoiceCache = new WeakMap<ClockRuntimeState, { query: string; choices: TimezoneChoice[] }>();
const REMOVE_OVERLAY_TEXT_MAX_COLUMNS = 54;

type ClockOverlayState = typeof CLOCK_OVERLAY_STATES[number];
type TimezoneChoice = { name: string; value: string };

type ClockMainViewOptions = {
  clocks: ClockSnapshot;
  state: ClockRuntimeState;
  isActive: boolean;
  clockActions: Partial<ClockActions>;
  refreshSnapshot: RefreshSnapshot;
  utilityActions?: JSX.Element[];
};

type ClockMainViewResult = {
  activePanelNodes: JSX.Element[];
  actionBar: JSX.Element | null;
  overlays: Array<JSX.Element | null>;
};

function isClockOverlayState(value: unknown): value is ClockOverlayState {
  return typeof value === "string" && (CLOCK_OVERLAY_STATES as readonly string[]).includes(value);
}

function safeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizePosition(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function normalizePositions(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter(item => typeof item === "number" && Number.isInteger(item) && item > 0))].sort((left, right) => left - right);
}

function timezoneChoicesForQuery(state: ClockRuntimeState): TimezoneChoice[] {
  const query = safeText(state.addClock.timezoneSearch);
  const cached = timezoneChoiceCache.get(state);

  if (cached && cached.query === query) {
    return cached.choices;
  }

  const choices = searchTimezoneChoices(query);
  timezoneChoiceCache.set(state, { query, choices });
  return choices;
}

function normalizeClockForm(value: unknown = null): ClockFormState {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

  return {
    name: typeof source.name === "string" ? source.name : "",
    timezone: typeof source.timezone === "string" ? source.timezone : "",
    timezoneSearch: typeof source.timezoneSearch === "string" ? source.timezoneSearch : "",
    error: typeof source.error === "string" ? source.error : ""
  };
}

export function createInitialClockState(source: Record<string, unknown> = {}): ClockRuntimeState {
  return {
    selectedClockPosition: normalizePosition(source.selectedClockPosition),
    removeClockPositions: normalizePositions(source.removeClockPositions),
    addClock: normalizeClockForm(source.addClock),
    overlay: isClockOverlayState(source.overlay) ? source.overlay : null,
    actionError: typeof source.actionError === "string" ? source.actionError : ""
  };
}

function clockPosition(clock: ClockItem, index: number): number {
  return typeof clock.position === "number" && Number.isInteger(clock.position) && clock.position > 0 ? clock.position : index + 1;
}

function clockName(clock: ClockItem | null): string {
  return safeText(clock && clock.name, "Clock");
}

function clockTimezone(clock: ClockItem | null): string {
  return safeText(clock && clock.timezone, "Time zone unavailable");
}

function itemPositions(items: ClockItem[]): number[] {
  return items.map((item, index) => clockPosition(item, index));
}

function normalizeSelectedClockPosition(items: ClockItem[], value: unknown): number | null {
  const positions = itemPositions(items);

  if (positions.length === 0) {
    return null;
  }

  const selectedPosition = normalizePosition(value);

  if (selectedPosition !== null && positions.includes(selectedPosition)) {
    return selectedPosition;
  }

  if (selectedPosition !== null) {
    const fallbackIndex = Math.min(selectedPosition, positions.length) - 1;
    return positions[fallbackIndex] ?? positions[0];
  }

  return positions[0];
}

function selectedClock(items: ClockItem[], state: ClockRuntimeState): ClockItem | null {
  const selectedPosition = normalizeSelectedClockPosition(items, state.selectedClockPosition);

  if (selectedPosition === null) {
    return null;
  }

  return items.find((item, index) => clockPosition(item, index) === selectedPosition) ?? null;
}

function wrapLine(value: string, maxLength: number): string[] {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    return [value];
  }

  if (value.length <= maxLength) {
    return [value];
  }

  const lines: string[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    lines.push(value.slice(cursor, cursor + maxLength));
    cursor += maxLength;
  }

  return lines;
}

function renderClockLabel(clock: ClockItem, index: number): string {
  const position = clockPosition(clock, index);
  const timezone = safeText(clock.timezone);
  const metadata = timezone.length > 0 ? ` (${timezone})` : "";
  return `${position}. ${clockName(clock)}: ${clock.time}${metadata}`;
}

function applyResult(result: UiActionResult | undefined, form: ClockFormState | null, refreshSnapshot: RefreshSnapshot, close: () => void, fallback: string): void {
  if (!result || result.ok !== true) {
    const message = result && typeof result.error === "string" ? result.error : fallback;

    if (form) {
      form.error = message;
    }

    return;
  }

  refreshSnapshot("clocks");
  close();
}

function closeClockOverlay(state: ClockRuntimeState): boolean {
  if (state.overlay === null) {
    return false;
  }

  state.overlay = null;
  state.actionError = "";
  state.addClock.error = "";
  return true;
}

export function prepareClockViewState(clocks: ClockSnapshot, state: ClockRuntimeState): void {
  const items = Array.isArray(clocks.items) ? clocks.items : [];
  const positions = itemPositions(items);
  const normalizedSelectedPosition = normalizeSelectedClockPosition(items, state.selectedClockPosition);
  const normalizedRemovePositions = normalizePositions(state.removeClockPositions).filter(position => positions.includes(position));
  const removePositionsChanged =
    state.removeClockPositions.length !== normalizedRemovePositions.length ||
    state.removeClockPositions.some(position => !normalizedRemovePositions.includes(position));

  if (state.selectedClockPosition !== normalizedSelectedPosition) {
    state.selectedClockPosition = normalizedSelectedPosition;
  }

  if (removePositionsChanged) {
    state.removeClockPositions = normalizedRemovePositions;
  }
}

export function handleClockCommand(command: TerminalCommand, state: ClockRuntimeState, isActive: boolean, _context?: TerminalCommandContext): boolean {
  if (isActive !== true) {
    return false;
  }

  if (command.id === "ilu.escape" || command.id === "ilu.cancel") {
    return closeClockOverlay(state);
  }

  return false;
}

export function createClocksMainView(options: ClockMainViewOptions): ClockMainViewResult {
  const { clocks, state, isActive, clockActions, refreshSnapshot, utilityActions = [] } = options;
  const items = Array.isArray(clocks.items) ? clocks.items : [];
  const activeClock = selectedClock(items, state);

  function close(): void {
    state.overlay = null;
    state.actionError = "";
    state.addClock.error = "";
  }

  function resetAddClock(): void {
    state.addClock.name = "";
    state.addClock.timezone = "";
    state.addClock.timezoneSearch = "";
    state.addClock.error = "";
  }

  function openAddClock(): void {
    resetAddClock();
    state.overlay = "add-clock";
  }

  function currentRemovePositions(): number[] {
    if (state.removeClockPositions.length > 0) {
      return normalizePositions(state.removeClockPositions);
    }

    return state.selectedClockPosition === null ? [] : [state.selectedClockPosition];
  }

  function openRemoveClock(): void {
    if (!activeClock || state.selectedClockPosition === null) {
      state.actionError = "Choose a clock first.";
      return;
    }

    state.removeClockPositions = [state.selectedClockPosition];
    state.actionError = "";
    state.overlay = "remove-clock-confirm";
  }

  function saveAddClock(): void {
    const timezone = safeText(state.addClock.timezone, state.addClock.timezoneSearch);
    applyResult(clockActions.addClock?.({ name: state.addClock.name, timezone }), state.addClock, refreshSnapshot, close, "Clock could not be saved. Try again.");
  }

  function confirmRemoveClock(): void {
    const positions = currentRemovePositions();
    const result = clockActions.removeClocks?.({ positions });

    if (!result || result.ok !== true) {
      state.actionError = result && typeof result.error === "string" ? result.error : "Clock could not be removed. Try again.";
      return;
    }

    refreshSnapshot("clocks");
    close();
  }

  function moveSelectedClock(delta: number): void {
    const fromPosition = state.selectedClockPosition;

    if (fromPosition === null) {
      state.actionError = "Choose a clock to move.";
      return;
    }

    if (items.length < 2) {
      state.actionError = "Add another clock to move clocks.";
      return;
    }

    const toPosition = fromPosition + delta;

    if (toPosition < 1) {
      state.actionError = "This clock is already first.";
      return;
    }

    if (toPosition > items.length) {
      state.actionError = "This clock is already last.";
      return;
    }

    const result = clockActions.moveClock?.({ fromPosition, toPosition });

    if (!result || result.ok !== true) {
      state.actionError = result && typeof result.error === "string" ? result.error : "Clock order could not be updated. Try again.";
      return;
    }

    state.actionError = "";
    state.selectedClockPosition = toPosition;
    refreshSnapshot("clocks");
  }

  function clockRows(): JSX.Element[] {
    if (typeof clocks.error === "string" && clocks.error.length > 0) {
      return [errorStateText(clocks.error)];
    }

    if (items.length === 0) {
      return [emptyStateText("No clocks yet. Add a clock to see it here.")];
    }

    return [
      <List
        id="clock-items"
        items={items}
        itemKey={(clock, index) => String(clockPosition(clock, index))}
        showActive={true}
        virtualized={true}
        height={6}
        onactive={(event: TerminalListActiveEventPayload<ClockItem>) => {
          state.selectedClockPosition = clockPosition(event.value, event.index);
        }}
        onpress={(event: TerminalListPressEventPayload<ClockItem>) => {
          state.selectedClockPosition = clockPosition(event.value, event.index);
        }}
        wrap={true}
      >
        {(clock, ctx) => renderClockLabel(clock, ctx.index)}
      </List>
    ];
  }

  function addClockOverlay(): JSX.Element | null {
    if (state.overlay !== "add-clock" || isActive !== true) {
      return null;
    }

    const choices = timezoneChoicesForQuery(state);

    return (
      <AppOverlay trapFocus={true} content={[
          <FocusScope>
            <Text>Add clock</Text>
            {state.addClock.error ? <Text>{state.addClock.error}</Text> : <Text></Text>}
            <Text>Clock name</Text>
            <Input
              id="clock-add-name"
              value={state.addClock.name}
              placeholder="Clock name"
              onchange={(event: TerminalInputChangeEventPayload) => {
                state.addClock.name = event.value;
                state.addClock.error = "";
              }}
            />
            <Text>Time zone</Text>
            <Input
              id="clock-add-timezone-search"
              value={state.addClock.timezoneSearch}
              placeholder="Search time zones"
              onchange={(event: TerminalInputChangeEventPayload) => {
                state.addClock.timezoneSearch = event.value;
                state.addClock.timezone = "";
                state.addClock.error = "";
              }}
            />
            <Text>{`Selected time zone: ${safeText(state.addClock.timezone, "None")}`}</Text>
            <List
              id="clock-add-timezone-choices"
              items={choices}
              itemKey={(choice) => choice.value}
              showActive={true}
              virtualized={true}
              height={TIMEZONE_CHOICE_HEIGHT}
              wrap={true}
              onpress={(event: TerminalListPressEventPayload<TimezoneChoice>) => {
                state.addClock.timezone = event.value.value;
                state.addClock.timezoneSearch = event.value.value;
                state.addClock.error = "";
              }}
              onactive={(event: TerminalListActiveEventPayload<TimezoneChoice>) => {
                state.addClock.timezone = event.value.value;
              }}
            >
              {(choice) => choice.name}
            </List>
          </FocusScope>
        
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("clock-add-save", "Add clock", saveAddClock)}
            {createButton("clock-add-cancel", "Cancel", close)}
          </View>
        }
      />
    );
  }

  function removeClockOverlay(): JSX.Element | null {
    if (state.overlay !== "remove-clock-confirm" || isActive !== true) {
      return null;
    }

    const positions = currentRemovePositions();
    const count = positions.length;
    const onlyClock = count === 1 ? items.find((clock, index) => clockPosition(clock, index) === positions[0]) ?? null : null;
    const promptLines = count === 1 && onlyClock
      ? wrapLine(`Remove “${clockName(onlyClock)}”?`, REMOVE_OVERLAY_TEXT_MAX_COLUMNS)
      : wrapLine(`Remove ${count} clocks?`, REMOVE_OVERLAY_TEXT_MAX_COLUMNS);
    const timezoneLines = onlyClock ? wrapLine(`Time zone: ${clockTimezone(onlyClock)}`, REMOVE_OVERLAY_TEXT_MAX_COLUMNS) : [];

    return (
      <AppOverlay trapFocus={true} content={[
          <FocusScope>
            {count > 0 ? promptLines.map((line) => <Text>{line}</Text>) : <Text>Choose a clock first.</Text>}
            {state.actionError ? <Text>{state.actionError}</Text> : <Text></Text>}
            {timezoneLines.length > 0 ? timezoneLines.map((line) => <Text>{line}</Text>) : <Text></Text>}
          </FocusScope>
        
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("clock-remove-confirm", "Remove clock", confirmRemoveClock, "error")}
            {createButton("clock-remove-cancel", "Cancel", close)}
          </View>
        }
      />
    );
  }

  const actionBar = createActionBar({
    isActive,
    actions: [
      createButton("clock-add-open", "Add clock", openAddClock),
      createButton("clock-move-up", "Move up", () => moveSelectedClock(-1)),
      createButton("clock-move-down", "Move down", () => moveSelectedClock(1)),
      createButton("clock-remove-open", "Remove", openRemoveClock, "error"),
      ...utilityActions
    ]
  });

  return {
    activePanelNodes: [
      state.actionError ? <Text>{state.actionError}</Text> : <Text></Text>,
      ...clockRows()
    ],
    actionBar,
    overlays: [addClockOverlay(), removeClockOverlay()]
  };
}

export function renderClockNodes(clocks: ClockSnapshot): JSX.Element[] {
  return createClocksMainView({
    clocks,
    state: createInitialClockState(),
    isActive: true,
    clockActions: {},
    refreshSnapshot: () => {}
  }).activePanelNodes;
}
