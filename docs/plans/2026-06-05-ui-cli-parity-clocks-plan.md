# UI CLI Parity Clocks Plan

> Planning-only document. Do not implement product code from this file until plan-reviewer has approved the plan set and mini-kapa8 has filled the test inventory section.

**Goal:** Bring the Clocks tab to parity with normal CLI clock list/add/priority/remove while preserving compact footer clocks.

**Architecture:** Keep footer clocks as compact read-only status. Put full clock management in the Clocks page with its own action adapter, page state, timezone chooser, and visible controls.

**Tech stack:** `ui/pages/clocks/*`, `ui/read-model.js`, `ui/types.ts`, existing `clocks/model.js`, timezone validation using `Intl` behavior already used by CLI.

---

## Scope

- Show full clock list in Clocks tab with names, times, and timezone metadata.
- Add clock with timezone selection/search and required name.
- Remove one or more clocks.
- Reorder clocks by priority.
- Preserve footer behavior: sync status left, compact clock times right, no clock names in footer.

## Non-scope

- No new top-nav item.
- No changing footer compact-clocks policy.
- No manual sync runtime calls; `clocks/model.js` triggers sync hook.
- No test inventory here.

## Current UI vs CLI state

- CLI clock command supports add, show, priority, and remove.
- `clocks/model.js` supports `find`, `get`, `add`, `remove`, and `move`, and calls sync hook after persistence.
- Current Clocks UI page renders limited read-only lines.
- Footer already renders compact clock times without names and has 80-column checks.

## Proposed architecture and ownership

- Enrich `ClockSnapshot` with stable positions and timezone values for UI identity.
- Add a clock action adapter under `ui/` or `ui/pages/clocks/` that calls `clocks/model.js` and returns safe UI action results.
- Add Clocks runtime state for selected clock(s), add form, remove confirmation, and priority/reorder mode.
- Use `List` for full clock list selection and priority source/target selection.
- Use an `Input`-based timezone filter and a `List` of timezone choices, mirroring CLI search behavior without relying on Inquirer.
- Keep footer rendering unchanged except for consuming enriched snapshots safely.

## Probable files and areas

- Modify: `ui/types.ts`
- Modify: `ui/read-model.js`
- Modify: `ui/pages/clocks/MainView.tsx`
- Create probable: `ui/clock-actions.js` or `ui/pages/clocks/actions.js`
- Create probable: `ui/pages/clocks/ClockList.tsx`, `ClockForm.tsx`, `ClockPriority.tsx`, or equivalent focused modules.
- Reference: `clocks/model.js`, `clocks/clocks.js` for CLI behavior.
- Keep: `ui/components/Footer.tsx` footer semantics.

## Dependencies and relationship with other plans

- Depends on shared foundation for action-bar, state composition, overlays, and snapshot shape.
- Can run in parallel with Todo/Notes or Board only after `ui/read-model.js` and `ui/types.ts` contracts are stable.
- Footer conflicts with Sync if both alter footer status line; synchronize through shared foundation.

## Dependency tree

| Task | Type | Owner previsto | Touched areas | Depends on | Blocks | Can parallel with | Conflicts with | global_test_safe_parallel | Validation scope | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CL-00 Senda pre-implementation copy gate | external-gate | senda | planned Clocks visible copy | shared foundation copy direction | CL-03, CL-04, CL-05, CL-06 | none | n/a | unknown | copy direction report | medium |
| CL-01 Enrich clock snapshot/types | blocker | mini-kapa8 | `ui/read-model.js`, `ui/types.ts` | SF-05 | CL-02..CL-06 | none while shared types locked | Todo/Notes/Board snapshot edits | no | snapshot/type checks | medium |
| CL-02 Build clock action adapter | dependent | mini-kapa8 | clock adapter, `clocks/model.js` reference | SF-03 | CL-03..CL-06 | none | shared adapter convention | yes for local adapter only | adapter verification | medium |
| CL-03 Full clock list UI | dependent | mini-kapa8 | `ui/pages/clocks/*` | CL-00, CL-01, SF-04 | CL-04..CL-06 | none | Clocks page shared state | no | Clocks render checks | medium |
| CL-04 Add clock workflow | dependent | mini-kapa8 | Clocks form/overlay | CL-00, CL-02, CL-03 | CL-07 | CL-05 if state separated | timezone form state | no | add workflow checks | high |
| CL-05 Remove clock workflow | dependent | mini-kapa8 | Clocks remove overlay | CL-00, CL-02, CL-03 | CL-07 | CL-04 if state separated | selected clocks state | no | remove workflow checks | medium |
| CL-06 Priority workflow | dependent | mini-kapa8 | Clocks priority UI | CL-00, CL-02, CL-03 | CL-07 | none | selected/reorder state | no | reorder workflow checks | medium |
| CL-07 Footer regression barrier | verification | mini-kapa8 | `ui/components/Footer.tsx`, Clocks page | CL-04..CL-06 | CL-08 | none | footer with Sync plan | no | footer width/compact checks | high |
| CL-08 Senda closure copy validation | external-gate | senda | implemented Clocks visible copy | CL-03..CL-07 | CL-09 | none | n/a | unknown | copy closure report | medium |
| CL-09 Clocks integration barrier | integration | mini-kapa8 | Clocks + shared shell/footer | CL-08 | master verification | none | global tests | no | integrated checks | medium |

## Execution waves

- Wave 1: CL-01 and CL-02 after shared foundation.
- Barrier: Confirm footer contract remains unchanged.
- External gate before UI implementation: CL-00 sends planned Clocks copy direction to `senda` before CL-03..CL-06 start.
- Wave 2: CL-03 list UI.
- Wave 3: CL-04, CL-05, and CL-06; parallel only if implementation splits independent overlay modules and shared state is already stable.
- Barrier: Run footer regression validation chosen by mini-kapa8 inventory.
- External closure gate: `senda` validates implemented Clocks copy.

## Integration barriers

- Footer compact clocks must not show names.
- Clocks page can show names and timezones.
- Add workflow must validate IANA timezone and required name before model mutation.
- Remove workflow must not remove all clocks accidentally without explicit visible confirmation.
- Priority workflow requires at least two clocks to be meaningful.

## Copy visible and `senda` validation

Visible surfaces include:

- Clocks list headings;
- empty state;
- add form labels/placeholders;
- timezone search labels;
- remove confirmation;
- priority/reorder instructions;
- success/error messages;
- footer compact status if changed.

Schedule `senda` before Clocks implementation and before Clocks phase closure.

## Risks and decisions not taken

- Timezone search can be large; keep results bounded and avoid heavy work inside render loops.
- Footer width is sensitive at 80 columns and must not regress.
- `Intl.supportedValuesOf` may be unavailable; mirror CLI fallback behavior.
- Remove-all behavior exists in the model when no index is passed, but UI should prefer explicit multi-selection to avoid surprise.

## High-level acceptance criteria

- Clocks tab supports list/add/remove/priority workflows through visible controls.
- Footer still shows compact times without names and stays within 80 columns.
- Clock mutators call existing model APIs and trigger sync hooks indirectly.
- Timezone validation mirrors CLI behavior at a high level.
- Copy is validated by `senda`.

## Test inventory to be filled by mini-kapa8

Status: Filled by mini-kapa8 on 2026-06-05. This is an inventory for later implementation only; do not execute or implement these tests in the planning phase.

### Tests to modify or review

| File | Purpose of coverage | Wave | Fixtures / isolation | Risk |
| --- | --- | --- | --- | --- |
| `tests/ui-read-model.test.js` | Extend Clocks snapshot with stable positions, names, timezones, display time, invalid timezone fallback, and no mutator calls during reads. | Clocks local after SF-05 | Fake clock model whose mutators throw | Medium |
| `tests/ui-app.test.js` | Preserve footer contract: sync status left, compact clock times right, no clock names, no overdraw at 80 columns. | Clocks local and final footer integration | Headless render at 80x24 | High |
| `tests/clocks.test.js`, `tests/sync-clock-hook.test.js` | Review model behavior for add/remove/move and sync-hook side effects driven by model mutators. | Clocks local reference; final regression after merge | Existing fixtures; any new HOME data must use `./tmp` | Medium |

### Tests to create

| File | Purpose of coverage | Wave | Fixtures / isolation | Risk |
| --- | --- | --- | --- | --- |
| `tests/ui-clock-actions.test.js` | Clock adapter rejects missing names, invalid timezones, invalid indexes, and impossible priority moves before model calls. | Clocks adapter local | Injected model fakes | High |
| `tests/ui-clock-actions.test.js` | Clock adapter calls `clocks/model.js`-compatible APIs for add, remove, and move/reorder with safe normalized payloads. | Clocks adapter local | Model call recorder | Medium |
| `tests/ui-clock-actions.test.js` | Clock adapter converts thrown model failures into safe user-facing errors without local paths or stack traces. | Clocks adapter local | Throwing fake model | Medium |
| `tests/ui-clocks-ui.test.js` | Clocks page shows full list with names, times, and timezone metadata while footer still omits names. | Clocks UI local | Headless render at 80x24 | High |
| `tests/ui-clocks-ui.test.js` | Add workflow exposes required name input, timezone search/filter, bounded timezone result list, and validation before mutation. | Clocks UI local | Fake timezone list; no heavy work in render assertions | High |
| `tests/ui-clocks-ui.test.js` | Remove workflow requires explicit visible confirmation and avoids accidental remove-all behavior. | Clocks UI local | Fake selected clock state | High |
| `tests/ui-clocks-ui.test.js` | Priority workflow handles fewer than two clocks as a safe disabled/empty state and uses semantic selection for source/target. | Clocks UI local | Fake snapshots | Medium |
| `tests/ui-clocks-ui.test.js` | `Intl.supportedValuesOf` absence follows the same high-level fallback behavior as CLI search. | Clocks UI local | Temporarily injected/faked `Intl` capability; restore after test | Medium |

### Dependencies and gates

- Depends on shared action-bar and overlay contracts.
- `senda` must review Clocks copy before implementation and before closure, including timezone validation and remove/priority instructions.
- Any HOME or file-backed fixture must live under `./tmp` inside the repo.
- Clock mutator tests must expect model-hook sync behavior only; no UI code should call sync runtime manually.

### Final integration checks

- Re-run footer regression after Sync merges because both touch footer/status semantics.
- Re-run 80x24 render checks after every change to shared action bars, overlays, or footer.
- Run global `node --test` only after Clocks and Sync footer conflicts are resolved.
