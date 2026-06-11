# UI CLI Parity Sync Plan

> Planning-only document. Do not implement product code from this file until plan-reviewer has approved the plan set and mini-kapa8 has filled the test inventory section.

**Goal:** Add UI parity for `sync init/status/retry/enable/disable` while preserving existing TUI debounce and close-time flush behavior.

**Architecture:** Keep automatic sync status in the footer and add detailed sync operations through a visible utility/action surface. Use existing `sync/commands.js` functions or a safe UI adapter around them; do not rewrite sync runtime or manually call sync runtime from data mutators.

**Tech stack:** `ui/app.tsx` utility delegation, sync UI adapter/module, existing `sync/commands.js`, `sync/ilu-hooks.js`, `sync/index.js`, config/local-path utilities.

---

## Scope

- Show detailed sync status from UI.
- Retry pending sync from UI.
- Enable and disable sync from UI.
- Initialize sync with remote URL and branch form.
- Keep footer summary status active.
- Preserve debounced TUI sync behavior and flush-on-close.

## Non-scope

- No sync-core rewrite.
- No manual sync runtime calls after Todo/Notes/Board/Clocks mutations.
- No destructive remote operations beyond existing command behavior.
- No secret capture.
- No test inventory here.

## Current UI vs CLI state

- CLI sync subcommands are registered in `bin/configure-cli.js` and implemented in `sync/commands.js`.
- `sync/commands.js` handles init/status/retry/enable/disable.
- `sync/ilu-hooks.js` implements TUI-aware debounced sync status events and `flushPending`.
- Current UI subscribes to sync status and renders a summary in the footer.
- Current UI flushes pending debounced sync on session destroy.

## Proposed architecture and ownership

- Add a Sync utility view or overlay reachable through visible action controls without changing top nav.
- Add Sync runtime state for active operation, init form, detailed status, and safe errors.
- Add a sync UI adapter that calls existing `sync/commands.js` functions and converts results to safe UI state.
- Keep footer summary driven by `notifySync.onSyncStatus` and existing state labels.
- Do not trigger sync runtime from CRUD pages; Sync UI operations are explicit user commands and may call `sync/commands.js`.
- For `init`, surface remote URL/branch inputs and an explicit confirmation before starting.

## Probable files and areas

- Modify: shared utility host from foundation.
- Modify if needed: `ui/app.tsx` only for utility delegation.
- Modify if needed: `ui/components/Footer.tsx` for detailed status entry only if shared foundation chooses footer interaction.
- Create probable: `ui/sync-actions.js` or `ui/pages/sync/*` utility module.
- Create probable: sync overlay/form modules under `ui/pages/utilities/` or equivalent.
- Reference: `sync/commands.js`, `sync/ilu-hooks.js`, `sync/index.js`, sync tests under `tests/sync-*.test.js`.

## Dependencies and relationship with other plans

- Depends on shared foundation utility overlay/action surface.
- Shares footer/status semantics with Clocks and shared foundation.
- Can run alongside Babel/TTS only after utility overlay host is stable; both use global utility surface and can conflict on shared state.

## Dependency tree

| Task | Type | Owner previsto | Touched areas | Depends on | Blocks | Can parallel with | Conflicts with | global_test_safe_parallel | Validation scope | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SY-00 Senda pre-implementation copy gate | external-gate | senda | planned Sync visible copy | shared foundation copy direction | SY-02, SY-03, SY-04 | none | n/a | unknown | copy direction report | medium |
| SY-01 Define Sync UI state/adapter contract | blocker | mini-kapa8 | sync UI adapter, `ui/types.ts` | SF-06 | SY-02..SY-06 | none | Babel/TTS utility state | no | adapter/state checks | high |
| SY-02 Detailed status view | dependent | mini-kapa8 | sync utility view | SY-00, SY-01 | SY-05 | none | footer/status copy | no | status checks | medium |
| SY-03 Retry/enable/disable actions | dependent | mini-kapa8 | sync adapter/view | SY-00, SY-01 | SY-05 | none | shared sync operation state | no | command adapter checks | high |
| SY-04 Init form and confirmation | dependent | mini-kapa8 | sync init overlay | SY-00, SY-01 | SY-05 | none | remote/config state | no | isolated config/remote validation | high |
| SY-05 Footer/debounce preservation barrier | verification | mini-kapa8 | `ui/app.tsx`, `sync/ilu-hooks.js` interaction | SY-02..SY-04 | SY-07 | none | full UI/sync suites | no | debounce/flush verification | high |
| SY-06 Senda closure copy validation | external-gate | senda | implemented Sync visible copy | SY-02..SY-04 | SY-07 | none | n/a | unknown | copy closure report | medium |
| SY-07 Sync integration barrier | integration | mini-kapa8 | Sync + shared utility/footer | SY-05, SY-06 | master verification | none | global tests | no | integrated checks | high |

## Execution waves

- Wave 1: SY-01 adapter/state contract.
- Barrier: Confirm Sync operations are explicit user commands, not automatic CRUD hooks.
- External gate before UI implementation: SY-00 sends planned Sync copy direction to `senda` before SY-02..SY-04 start.
- Wave 2: SY-02 and SY-03.
- Wave 3: SY-04 init form after status/action contract is stable.
- Barrier: Validate footer/debounce/flush behavior selected by mini-kapa8 inventory.
- External closure gate: `senda` validates implemented Sync copy.
- Final barrier: Sync joins master integrated verification.

## Integration barriers

- Sync init must not run without explicit remote URL and confirmation.
- Status details must not expose hidden local paths or internal stack traces.
- Retry/enable/disable must be clear about current/pending state and failures.
- TUI debounced sync and flush-on-close behavior must remain unchanged.
- Sync UI must not add a top-nav tab.

## Copy visible and `senda` validation

Visible surfaces include:

- Sync status details;
- init form labels and branch default copy;
- retry/enable/disable buttons;
- confirmation language;
- failure/setup/pending/synced states;
- footer sync labels if changed.

Schedule `senda` before Sync implementation and before Sync phase closure.

## Risks and decisions not taken

- Sync init can affect remote/local data and must be validated with isolated HOME and test remotes later.
- The CLI init has a safety stop when both local data and remote history exist; UI must preserve that behavior.
- Footer status already has subtle language constraints; do not convert pending/setup into success/failure incorrectly.
- If utility host is not stable, Sync and Babel/TTS will collide on global overlay state.

## High-level acceptance criteria

- UI exposes sync status/retry/enable/disable/init through visible controls.
- Existing footer status continues to update from sync hook events.
- TUI debounce remains 5s and pending sync flushes on close.
- Sync init preserves existing safety constraints.
- Copy is validated by `senda`.
- No data-mutating domain UI calls sync runtime manually.

## Test inventory to be filled by mini-kapa8

Status: Filled by mini-kapa8 on 2026-06-05. This is an inventory for later implementation only; do not execute or implement these tests in the planning phase.

### Tests to modify or review

| File | Purpose of coverage | Wave | Fixtures / isolation | Risk |
| --- | --- | --- | --- | --- |
| `tests/sync-ilu-hooks.test.js` | Preserve TUI debounce, status events, and flush-on-close behavior while Sync UI is added. | Sync local and final integration | Fake timers/events only | High |
| `tests/sync-init-command.test.js`, `tests/sync-status-command.test.js`, `tests/sync-retry-command.test.js`, `tests/sync-ilu-adapter.test.js` | Review existing command behavior that Sync UI adapter must wrap without weakening safety. | Sync local reference | Existing command fakes; any new HOME/remote fixtures under `./tmp` | High |
| `tests/sync-local-remote.integration.test.js` | Use only at final Sync integration barrier; ensure any local remote/HOME fixtures are repo-local under `./tmp`. | Final integration only | Local test remote under `./tmp`, never a real external remote | High |
| `tests/ui-app.test.js` | Ensure Sync utility does not add a top-nav tab and footer summary still updates from sync hook events. | Sync local and final footer integration | Headless render with fake sync events | High |
| `tests/sync-list-model-hook.test.js`, `tests/sync-board-hook.test.js`, `tests/sync-clock-hook.test.js` | Review that data mutators trigger sync through model hooks; UI domain adapters must not call sync runtime manually. | Final integration after domain adapters exist | Isolated data under `./tmp` if new cases are added | High |

### Tests to create

| File | Purpose of coverage | Wave | Fixtures / isolation | Risk |
| --- | --- | --- | --- | --- |
| `tests/ui-sync-actions.test.js` | Sync adapter maps status output into safe UI state and redacts/omits local paths, stack traces, and remote internals from errors. | Sync adapter local | Fake `sync/commands.js` functions; no real remote | High |
| `tests/ui-sync-actions.test.js` | Retry, enable, and disable actions call injected command functions only after explicit user action and report pending/success/failure states clearly. | Sync adapter local | Command fakes and call recorder | High |
| `tests/ui-sync-actions.test.js` | Init rejects missing remote URL, missing branch, and missing confirmation before command call. | Sync adapter local | Fake command functions | High |
| `tests/ui-sync-actions.test.js` | Init accepts only isolated local/test remote fixtures in tests; any path-based remote must be created under `./tmp` inside the repo. | Sync adapter local or final integration | Repo-local `./tmp` fixture; no network | High |
| `tests/ui-sync-ui.test.js` | Sync utility overlay is reachable from visible controls, shows detailed status, and closes via `Esc` without exiting the app first. | Sync UI local | Headless render/session; fake adapter | Medium |
| `tests/ui-sync-ui.test.js` | Init form shows remote URL/branch and confirmation copy, but no secret fields and no unmasked credential capture. | Sync UI local | Headless render; no secrets | High |
| `tests/ui-sync-ui.test.js` | Retry/enable/disable buttons reflect current operation state and prevent duplicate concurrent operations. | Sync UI local | Fake operation state | Medium |
| `tests/ui-sync-ui.test.js` | Footer summary still uses hook-driven status and does not confuse setup/pending/synced/failure states. | Sync UI local and final integration | Fake sync events | High |

### Dependencies and gates

- Depends on shared utility overlay host.
- `senda` must review Sync copy before implementation and before closure, especially setup, pending, failure, and init confirmation copy.
- Sync tests must use `no real external remote`: no real remotes, real credentials, real network calls, or external services.
- No data-mutating Todo/Notes/Board/Clocks UI test should require manual sync runtime calls.

### Final integration checks

- Run Sync local tests after utility host is stable.
- Run sync local-remote integration only after all Sync code is integrated and the repo-local `./tmp` remote fixture is prepared.
- Run global `node --test` only after Sync, Clocks footer work, and utility overlay conflicts are resolved.
