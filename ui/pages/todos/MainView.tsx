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
  TextFormState,
  TodoActions,
  TodoRuntimeState,
  UiActionResult,
  UiEntityId,
  RefreshSnapshot
} from "../../types";
import { createActionBar } from "../../components/ActionBar";
import { createButton } from "../../components/Button";
import { EditOverlay } from "../../components/EditOverlay";
import { AppOverlay } from "../../components/Overlay";
import { emptyStateText, errorStateText } from "../../components/StateText";

const TODO_DESCRIPTION_EDITOR_IDS = Object.freeze(["todo-add-description", "todo-edit-description"] as const);
const TODO_OVERLAY_STATES = Object.freeze([
  "add-task",
  "task-details",
  "edit-task",
  "remove-task-confirm",
  "manage-lists",
  "add-list",
  "rename-list",
  "remove-list-confirm"
] as const);

type TodoOverlayState = typeof TODO_OVERLAY_STATES[number];

type TodoMainViewOptions = {
  panel: ListPanel;
  state: TodoRuntimeState;
  isActive: boolean;
  todoActions: Partial<TodoActions>;
  refreshSnapshot: RefreshSnapshot;
  utilityActions?: JSX.Element[];
};

type TodoMainViewResult = {
  activePanelNodes: JSX.Element[];
  actionBar: JSX.Element | null;
  overlays: Array<JSX.Element | null>;
};

function isTodoOverlayState(value: unknown): value is TodoOverlayState {
  return typeof value === "string" && (TODO_OVERLAY_STATES as readonly string[]).includes(value);
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

export function createInitialTodoState(source: Record<string, unknown> = {}): TodoRuntimeState {
  const state: TodoRuntimeState = {
    selectedTaskPosition: normalizePosition(source.selectedTaskPosition),
    selectedListId: normalizeEntityId(source.selectedListId),
    addTask: normalizeForm(source.addTask),
    editTask: normalizeForm(source.editTask),
    addList: normalizeForm(source.addList),
    renameList: normalizeForm(source.renameList),
    overlay: isTodoOverlayState(source.overlay) ? source.overlay : null,
    actionError: typeof source.actionError === "string" ? source.actionError : ""
  };

  return state;
}

export function createTodoKeyBindings(): TerminalKeyBinding[] {
  return [
    ...TODO_DESCRIPTION_EDITOR_IDS.map((id) => ({
      key: "ENTER",
      command: { id: "editor.newline" },
      scope: "editor",
      when: { focusedId: id, focusedTag: "terminal-editor" }
    } as TerminalKeyBinding)),
    {
      key: "ENTER",
      command: { id: "todo.toggle-task" },
      scope: "list",
      when: { focusedId: "todo-items", focusedTag: "terminal-list" }
    } as TerminalKeyBinding as TerminalKeyBinding,
    {
      key: "SPACE",
      command: { id: "todo.toggle-task" },
      scope: "list",
      when: { focusedId: "todo-items", focusedTag: "terminal-list" }
    } as TerminalKeyBinding
  ];
}

function itemPosition(item: ListItem, index: number): number {
  return typeof item.position === "number" && Number.isInteger(item.position) && item.position > 0 ? item.position : index + 1;
}

function selectedItem(panel: ListPanel, state: TodoRuntimeState): ListItem | null {
  const items = Array.isArray(panel.items) ? panel.items : [];
  const selectedPosition = normalizePosition(state.selectedTaskPosition) ?? (items[0] ? itemPosition(items[0], 0) : null);

  if (selectedPosition === null) {
    return null;
  }

  return items.find((item, index) => itemPosition(item, index) === selectedPosition) ?? null;
}

function selectedList(panel: ListPanel, state: TodoRuntimeState): ListSummary | null {
  const lists = Array.isArray(panel.lists) ? panel.lists : [];
  const selectedId = normalizeEntityId(state.selectedListId) ?? normalizeEntityId(panel.currentListId) ?? (lists[0] ? lists[0].id : null);

  if (selectedId === null) {
    return null;
  }

  return lists.find((list) => list.id === selectedId) ?? null;
}

export function normalizeSelectedTaskPosition(panel: ListPanel, state: TodoRuntimeState): void {
  const items = Array.isArray(panel.items) ? panel.items : [];
  const selectedPosition = normalizePosition(state.selectedTaskPosition);
  const firstPosition = items[0] ? itemPosition(items[0], 0) : null;

  if (selectedPosition === null) {
    state.selectedTaskPosition = firstPosition;
    return;
  }

  const selectedExists = items.some((item, index) => itemPosition(item, index) === selectedPosition);

  if (!selectedExists) {
    state.selectedTaskPosition = firstPosition;
  }
}

function renderTaskLabel(item: ListItem, index: number): string {
  const marker = item.done === true ? "✓" : "•";
  const position = itemPosition(item, index);
  const labels = Array.isArray(item.labels) && item.labels.length > 0 ? ` [${item.labels.join(", ")}]` : "";
  return `${marker} ${position}. ${item.text}${labels}`;
}

function applyResult(result: UiActionResult | undefined, form: TextFormState | null, refreshSnapshot: RefreshSnapshot, close: () => void, fallback: string): void {
  if (!result || result.ok !== true) {
    const message = result && typeof result.error === "string" ? result.error : fallback;

    if (form) {
      form.error = message;
    }

    return;
  }

  refreshSnapshot("todo");
  close();
}

function closeTodoOverlay(state: TodoRuntimeState): boolean {
  if (state.overlay === null) {
    return false;
  }

  state.overlay = null;
  state.actionError = "";
  return true;
}

export function prepareTodoViewState(panel: ListPanel, state: TodoRuntimeState): void {
  normalizeSelectedTaskPosition(panel, state);
  const activeList = selectedList(panel, state);

  if (state.selectedListId === null && activeList !== null) {
    state.selectedListId = activeList.id;
  }
}

export function handleTodoCommand(
  command: TerminalCommand,
  state: TodoRuntimeState,
  isActive: boolean,
  context?: TerminalCommandContext,
  todoActions?: Partial<TodoActions>,
  panel?: ListPanel,
  refreshSnapshot?: RefreshSnapshot
): boolean {
  if (isActive !== true) {
    return false;
  }

  if (command.id === "ilu.escape" || command.id === "ilu.cancel") {
    return closeTodoOverlay(state);
  }

  if (command.id === "todo.toggle-task" && context?.focusedId === "todo-items") {
    const item = panel ? selectedItem(panel, state) : null;

    if (!item) {
      state.actionError = "Choose a task first.";
      return true;
    }

    const result = item.done === true
      ? todoActions?.markTaskOpen?.({ position: state.selectedTaskPosition })
      : todoActions?.markTaskDone?.({ position: state.selectedTaskPosition });

    if (!result || result.ok !== true) {
      state.actionError = result && typeof result.error === "string" ? result.error : "Task could not be updated. Try again.";
      return true;
    }

    state.actionError = "";

    if (typeof refreshSnapshot === "function") {
      refreshSnapshot("todo");
    }

    return true;
  }

  return false;
}

export function createTodoMainView(options: TodoMainViewOptions): TodoMainViewResult {
  const { panel, state, isActive, todoActions, refreshSnapshot, utilityActions = [] } = options;
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
    const result = todoActions.useList?.({ listId });

    if (!result || result.ok !== true) {
      state.actionError = result && typeof result.error === "string" ? result.error : "List action failed. Try again.";
      return;
    }

    state.selectedListId = listId;
    state.selectedTaskPosition = null;
    state.actionError = "";
    refreshSnapshot("todo");
  }

  function openAddTask(): void {
    resetForm(state.addTask);
    state.overlay = "add-task";
  }

  function openDetails(): void {
    if (!activeItem) {
      state.actionError = "Choose a task first.";
      return;
    }

    state.actionError = "";
    state.overlay = "task-details";
  }

  function openEditTask(): void {
    if (!activeItem) {
      state.actionError = "Choose a task first.";
      return;
    }

    resetForm(state.editTask, activeItem.text, activeItem.description ?? "");
    state.overlay = "edit-task";
  }

  function openRemoveTask(): void {
    if (!activeItem) {
      state.actionError = "Choose a task first.";
      return;
    }

    state.actionError = "";
    state.overlay = "remove-task-confirm";
  }

  function saveAddTask(): void {
    applyResult(todoActions.addTask?.({ title: state.addTask.title, description: state.addTask.description }), state.addTask, refreshSnapshot, close, "Task could not be saved. Try again.");
  }

  function saveEditTask(): void {
    applyResult(todoActions.editTask?.({ position: state.selectedTaskPosition, title: state.editTask.title, description: state.editTask.description }), state.editTask, refreshSnapshot, close, "Task could not be updated. Try again.");
  }

  function markTask(done: boolean): void {
    if (!activeItem) {
      state.actionError = "Choose a task first.";
      return;
    }

    const result = done ? todoActions.markTaskDone?.({ position: state.selectedTaskPosition }) : todoActions.markTaskOpen?.({ position: state.selectedTaskPosition });

    if (!result || result.ok !== true) {
      state.actionError = result && typeof result.error === "string" ? result.error : "Task could not be updated. Try again.";
      return;
    }

    state.actionError = "";
    refreshSnapshot("todo");
  }

  function confirmRemoveTask(): void {
    applyResult(todoActions.removeTask?.({ position: state.selectedTaskPosition }), null, refreshSnapshot, close, "Task could not be removed. Try again.");
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
    applyResult(todoActions.addList?.({ title: state.addList.title, description: state.addList.description }), state.addList, refreshSnapshot, close, "List could not be saved. Try again.");
  }

  function saveRenameList(): void {
    applyResult(todoActions.renameList?.({ listId: state.selectedListId, title: state.renameList.title, description: state.renameList.description }), state.renameList, refreshSnapshot, close, "List could not be renamed. Try again.");
  }

  function confirmRemoveList(): void {
    applyResult(todoActions.removeList?.({ listId: state.selectedListId }), null, refreshSnapshot, close, "List could not be removed. Try again.");
  }

  function taskRows(): JSX.Element[] {
    if (typeof panel.error === "string" && panel.error.length > 0) {
      return [errorStateText(panel.error)];
    }

    if (items.length === 0) {
      return [emptyStateText("No tasks yet. Add a task to get started.")];
    }

    return [
      <List
        id="todo-items"
        items={items}
        itemKey={(item, index) => String(item.id ?? itemPosition(item, index))}
        showActive={true}
        virtualized={true}
        height={4}
        onchange={(event) => {
          state.selectedTaskPosition = itemPosition(event.value, event.index);
        }}
        onpress={(event) => {
          state.selectedTaskPosition = itemPosition(event.value, event.index);
        }}
        ondoublepress={(event) => {
          state.selectedTaskPosition = itemPosition(event.value, event.index);
          state.actionError = "";
          state.overlay = "task-details";
        }}
        wrap={true}
      >
        {(item, ctx) => renderTaskLabel(item, ctx.index)}
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
            "todo-list-switch-" + listSwitchElementId(list, index),
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
            <Text>Todo lists</Text>
            {state.actionError ? <Text>{state.actionError}</Text> : <Text></Text>}
            {lists.length > 0 ? (
              <List
                id="todo-lists"
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
            {createButton("todo-add-list", "Add list", openAddList)}
            {createButton("todo-rename-list", "Rename list", openRenameList)}
            {createButton("todo-delete-list", "Delete list", openRemoveList, "error")}
            {createButton("todo-lists-close", "Close", close)}
          </View>
        }
      />
    );
  }

  function formOverlay(idPrefix: string, heading: string, form: TextFormState, save: () => void): JSX.Element | null {
    return (
      <EditOverlay
        heading={heading}
        error={form.error}
        titleLabel="Task title"
        titleInputId={`${idPrefix}-title`}
        titleValue={form.title}
        editorLabel="Task details"
        editorId={`${idPrefix}-description`}
        editorValue={form.description}
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
    if (state.overlay !== "task-details" || !activeItem) {
      return null;
    }

    return (
      <AppOverlay
        trapFocus={true}
        content={[
          <FocusScope>
            <ScrollView id="todo-details-scroll" height={10}>
              <Text>Task details</Text>
              <Text>{`Title: ${activeItem.text}`}</Text>
              {activeItem.description ? <Text>{`Details: ${activeItem.description}`}</Text> : <Text>Details: None</Text>}
              {Array.isArray(activeItem.labels) && activeItem.labels.length > 0 ? <Text>{`Labels: ${activeItem.labels.join(", ")}`}</Text> : <Text></Text>}
            </ScrollView>
          </FocusScope>
        ]}
        bottomNav={
          <View direction="row" gap={1}>
            {createButton("todo-edit-task", "Edit task", openEditTask)}
            {createButton("todo-toggle-task", activeItem.done === true ? "Reopen task" : "Mark done", () => markTask(activeItem.done !== true))}
            {createButton("todo-remove-task", "Remove task", openRemoveTask, "error")}
            {createButton("todo-details-close", "Close", close)}
          </View>
        }
      />
    );
  }

  function removeTaskOverlay(): JSX.Element | null {
    if (state.overlay !== "remove-task-confirm" || !activeItem) {
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
            {createButton("todo-remove-confirm", "Remove task", confirmRemoveTask, "error")}
            {createButton("todo-remove-cancel", "Cancel", close)}
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
            {createButton("todo-remove-list-confirm", "Delete list", confirmRemoveList, "error")}
            {createButton("todo-remove-list-cancel", "Cancel", close)}
          </View>
        }
      />
    );
  }

  const actionBar = createActionBar({
    isActive,
    actions: [
      createButton("todo-add-task", "Add task", openAddTask),
      createButton("todo-manage-lists", "Manage lists", openManageLists),
      ...utilityActions
    ]
  });

  return {
    activePanelNodes: [
      ...listSelectorRows(),
      state.actionError ? <Text>{state.actionError}</Text> : <Text></Text>,
      ...taskRows()
    ],
    actionBar,
    overlays: [
      state.overlay === "add-task" ? formOverlay("todo-add", "Add task", state.addTask, saveAddTask) : null,
      detailsOverlay(),
      state.overlay === "edit-task" ? formOverlay("todo-edit", "Edit task", state.editTask, saveEditTask) : null,
      removeTaskOverlay(),
      listManagerOverlay(),
      state.overlay === "add-list" ? listFormOverlay("todo-add-list", "Add list", state.addList, saveAddList) : null,
      state.overlay === "rename-list" ? listFormOverlay("todo-rename-list", "Rename list", state.renameList, saveRenameList) : null,
      removeListOverlay()
    ]
  };
}

export function renderTodoNodes(panel: ListPanel): JSX.Element[] {
  return createTodoMainView({
    panel,
    state: createInitialTodoState(),
    isActive: true,
    todoActions: {},
    refreshSnapshot: () => {}
  }).activePanelNodes;
}
