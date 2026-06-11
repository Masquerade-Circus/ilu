# UI CLI Parity Todo and Notes Plan

> Planning-only document. Do not implement product code from this file until plan-reviewer has approved the plan set and mini-kapa8 has filled the test inventory section.

**Goal:** Bring Todo and Notes tabs to parity with normal CLI task/note and list-management workflows.

**Architecture:** Keep shared shell concerns in the foundation plan. Todo and Notes get focused page modules, runtime state, action adapters, and read-snapshot enrichment while existing CommonJS list models remain the source of truth.

**Tech stack:** `ui/pages/todos/*`, `ui/pages/notes/*`, `ui/read-model.js`, `ui/types.ts`, existing `todos/model.js`, `notes/model.js`, and list-model factory.

---

## Scope

- Todo tasks: list/show, add, details, edit, check/uncheck, remove.
- Todo lists: list, use, add, edit, remove.
- Notes: list/show, add, details, edit, remove.
- Note lists: list, use, add, edit, remove.
- Preserve existing labels when present, at least as visible read-only metadata and as non-destructive data in edit flows.
- Use visible action bars/buttons and semantic `List` events; keymaps are fallback only.
- Use `Editor` for note content and multiline descriptions where appropriate.

## Non-scope

- No label-management parity beyond preserving/displaying existing labels unless a later CLI scope explicitly asks for it.
- No root CLI/Inquirer rewrite.
- No sync runtime calls after mutations; model mutators trigger hooks.
- No test cases in this plan.

## Current UI vs CLI state

- CLI Todo and Notes commands are registered in `bin/configure-cli.js` with task/note options and list options.
- Todo model is `todos/model.js`, backed by `utils/create-list-model.js` with `itemKey: 'tasks'` and check support.
- Notes model is `notes/model.js`, backed by the same factory with `itemKey: 'notes'`.
- Current UI Todo and Notes pages render limited read-only text and no action controls.
- `ui/read-model.js` currently exposes only title, limited items, remaining count, and done flag for list panels.

## Proposed architecture and ownership

- Add Todo and Notes runtime substates under `AppState`, normalized in their page/controller modules.
- Add focused action adapters for Todo and Notes instead of calling CLI prompt modules.
- Keep adapters close to UI, but call existing model methods (`Model.add`, `Model.use`, `Model.save`, nested `tasks`/`notes` operations) as the persistence contract.
- Enrich `UiSnapshot.todo` and `UiSnapshot.notes` to include:
  - current list identity/index;
  - all list summaries;
  - all visible item identities/positions needed for `List` item keys;
  - descriptions/content and done state where applicable;
  - label display data if already present.
- Split UI files by responsibility:
  - page main view;
  - list/item browser components;
  - forms/overlays;
  - action adapter;
  - state normalization.
- Do not move these internals into `ui/app.tsx`.

## Probable files and areas

- Modify: `ui/types.ts`
- Modify: `ui/read-model.js`
- Modify: `ui/app.tsx` only for delegation/state wiring/action-bar slot consumption.
- Modify or split: `ui/pages/todos/MainView.tsx`
- Modify or split: `ui/pages/notes/MainView.tsx`
- Create probable adapters: `ui/todo-actions.js`, `ui/note-actions.js` or domain-local equivalents.
- Create probable page modules under `ui/pages/todos/` and `ui/pages/notes/` for state, forms, list browsers, and overlays.
- Reference only: `todos/model.js`, `notes/model.js`, `utils/create-list-model.js`.

## Dependencies and relationship with other plans

- Depends on shared foundation for action-bar, state composition, enriched snapshot conventions, overlay host, and `senda` copy gate.
- Can run in parallel with Board and Clocks after shared contracts stabilize.
- Conflicts with Board/Clocks if all are changing `ui/read-model.js`, `ui/types.ts`, or shell action-bar simultaneously.

## Dependency tree

| Task | Type | Owner previsto | Touched areas | Depends on | Blocks | Can parallel with | Conflicts with | global_test_safe_parallel | Validation scope | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TN-00 Senda pre-implementation copy gate | external-gate | senda | planned Todo/Notes visible copy | shared foundation copy direction | TN-05, TN-06, TN-07, TN-08 | none | n/a | unknown | copy direction report | medium |
| TN-01 Finalize Todo/Notes state shape | blocker | mini-kapa8 | `ui/types.ts`, Todo/Notes state modules | SF-02 | TN-02..TN-08 | Board/Clocks after shared contracts | shared types | no | type/state checks | high |
| TN-02 Enrich Todo/Notes snapshots | blocker | mini-kapa8 | `ui/read-model.js`, `ui/types.ts` | TN-01, SF-05 | TN-03..TN-08 | none while read model locked | Board/Clocks snapshot edits | no | read-model verification | high |
| TN-03 Build Todo action adapter | dependent | mini-kapa8 | `ui/todo-actions.js`, `todos/model.js` reference | SF-03 | TN-05 | Notes adapter | shared adapter convention | yes for local adapter only | adapter verification | medium |
| TN-04 Build Notes action adapter | dependent | mini-kapa8 | `ui/note-actions.js`, `notes/model.js` reference | SF-03 | TN-06 | Todo adapter | shared adapter convention | yes for local adapter only | adapter verification | medium |
| TN-05 Todo page interactive list/actions | dependent | mini-kapa8 | `ui/pages/todos/*` | TN-00, TN-02, TN-03, SF-04 | TN-09 | Notes page | action-bar if not stable | no | Todo UI verification | high |
| TN-06 Notes page interactive list/actions | dependent | mini-kapa8 | `ui/pages/notes/*` | TN-00, TN-02, TN-04, SF-04 | TN-09 | Todo page | action-bar if not stable | no | Notes UI verification | high |
| TN-07 Todo list-management overlays | dependent | mini-kapa8 | `ui/pages/todos/*`, Todo adapter | TN-00, TN-05 | TN-09 | Notes list overlays | shared list-management copy | no | Todo list workflow verification | medium |
| TN-08 Note list-management overlays | dependent | mini-kapa8 | `ui/pages/notes/*`, Notes adapter | TN-00, TN-06 | TN-09 | Todo list overlays | shared list-management copy | no | Note list workflow verification | medium |
| TN-09 Senda closure copy validation | external-gate | senda | implemented Todo/Notes visible copy | TN-05..TN-08 | TN-10 | none | n/a | unknown | copy closure report | medium |
| TN-10 Domain integration barrier | integration | mini-kapa8 | Todo/Notes + shared shell | TN-09 | master verification | none | full suites | no | integrated UI/domain checks | high |

## Execution waves

- Wave 1: TN-01 and TN-02 after shared foundation contracts are stable.
- Barrier: Confirm no other domain is editing `ui/read-model.js` or `ui/types.ts` concurrently.
- Wave 2: TN-03 and TN-04 may run in parallel because Todo and Notes adapters use separate models but share conventions.
- Barrier: Normalize adapter result shapes and error language before UI forms depend on them.
- External gate before UI implementation: TN-00 sends planned Todo/Notes copy direction to `senda` before TN-05..TN-08 start.
- Wave 3: TN-05 and TN-06 may run in parallel if action-bar slot is stable.
- Wave 4: TN-07 and TN-08 list-management overlays may run in parallel.
- External closure gate: `senda` validates implemented visible Todo/Notes copy.
- Final barrier: Integrate Todo/Notes into master verification after mini-kapa8 records evidence.

## Integration barriers

- Todo/Notes must not call `todos/tasks.js`, `todos/lists.js`, `notes/notes.js`, or `notes/lists.js` prompt flows directly.
- Todo/Notes mutators must rely on model hooks for sync.
- Removing active lists must preserve the CLI behavior of selecting a fallback current list when available.
- Empty states must stop saying to use CLI commands once UI action controls exist.
- Note content editing must not collapse multiline content into a single-line field.

## Copy visible and `senda` validation

Visible surfaces include:

- tab content headings;
- list names and current-list markers;
- task/note titles and detail labels;
- action-bar buttons;
- add/edit forms;
- note content editor placeholder;
- check/uncheck labels;
- remove confirmations;
- empty states;
- success and error messages.

Schedule `senda` before implementation for proposed copy direction and before Todo/Notes phase closure for final visible strings.

## Risks and decisions not taken

- Todo and Notes are similar but not identical; avoid over-abstracting before three real shared uses exist.
- Current `ListPanel` type is too small for full parity and must evolve carefully.
- Existing labels appear in CLI item prompts but label management is not registered in current CLI command flags; this plan does not expand scope to label CRUD.
- Deleting active lists can leave no current list; UI must mirror fallback behavior safely.
- Note content editor must preserve content and not leak internal storage paths.

## High-level acceptance criteria

- Todo tab supports full task list browsing and task add/details/edit/check-remove flows through visible UI controls.
- Todo tab supports todo list list/use/add/edit/remove flows.
- Notes tab supports full note browsing and note add/details/edit/remove flows through visible UI controls.
- Notes tab supports note list list/use/add/edit/remove flows.
- Item/list selection uses semantic `List` item identity, not coordinate math.
- Empty states and errors are user-facing and validated by `senda`.
- Sync is triggered by existing model mutators only.
- `ui/app.tsx` only wires delegation and does not contain Todo/Notes internals.

## Test inventory to be filled by mini-kapa8

Status: Filled by mini-kapa8 on 2026-06-05. This is an inventory for later implementation only; do not execute or implement these tests in the planning phase.

### Tests to modify or review

| File | Purpose of coverage | Wave | Fixtures / isolation | Risk |
| --- | --- | --- | --- | --- |
| `tests/ui-read-model.test.js` | Extend Todo/Notes snapshots with current list identity, all list summaries, item identities/positions, descriptions/content, done state, labels when present, and safe empty/error states. | Todo/Notes local after SF-05 | Fake list models whose mutators throw | High |
| `tests/ui-app.test.js` | Keep `ui/app.tsx` free of Todo/Notes CRUD internals while wiring only delegation/state/action-bar consumption. | Todo/Notes local and final integration | Static source checks | High |
| `tests/tasks.test.js`, `tests/todo-lists.test.js`, `tests/notes.test.js`, `tests/note-lists.test.js`, `tests/list-model-factory.test.js` | Review domain model behavior that UI adapters must preserve: add/edit/remove/use, fallback current list, check/uncheck, multiline note content, labels as existing data. | Todo/Notes local reference; final regression only after merge | Existing test fixtures; new temp data must use `./tmp` | Medium |

### Tests to create

| File | Purpose of coverage | Wave | Fixtures / isolation | Risk |
| --- | --- | --- | --- | --- |
| `tests/ui-todo-actions.test.js` | Todo adapter rejects empty/invalid titles and invalid selections before model calls; trims safe fields; preserves labels when present; converts model failures into safe user-facing errors. | Todo adapter local | Injected model fakes; no real HOME | High |
| `tests/ui-todo-actions.test.js` | Todo adapter calls existing model APIs for task add/details/edit/check/uncheck/remove and todo list list/use/add/edit/remove. | Todo adapter local | Model call recorder; no prompt modules | High |
| `tests/ui-todo-actions.test.js` | Removing active todo lists mirrors CLI fallback behavior and handles no-list-left state safely. | Todo adapter local | Fake list model variants | Medium |
| `tests/ui-note-actions.test.js` | Notes adapter validates note title/content, preserves multiline content, avoids collapsing content into one line, and returns safe errors without paths or stack traces. | Notes adapter local | Injected model fakes | High |
| `tests/ui-note-actions.test.js` | Notes adapter calls existing model APIs for note add/details/edit/remove and note list list/use/add/edit/remove. | Notes adapter local | Model call recorder; no prompt modules | High |
| `tests/ui-todo-notes-ui.test.js` | Todo page exposes visible/clickable actions for add/details/edit/check/remove and list management; keymaps remain fallback. | Todo UI local | Headless terminal render; semantic ids/events preferred | High |
| `tests/ui-todo-notes-ui.test.js` | Notes page exposes visible/clickable actions for add/details/edit/remove and list management; `Editor preserves multiline` content and does not collapse note bodies. | Notes UI local | Headless terminal render; fake adapters | High |
| `tests/ui-todo-notes-ui.test.js` | Empty states stop instructing users to use CLI once UI actions exist and copy remains user-facing. | Todo/Notes UI local, then `senda` closure | Headless render; copy text later validated by `senda` | Medium |
| `tests/ui-todo-notes-ui.test.js` | Item/list selection uses semantic `List` item identity rather than primary coordinate math. | Todo/Notes UI local | Node tree inspection or event payload assertions | High |

### Dependencies and gates

- Depends on shared foundation tests for action-bar, overlay, snapshot, and action-result contracts.
- `senda` must review Todo/Notes planned copy before UI tests harden visible labels, then review implemented copy before closure.
- Any HOME or file-backed fixture added during implementation must be rooted under `./tmp` inside the repo.
- Todo/Notes mutator tests must not expect direct calls to sync runtime; sync is model-hook driven.

### Final integration checks

- Re-run `tests/ui-read-model.test.js`, `tests/ui-app.test.js`, Todo/Notes UI tests, and model reference tests after integration with Board/Clocks because `ui/read-model.js` and `ui/types.ts` are shared.
- Run global `node --test` only after cross-domain shared type/snapshot edits are reconciled.
