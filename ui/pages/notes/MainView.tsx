import {
  Editor,
  FocusScope,
  Input,
  List,
  ScrollView,
  Text,
  View
} from "@valyrianjs/terminal";
import type {
  TerminalCommand,
  TerminalCommandContext,
  TerminalEditorChangeEventPayload,
  TerminalInputChangeEventPayload,
  TerminalKeyBinding
} from "@valyrianjs/terminal";
import type {
  ListItem,
  ListPanel,
  ListSummary,
  NoteActions,
  NotesRuntimeState,
  TextFormState,
  UiActionResult,
  UiEntityId,
  RefreshSnapshot
} from "../../types";
import { createActionBar } from "../../components/ActionBar";
import { createButton } from "../../components/Button";
import { EditOverlay } from "../../components/EditOverlay";
import { AppOverlay } from "../../components/Overlay";
import { emptyStateText, errorStateText } from "../../components/StateText";

const NOTE_CONTENT_EDITOR_IDS = Object.freeze(["note-add-content", "note-edit-content"] as const);
const NOTE_OVERLAY_STATES = Object.freeze([
  "add-note",
  "note-details",
  "edit-note",
  "remove-note-confirm",
  "manage-lists",
  "add-list",
  "rename-list",
  "remove-list-confirm"
] as const);

type NoteOverlayState = typeof NOTE_OVERLAY_STATES[number];

type NotesMainViewOptions = {
  panel: ListPanel;
  state: NotesRuntimeState;
  isActive: boolean;
  noteActions: Partial<NoteActions>;
  refreshSnapshot: RefreshSnapshot;
  utilityActions?: JSX.Element[];
};

type NotesMainViewResult = {
  activePanelNodes: JSX.Element[];
  actionBar: JSX.Element | null;
  overlays: Array<JSX.Element | null>;
};

function isNoteOverlayState(value: unknown): value is NoteOverlayState {
  return typeof value === "string" && (NOTE_OVERLAY_STATES as readonly string[]).includes(value);
}

function safeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function listSwitchElementId(list: ListSummary, index: number): string {
  const rawId = typeof list.id === "string" || typeof list.id === "number" ? String(list.id) : "list-" + String(index + 1);
  return rawId.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "list-" + String(index + 1);
}

function normalizeForm(value: unknown = null): TextFormState {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};

  return {
    title: typeof source.title === "string" ? source.title : "",
    description: typeof source.description === "string" ? source.description : "",
    error: typeof source.error === "string" ? source.error : ""
  };
}

function normalizeEntityId(value: unknown): UiEntityId | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return null;
}

function normalizePosition(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function createInitialNotesState(source: Record<string, unknown> = {}): NotesRuntimeState {
  return {
    selectedNotePosition: normalizePosition(source.selectedNotePosition),
    selectedListId: normalizeEntityId(source.selectedListId),
    addNote: normalizeForm(source.addNote),
    editNote: normalizeForm(source.editNote),
    addList: normalizeForm(source.addList),
    renameList: normalizeForm(source.renameList),
    overlay: isNoteOverlayState(source.overlay) ? source.overlay : null,
    actionError: typeof source.actionError === "string" ? source.actionError : ""
  };
}

export function createNotesKeyBindings(): TerminalKeyBinding[] {
  return [
    ...NOTE_CONTENT_EDITOR_IDS.map((id) => ({
      key: "ENTER",
      command: { id: "editor.newline" },
      scope: "editor",
      when: { focusedId: id, focusedTag: "terminal-editor" }
    } as TerminalKeyBinding)),
    {
      key: "ENTER",
      command: { id: "notes.open-details" },
      scope: "list",
      when: { focusedId: "note-items", focusedTag: "terminal-list" }
    } as TerminalKeyBinding
  ];
}

function itemPosition(item: ListItem, index: number): number {
  return typeof item.position === "number" && Number.isInteger(item.position) && item.position > 0 ? item.position : index + 1;
}

function selectedItem(panel: ListPanel, state: NotesRuntimeState): ListItem | null {
  const items = Array.isArray(panel.items) ? panel.items : [];
  const selectedPosition = normalizePosition(state.selectedNotePosition) ?? (items[0] ? itemPosition(items[0], 0) : null);

  if (selectedPosition === null) {
    return null;
  }

  return items.find((item, index) => itemPosition(item, index) === selectedPosition) ?? null;
}

function selectedList(panel: ListPanel, state: NotesRuntimeState): ListSummary | null {
  const lists = Array.isArray(panel.lists) ? panel.lists : [];
  const selectedId = normalizeEntityId(state.selectedListId) ?? normalizeEntityId(panel.currentListId) ?? (lists[0] ? lists[0].id : null);

  if (selectedId === null) {
    return null;
  }

  return lists.find((list) => list.id === selectedId) ?? null;
}

export function normalizeSelectedNotePosition(panel: ListPanel, state: NotesRuntimeState): void {
  const items = Array.isArray(panel.items) ? panel.items : [];
  const selectedPosition = normalizePosition(state.selectedNotePosition);
  const firstPosition = items[0] ? itemPosition(items[0], 0) : null;

  if (selectedPosition === null) {
    state.selectedNotePosition = firstPosition;
    return;
  }

  const selectedExists = items.some((item, index) => itemPosition(item, index) === selectedPosition);

  if (!selectedExists) {
    state.selectedNotePosition = firstPosition;
  }
}

function renderNoteLabel(item: ListItem, index: number): string {
  const position = itemPosition(item, index);
  const labels = Array.isArray(item.labels) && item.labels.length > 0 ? ` [${item.labels.join(", ")}]` : "";
  return `• ${position}. ${item.text}${labels}`;
}

function applyResult(result: UiActionResult | undefined, form: TextFormState | null, refreshSnapshot: RefreshSnapshot, close: () => void, fallback: string): void {
  if (!result || result.ok !== true) {
    const message = result && typeof result.error === "string" ? result.error : fallback;

    if (form) {
      form.error = message;
    }

    return;
  }

  refreshSnapshot("notes");
  close();
}

function closeNotesOverlay(state: NotesRuntimeState): boolean {
  if (state.overlay === null) {
    return false;
  }

  state.overlay = null;
  state.actionError = "";
  return true;
}

export function prepareNotesViewState(panel: ListPanel, state: NotesRuntimeState): void {
  normalizeSelectedNotePosition(panel, state);
  const activeList = selectedList(panel, state);

  if (state.selectedListId === null && activeList !== null) {
    state.selectedListId = activeList.id;
  }
}

export function handleNotesCommand(command: TerminalCommand, state: NotesRuntimeState, isActive: boolean, context?: TerminalCommandContext, panel?: ListPanel): boolean {
  if (isActive !== true) {
    return false;
  }

  if (command.id === "ilu.escape" || command.id === "ilu.cancel") {
    return closeNotesOverlay(state);
  }

  if (command.id === "notes.open-details" && context?.focusedId === "note-items") {
    const item = panel ? selectedItem(panel, state) : null;

    if (!item) {
      state.actionError = "Choose a note first.";
      return true;
    }

    state.actionError = "";
    state.overlay = "note-details";
    return true;
  }

  return false;
}

export function createNotesMainView(options: NotesMainViewOptions): NotesMainViewResult {
  const { panel, state, isActive, noteActions, refreshSnapshot, utilityActions = [] } = options;
  const items = Array.isArray(panel.items) ? panel.items : [];
  const lists = Array.isArray(panel.lists) ? panel.lists : [];
  const activeItem = selectedItem(panel, state);
  const activeList = selectedList(panel, state);
  const selectedListId = activeList ? activeList.id : null;

  function resetForm(form: TextFormState, title = "", description = ""): void {
    form.title = title;
    form.description = description;
    form.error = "";
  }

  function close(): void {
    state.overlay = null;
    state.actionError = "";
  }

  function useSelectedList(listId: UiEntityId): void {
    const result = noteActions.useList?.({ listId });

    if (!result || result.ok !== true) {
      state.actionError = result && typeof result.error === "string" ? result.error : "List action failed. Try again.";
      return;
    }

    state.selectedListId = listId;
    state.selectedNotePosition = null;
    state.actionError = "";
    refreshSnapshot("notes");
  }

  function openAddNote(): void {
    resetForm(state.addNote);
    state.overlay = "add-note";
  }

  function openDetails(): void {
    if (!activeItem) {
      state.actionError = "Choose a note first.";
      return;
    }

    state.actionError = "";
    state.overlay = "note-details";
  }

  function openEditNote(): void {
    if (!activeItem) {
      state.actionError = "Choose a note first.";
      return;
    }

    resetForm(state.editNote, activeItem.text, activeItem.description ?? "");
    state.overlay = "edit-note";
  }

  function openRemoveNote(): void {
    if (!activeItem) {
      state.actionError = "Choose a note first.";
      return;
    }

    state.actionError = "";
    state.overlay = "remove-note-confirm";
  }

  function saveAddNote(): void {
    applyResult(noteActions.addNote?.({ title: state.addNote.title, content: state.addNote.description }), state.addNote, refreshSnapshot, close, "Note could not be saved. Try again.");
  }

  function saveEditNote(): void {
    applyResult(noteActions.editNote?.({ position: state.selectedNotePosition, title: state.editNote.title, content: state.editNote.description }), state.editNote, refreshSnapshot, close, "Note could not be updated. Try again.");
  }

  function confirmRemoveNote(): void {
    applyResult(noteActions.removeNote?.({ position: state.selectedNotePosition }), null, refreshSnapshot, close, "Note could not be removed. Try again.");
  }

  function openAddList(): void {
    resetForm(state.addList);
    state.overlay = "add-list";
  }

  function openRenameList(): void {
    if (!activeList) {
      state.actionError = "Choose a list first.";
      return;
    }

    resetForm(state.renameList, activeList.title, "");
    state.overlay = "rename-list";
  }

  function openManageLists(): void {
    state.actionError = "";
    state.overlay = "manage-lists";
  }

  function openRemoveList(): void {
    if (!activeList) {
      state.actionError = "Choose a list first.";
      return;
    }

    state.actionError = "";
    state.overlay = "remove-list-confirm";
  }

  function saveAddList(): void {
    applyResult(noteActions.addList?.({ title: state.addList.title, description: state.addList.description }), state.addList, refreshSnapshot, close, "List could not be saved. Try again.");
  }

  function saveRenameList(): void {
    applyResult(noteActions.renameList?.({ listId: state.selectedListId, title: state.renameList.title, description: state.renameList.description }), state.renameList, refreshSnapshot, close, "List could not be renamed. Try again.");
  }

  function confirmRemoveList(): void {
    applyResult(noteActions.removeList?.({ listId: state.selectedListId }), null, refreshSnapshot, close, "List could not be removed. Try again.");
  }

  function noteRows(): JSX.Element[] {
    if (typeof panel.error === "string" && panel.error.length > 0) {
      return [errorStateText(panel.error)];
    }

    if (items.length === 0) {
      return [emptyStateText("No notes yet. Add a note to get started.")];
    }

    return [
      <List
        id="note-items"
        items={items}
        itemKey={(item, index) => String(item.id ?? itemPosition(item, index))}
        showActive={true}
        virtualized={true}
        height={4}
        onchange={(event) => {
          state.selectedNotePosition = itemPosition(event.value, event.index);
        }}
        onpress={(event) => {
          state.selectedNotePosition = itemPosition(event.value, event.index);
        }}
        ondoublepress={(event) => {
          state.selectedNotePosition = itemPosition(event.value, event.index);
          state.actionError = "";
          state.overlay = "note-details";
        }}
        wrap={true}
      >
        {(item, ctx) => renderNoteLabel(item, ctx.index)}
      </List>
    ];
  }

  function listSelectorRows(): JSX.Element[] {
    if (lists.length === 0) {
      return [<Text>No lists yet.</Text>];
    }

    return [
      <View direction="row" gap={1}>
        <Text>Lists</Text>
        {lists.map((list, index) => {
          const listId = normalizeEntityId(list.id);
          const isSelected = list.current === true || list.id === selectedListId;
          const label = safeText(list.title, "Untitled list");

          return createButton(
            "note-list-switch-" + listSwitchElementId(list, index),
            label,
            () => {
              if (listId === null) {
                return;
              }

              useSelectedList(listId);
            },
            isSelected ? "selected" : undefined
          );
        })}
      </View>
    ];
  }

  function listManagerOverlay(): JSX.Element | null {
    if (state.overlay !== "manage-lists") {
      return null;
    }

    return (
      <AppOverlay trapFocus={true} content={[
          <FocusScope>
            <Text>Note lists</Text>
            {state.actionError ? <Text>{state.actionError}</Text> : <Text></Text>}
            {lists.length > 0 ? (
              <List
                id="note-lists"
                items={lists}
                itemKey={(list) => String(list.id)}
                showActive={true}
                virtualized={true}
                height={8}
                onchange={(event) => {
                  state.selectedListId = event.value.id;
                }}
                onpress={(event) => {
                  state.selectedListId = event.value.id;
                }}
                wrap={true}
              >
                {(list) => `${list.current === true ? "✓" : "•"} ${safeText(list.title, "Untitled list")}`}
              </List>
            ) : <Text>No lists yet.</Text>}
          </FocusScope>
        
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("note-add-list", "Add list", openAddList)}
            {createButton("note-rename-list", "Rename list", openRenameList)}
            {createButton("note-delete-list", "Delete list", openRemoveList, "error")}
            {createButton("note-lists-close", "Close", close)}
          </View>
        }
      />
    );
  }

  function noteFormOverlay(idPrefix: string, heading: string, form: TextFormState, save: () => void): JSX.Element | null {
    return (
      <EditOverlay
        heading={heading}
        error={form.error}
        titleLabel="Note title"
        titleInputId={`${idPrefix}-title`}
        titleValue={form.title}
        editorLabel="Note content"
        editorId={`${idPrefix}-content`}
        editorValue={form.description}
        editorPlaceholder="Write your note..."
        editorHeight={10}
        primaryActionId={`${idPrefix}-save`}
        cancelActionId={`${idPrefix}-cancel`}
        onTitleInput={(value) => {
          form.title = value;
          form.error = "";
        }}
        onEditorInput={(value) => {
          form.description = value;
          form.error = "";
        }}
        onSave={save}
        onCancel={close}
      />
    );
  }
  function listFormOverlay(idPrefix: string, heading: string, form: TextFormState, save: () => void): JSX.Element | null {
    return (
      <AppOverlay trapFocus={true} content={[
          <FocusScope>
            <Text>{heading}</Text>
            {form.error ? <Text>{form.error}</Text> : <Text></Text>}
            <Text>List title</Text>
            <Input
              id={`${idPrefix}-title`}
              value={form.title}
              onchange={(event: TerminalInputChangeEventPayload) => {
                form.title = event.value;
                form.error = "";
              }}
            />
            <Text>List details</Text>
            <Editor
              id={`${idPrefix}-description`}
              value={form.description}
              height={10}
              onchange={(event: TerminalEditorChangeEventPayload) => {
                form.description = event.value;
                form.error = "";
              }}
            />
          </FocusScope>
        
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton(`${idPrefix}-save`, heading, save)}
            {createButton(`${idPrefix}-cancel`, "Cancel", close)}
          </View>
        }
      />
    );
  }

  function detailsOverlay(): JSX.Element | null {
    if (state.overlay !== "note-details" || !activeItem) {
      return null;
    }

    const contentLines = safeText(activeItem.description, "None").split(/\r?\n/);

    return (
      <AppOverlay
        trapFocus={true}
        content={[
          <FocusScope>
            <ScrollView id="note-details-scroll" height={10}>
              <Text>Note details</Text>
              <Text>{`Note title: ${activeItem.text}`}</Text>
              <Text>Note content</Text>
              {contentLines.map((line) => <Text>{line}</Text>)}
              {Array.isArray(activeItem.labels) && activeItem.labels.length > 0 ? <Text>{`Labels: ${activeItem.labels.join(", ")}`}</Text> : <Text></Text>}
            </ScrollView>
          </FocusScope>
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("note-edit-note", "Edit note", openEditNote)}
            {createButton("note-remove-note", "Remove note", openRemoveNote, "error")}
            {createButton("note-details-close", "Close", close)}
          </View>
        }
      />
    );
  }

  function removeNoteOverlay(): JSX.Element | null {
    if (state.overlay !== "remove-note-confirm" || !activeItem) {
      return null;
    }

    return (
      <AppOverlay trapFocus={true} content={[
          <FocusScope>
            <Text>{`Remove “${activeItem.text}”? This cannot be undone.`}</Text>
          </FocusScope>
        
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("note-remove-confirm", "Remove note", confirmRemoveNote, "error")}
            {createButton("note-remove-cancel", "Cancel", close)}
          </View>
        }
      />
    );
  }

  function removeListOverlay(): JSX.Element | null {
    if (state.overlay !== "remove-list-confirm" || !activeList) {
      return null;
    }

    return (
      <AppOverlay trapFocus={true} content={[
          <FocusScope>
            <Text>{`Remove “${activeList.title}”? This cannot be undone.`}</Text>
          </FocusScope>
        
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("note-remove-list-confirm", "Delete list", confirmRemoveList, "error")}
            {createButton("note-remove-list-cancel", "Cancel", close)}
          </View>
        }
      />
    );
  }

  const actionBar = createActionBar({
    isActive,
    actions: [
      createButton("note-add-note", "Add note", openAddNote),
      createButton("note-manage-lists", "Manage lists", openManageLists),
      ...utilityActions
    ]
  });

  return {
    activePanelNodes: [
      ...listSelectorRows(),
      state.actionError ? <Text>{state.actionError}</Text> : <Text></Text>,
      ...noteRows()
    ],
    actionBar,
    overlays: [
      state.overlay === "add-note" ? noteFormOverlay("note-add", "Add note", state.addNote, saveAddNote) : null,
      detailsOverlay(),
      state.overlay === "edit-note" ? noteFormOverlay("note-edit", "Edit note", state.editNote, saveEditNote) : null,
      removeNoteOverlay(),
      listManagerOverlay(),
      state.overlay === "add-list" ? listFormOverlay("note-add-list", "Add list", state.addList, saveAddList) : null,
      state.overlay === "rename-list" ? listFormOverlay("note-rename-list", "Rename list", state.renameList, saveRenameList) : null,
      removeListOverlay()
    ]
  };
}

export function renderNotesNodes(panel: ListPanel): JSX.Element[] {
  return createNotesMainView({
    panel,
    state: createInitialNotesState(),
    isActive: true,
    noteActions: {},
    refreshSnapshot: () => {}
  }).activePanelNodes;
}
