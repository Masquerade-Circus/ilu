# UI CLI Parity Board Plan

> Planning-only document. Do not implement product code from this file until plan-reviewer has approved the plan set and mini-kapa8 has filled the test inventory section.

**Goal:** Complete Board UI parity for board collection management and remaining column operations while preserving existing card/column behavior.

**Architecture:** Continue to keep Board internals in `ui/pages/board/*` and `ui/board-actions.js`. Extend the existing Board page state and adapters surgically rather than moving behavior into `ui/app.tsx`.

**Tech stack:** `ui/pages/board/*`, `ui/board-actions.js`, `ui/read-model.js`, `ui/types.ts`, existing `scrumban/model.js`, `scrumban/board.js`, `scrumban/board-lists.js`.

---

## Scope

- Preserve current Board show/switch/card add/details/edit/move/priority/remove behavior.
- Complete board collection workflows: list/use/add/edit/remove.
- Complete column workflows: add, reset simple default, rename, set WIP, make default, move left/right, remove.
- Surface WIP/default constraints and safe errors in the UI.
- Keep Board action bar contextual and fixed above footer.
- Preserve `List` virtualization and semantic card identity.

## Non-scope

- No content-aware column-width policy change.
- No root CLI or model rewrite.
- No manual sync runtime call.
- No test inventory in this plan.

## Current UI vs CLI state

- CLI Board supports cards, columns, board list/use/add/edit/remove.
- `scrumban/model.js` already exposes `columns.setDefault`, `columns.resetSimpleDefault`, WIP handling through `columns.edit`, board `add/save/remove/use`, and card operations.
- Current UI Board has rich rendering, `List`-driven card selection, Board action bar, card overlays, and column add/rename/move/remove.
- `ui/board-actions.js` currently adapts several card and column operations but lacks board add/edit/remove, reset default columns, set WIP, and make default.
- Current UI board selector can switch existing boards using `useBoard` but does not manage board collection CRUD.

## Proposed architecture and ownership

- Keep Board runtime state under `AppState.board` / `BoardRuntimeState`.
- Extend Board overlay states inside `ui/pages/board/MainView.tsx` or split focused Board overlay modules if size becomes a barrier.
- Extend `BoardActions` in `ui/types.ts` and implementation in `ui/board-actions.js` for missing operations.
- Keep board collection forms in Board page modules.
- Keep board summaries in `ui/read-model.js` with stable ids, current marker, title, and optional description if needed for details/edit.
- Maintain action bar as the primary visible command surface; key bindings remain fallback.
- Use `Overlay` with margin and `trapFocus` for board-management forms and confirmations.

## Probable files and areas

- Modify: `ui/types.ts`
- Modify: `ui/read-model.js`
- Modify: `ui/board-actions.js`
- Modify or split: `ui/pages/board/MainView.tsx`
- Modify if needed: `ui/pages/board/BoardActionBar.tsx`
- Modify if needed: `ui/pages/board/BoardColumn.tsx`
- Reference: `scrumban/model.js`, `scrumban/board-lists.js`, `scrumban/board.js`
- Existing tests to be considered by mini-kapa8 inventory: `tests/ui-app.test.js`, `tests/ui-board-actions.test.js`, `tests/ui-read-model.test.js`, `tests/board*.test.js`, `tests/scrumban-model.test.js`.

## Dependencies and relationship with other plans

- Depends on shared foundation for action-bar and snapshot contracts.
- Can run in parallel with Todo/Notes and Clocks only after shared `ui/types.ts`/`ui/read-model.js` edits are settled.
- Sync hooks are triggered by `scrumban/model.js`; do not coordinate directly with Sync plan except for status UI integration.

## Dependency tree

| Task | Type | Owner previsto | Touched areas | Depends on | Blocks | Can parallel with | Conflicts with | global_test_safe_parallel | Validation scope | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BD-00 Senda pre-implementation copy gate | external-gate | senda | planned Board visible copy | shared foundation copy direction | BD-03, BD-04, BD-05, BD-06 | none | n/a | unknown | copy direction report | medium |
| BD-01 Extend Board snapshot and types | blocker | mini-kapa8 | `ui/read-model.js`, `ui/types.ts` | SF-05 | BD-02..BD-08 | none while shared types locked | Todo/Notes/Clocks snapshot edits | no | snapshot/type checks | high |
| BD-02 Extend Board action adapter | blocker | mini-kapa8 | `ui/board-actions.js`, `ui/types.ts` | SF-03, BD-01 | BD-03..BD-08 | none | existing Board adapter tests | no | adapter verification | high |
| BD-03 Board collection list/use/add/edit/remove UI | dependent | mini-kapa8 | `ui/pages/board/*` | BD-00, BD-01, BD-02, SF-04 | BD-09 | Column UI if distinct files | Board main view shared state | no | Board collection UI checks | high |
| BD-04 Column reset default UI | dependent | mini-kapa8 | `ui/pages/board/*`, `ui/board-actions.js` | BD-00, BD-02 | BD-09 | BD-05 if state separated | column action surface | no | Board column checks | medium |
| BD-05 Column WIP/default UI | dependent | mini-kapa8 | `ui/pages/board/*`, `ui/board-actions.js` | BD-00, BD-02 | BD-09 | BD-04 if state separated | column action surface | no | Board column checks | high |
| BD-06 Remove/move constraints and error surfacing | dependent | mini-kapa8 | Board page/action adapter | BD-00, BD-03..BD-05 | BD-09 | none | Board error overlay | no | constraint checks | medium |
| BD-07 Existing card flow regression guard | verification | mini-kapa8 | Board UI/action tests | BD-03..BD-06 | BD-09 | none | full Board suite | no | Board regression checks | high |
| BD-08 Senda closure copy validation | external-gate | senda | implemented Board copy | BD-03..BD-06 | BD-09 | none | n/a | unknown | copy closure report | medium |
| BD-09 Board integration barrier | integration | mini-kapa8 | Board + shared shell | BD-07, BD-08 | master verification | none | global tests | no | integrated UI checks | high |

## Execution waves

- Wave 1: BD-01 and BD-02 as a single Board contract wave.
- Barrier: Confirm no Board internals are added to `ui/app.tsx` and no shared snapshot conflict remains.
- External gate before UI implementation: BD-00 sends planned Board copy direction to `senda` before BD-03..BD-06 start.
- Wave 2: BD-03 board collection management.
- Wave 3: BD-04 and BD-05 column gaps; split only if overlay/state files are independent.
- Barrier: Confirm column action copy and constraints before finalizing.
- Wave 4: BD-06 and BD-07 regression guard.
- External closure gate: `senda` validates implemented Board copy before closure.
- Final barrier: Board output joins master integrated verification.

## Integration barriers

- Board action bar must remain contextual and above footer.
- Board selector/manager must not add a top-nav item.
- Existing card overlays must keep `trapFocus` and `Esc` close behavior.
- Reset default columns must respect existing model rule: no reset while board has cards.
- Remove column must respect existing model constraints: cannot remove non-empty/default column.
- Set WIP must not allow invalid values or obscure WIP-limit failures.

## Copy visible and `senda` validation

Visible surfaces include:

- board selector labels;
- board management actions;
- add/edit/remove board overlays;
- column action surfaces;
- WIP/default labels;
- reset default confirmation and blocked state;
- column remove blocked state;
- card/column error messages.

Schedule `senda` before Board implementation and before Board phase closure.

## Risks and decisions not taken

- `ui/pages/board/MainView.tsx` is already large; implementation may need surgical splits to avoid an unmaintainable file.
- Board collection management and column management share overlay state; unsafe parallel edits can conflict.
- Existing tests assert Board internals are delegated out of `ui/app.tsx`; changes must preserve that constraint.
- WIP-limit behavior has model-side cascading/move semantics; UI must not invent conflicting rules.
- Reset default can be destructive to columns if misused; UI must surface the existing no-cards constraint clearly.

## High-level acceptance criteria

- Board tab preserves all existing implemented card behavior.
- UI supports board list/use/add/edit/remove via visible controls.
- UI supports column reset default, set WIP, make default, move left/right, add, rename, and remove.
- Board operations use safe action results and user-facing errors.
- Board selection uses semantic ids and `List` events, not primary coordinate math.
- Board copy is validated by `senda`.
- `ui/app.tsx` remains free of Board internals.

## Test inventory to be filled by mini-kapa8

Status: Filled by mini-kapa8 on 2026-06-05. This is an inventory for later implementation only; do not execute or implement these tests in the planning phase.

### Tests to modify or review

| File | Purpose of coverage | Wave | Fixtures / isolation | Risk |
| --- | --- | --- | --- | --- |
| `tests/ui-board-actions.test.js` | Extend adapter coverage for board list/use/add/edit/remove, column reset simple default, set WIP, make default, move left/right, remove, and safe error conversion. | Board local | Injected board model fakes; no real HOME | High |
| `tests/ui-read-model.test.js` | Extend Board snapshot with board summaries, current marker, stable ids, optional descriptions, column default/WIP metadata, and no mutator calls during reads. | Board local after SF-05 | Fake board model whose mutators throw | High |
| `tests/ui-app.test.js` | Preserve Board delegation out of `ui/app.tsx`, modal `trapFocus`, semantic card/list behavior, footer/action-bar placement. | Board local and final integration | Static source checks plus headless render | High |
| `tests/board.test.js`, `tests/board-lists.test.js`, `tests/scrumban-model.test.js`, `tests/board-renderer.test.js`, `tests/board-priority-prompt.test.js` | Review existing model and renderer constraints for reset default, WIP, default columns, non-empty column removal, card moves, and priority behavior. | Board local reference; final regression after merge | Existing fixtures; any new HOME data must use `./tmp` | Medium |

### Tests to create

| File | Purpose of coverage | Wave | Fixtures / isolation | Risk |
| --- | --- | --- | --- | --- |
| `tests/ui-board-management-ui.test.js` | Board collection manager shows list/use/add/edit/remove through visible controls without adding a top-nav tab. | Board UI local | Headless terminal render; fake Board actions | High |
| `tests/ui-board-management-ui.test.js` | Board add/edit/remove overlays use bounded `Overlay`, trap focus, close via `Esc`, and keep action bar above footer at 80x24. | Board UI local | 80x24 render fixture | High |
| `tests/ui-board-management-ui.test.js` | Board selector uses semantic board identity and accepts numeric/string iludb ids without lossy coercion. | Board UI local | Event payload assertions, not coordinate math | Medium |
| `tests/ui-board-column-parity.test.js` | Column reset simple default is visible, confirmed, blocked when cards exist, and reports safe copy. | Board UI local | Fake model states; no destructive real data | High |
| `tests/ui-board-column-parity.test.js` | Column WIP/default workflows validate invalid values before model calls and surface model constraint failures safely. | Board UI local | Fake model call recorder | High |
| `tests/ui-board-card-regression.test.js` | Existing card add/details/edit/move/priority/remove flows still work after board/column parity additions. | Board local regression and final integration | Headless UI with fake snapshots/actions | High |

### Dependencies and gates

- Depends on shared action-result, action-bar, and snapshot contracts.
- `senda` must review Board copy before implementation and before closure, especially destructive reset/remove copy and WIP/default labels.
- Board tests must keep `clickAt` or coordinate helpers as secondary smoke only; primary behavior should assert semantic `List` ids/events.
- Board mutators must rely on existing model sync hooks and must not call sync runtime manually.

### Final integration checks

- Re-run Board UI/action tests after Todo/Notes and Clocks merge if `ui/read-model.js`, `ui/types.ts`, or action-bar code changed.
- Run global `node --test` only after all Board, shared, and domain conflicts are resolved.
