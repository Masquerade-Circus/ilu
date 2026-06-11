# UI CLI Parity Babel and TTS Plan

> Planning-only document. Do not implement product code from this file until plan-reviewer has approved the plan set and mini-kapa8 has filled the test inventory section.

**Goal:** Add UI parity for Babel translation and TTS workflows without adding top-nav tabs or exposing secrets.

**Architecture:** Implement Babel and TTS as global utility workflows reachable from visible UI controls. Use focused UI adapters around existing `translate` and `tts` services; keep service internals out of `ui/app.tsx`.

**Tech stack:** shared utility overlay host, `translate/index.js`, `tts/index.js`, Valyrian `Input`, `Editor`, `Button`, `List`, `Overlay`, `FocusScope`, existing clipboard and OpenAI/ffmpeg service paths.

---

## Scope

- Babel:
  - translate user-provided text;
  - choose source and target languages at least to the level supported by CLI options;
  - copy translation to clipboard through existing translation service behavior or a safe adapter;
  - display dictionary entries when provider returns them.
- TTS:
  - collect input `.txt`/`.md` path and output audio path;
  - run conversion through existing TTS service when credentials/config are available;
  - select and persist default voice;
  - surface progress/blocking/result/error states safely.
- Keep both workflows off top nav.

## Non-scope

- No new top-nav entries.
- No API-key display or unmasked secret capture in terminal UI.
- No rewrite of translation provider or TTS chunk/ffmpeg implementation.
- No test inventory here.

## Current UI vs CLI state

- CLI Babel command is registered in `bin/configure-cli.js` and implemented by `translate/index.js`.
- `translate/index.js` validates max length, calls provider, writes translated text to clipboard, logs translation and dictionary entries.
- CLI TTS command and `tts voice` are registered in `bin/configure-cli.js`.
- `tts/index.js` validates input extension, reads files, resolves/stores API key, chunks text, calls OpenAI speech, merges chunks via ffmpeg, cleans up, and can persist default voice.
- UI currently has no Babel or TTS surface.
- Valyrian source types show current `Input` has no masked-secret prop; TTS API-key entry must not be implemented as visible text input.

## Proposed architecture and ownership

- Add a utility workflow entry through the shared action-bar/overlay host from the foundation plan.
- Add `Babel` and `TTS` substates under a utility state object, not top-level ad hoc shell booleans.
- Add focused action adapters:
  - Babel adapter around `translate.createTranslator` or default translator behavior with injectable clipboard/provider for tests.
  - TTS adapter around `tts.createTtsService` and exported helper functions.
- Keep long-running TTS operation state explicit: idle, validating, running, completed, failed.
- For TTS API key:
  - if a key is already configured, allow conversion;
  - if missing, show safe setup guidance or use a separately reviewed secure prompt path;
  - do not render or store a raw API key through normal Valyrian `Input`.
- Use `Editor` for Babel input text because translation can be multiword/multiline.
- Use `List` for voice selection from `SUPPORTED_VOICES`.

## Probable files and areas

- Modify: shared utility host from foundation.
- Modify: `ui/types.ts` for utility state/result shapes.
- Create probable: `ui/babel-actions.js` or utility adapter module.
- Create probable: `ui/tts-actions.js` or utility adapter module.
- Create probable: utility view modules under `ui/pages/utilities/`, `ui/pages/babel/`, or `ui/pages/tts/` depending on foundation's module layout.
- Reference: `translate/index.js`, `tts/index.js`, `tests/tts.test.js`.
- Avoid changes to root CLI registration except if implementation later finds a compatibility bug unrelated to UI parity.

## Dependencies and relationship with other plans

- Depends on shared foundation utility overlay/action surface.
- Can run in parallel with Sync only after utility host state is stable and ownership boundaries are split.
- TTS secret handling may require a security review or explicit decision before implementation.

## Dependency tree

| Task | Type | Owner previsto | Touched areas | Depends on | Blocks | Can parallel with | Conflicts with | global_test_safe_parallel | Validation scope | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BT-00 Senda pre-implementation copy gate | external-gate | senda | planned Babel/TTS visible copy | shared foundation copy direction | BT-04, BT-05, BT-06, BT-07 | none | n/a | unknown | copy direction report | medium |
| BT-01 Define utility state and adapter contracts | blocker | mini-kapa8 | `ui/types.ts`, utility modules | SF-06 | BT-02..BT-07 | Sync after host stable | Sync utility state | no | state/adapter checks | high |
| BT-02 Babel adapter | dependent | mini-kapa8 | Babel adapter, `translate/index.js` reference | BT-01 | BT-04 | TTS adapter | shared utility result contract | yes for local adapter only | adapter verification | medium |
| BT-03 TTS adapter and secret-safe preflight | blocker | mini-kapa8 + possible security review | TTS adapter, `tts/index.js` reference | BT-01 | BT-05, BT-06 | Babel adapter | secret/config behavior | no | adapter/preflight checks | high |
| BT-04 Babel UI workflow | dependent | mini-kapa8 | Babel utility view | BT-00, BT-02, SF-04 | BT-08 | TTS UI after utility state split | utility overlay copy | no | Babel UI checks | medium |
| BT-05 TTS conversion UI workflow | dependent | mini-kapa8 | TTS utility view | BT-00, BT-03, SF-04 | BT-08 | Babel UI after utility state split | long-running operation state | no | TTS UI checks | high |
| BT-06 TTS voice selection workflow | dependent | mini-kapa8 | TTS voice view | BT-00, BT-03 | BT-08 | Babel UI | TTS state | no | voice selection checks | medium |
| BT-07 Utility error/result surfaces | dependent | mini-kapa8 | Babel/TTS UI modules | BT-00, BT-04..BT-06 | BT-08 | none | shared utility errors | no | safe-copy checks | medium |
| BT-08 Senda closure copy validation | external-gate | senda | implemented Babel/TTS visible copy | BT-04..BT-07 | BT-09 | none | n/a | unknown | copy closure report | medium |
| BT-09 Babel/TTS integration barrier | integration | mini-kapa8 | utility host + adapters | BT-08 | master verification | none | global tests | no | integrated utility checks | high |

## Execution waves

- Wave 1: BT-01 utility contract.
- Wave 2: BT-02 and BT-03; BT-03 may require a security-sensitive decision before UI conversion work.
- Barrier: Confirm how missing TTS API key is handled without unmasked UI secret capture.
- External gate before UI implementation: BT-00 sends planned Babel/TTS copy direction to `senda` before BT-04..BT-07 start.
- Wave 3: BT-04 Babel UI and BT-06 voice selection may run in parallel if utility state is split.
- Wave 4: BT-05 TTS conversion UI after TTS adapter/preflight is resolved.
- Wave 5: BT-07 error/result surfaces.
- External closure gate: `senda` validates implemented Babel/TTS copy.
- Final barrier: Babel/TTS joins master integrated verification.

## Integration barriers

- Babel/TTS must not add top-nav tabs.
- TTS must not show, log, or store API keys through visible input.
- TTS conversion should not block UI cleanup or leave stale progress if cancelled or failed.
- Babel should preserve the max-character validation behavior from CLI.
- Clipboard copy should produce a clear user-facing outcome without exposing clipboard internals.

## Copy visible and `senda` validation

Visible surfaces include:

- utility entry labels;
- Babel source/target/text labels;
- translate/copy result labels;
- dictionary headings;
- TTS input/output path labels;
- voice selector labels;
- missing credential guidance;
- conversion progress/result/failure messages;
- cancel/close labels.

Schedule `senda` before Babel/TTS implementation and before Babel/TTS phase closure.

## Risks and decisions not taken

- Current Valyrian `Input` does not expose masked secret entry; TTS API-key setup is not safe as a normal UI input.
- TTS can be long-running and uses filesystem, OpenAI, and ffmpeg; UI must make progress/failure states clear.
- Babel provider/clipboard behavior may depend on external services and desktop clipboard availability.
- Utility overlay host shared with Sync can become crowded; keep workflow selection compact.
- File paths are user-provided but errors must not leak unrelated internals.

## High-level acceptance criteria

- UI exposes Babel translation with result display, copy confirmation, and dictionary display when available.
- UI exposes TTS voice selection and file conversion when configuration is available.
- Missing TTS credentials are handled safely without unmasked secret entry.
- Babel/TTS workflows are visible/clickable and not top-nav tabs.
- Copy is validated by `senda`.
- `ui/app.tsx` only delegates utility host behavior.

## Test inventory to be filled by mini-kapa8

Status: Filled by mini-kapa8 on 2026-06-05. This is an inventory for later implementation only; do not execute or implement these tests in the planning phase.

### Tests to modify or review

| File | Purpose of coverage | Wave | Fixtures / isolation | Risk |
| --- | --- | --- | --- | --- |
| `tests/tts.test.js` | Review TTS service behavior for file extension validation, voice support, chunk/merge flow, API-key resolution, and cleanup expectations. UI adapter must use fakes for external work. | Babel/TTS local reference; final regression if TTS adapter touches service boundaries | Existing fixtures; new file input/output fixtures under `./tmp` | High |
| `tests/ui-app.test.js` | Ensure Babel/TTS utility entry does not add top-nav tabs and remains delegated through utility host, not domain logic in `ui/app.tsx`. | Babel/TTS local and final utility integration | Static and headless render checks | High |
| `tests/cli-registration.test.js` | Review CLI registration only as a guard; UI parity should not require root CLI registration changes. | Final regression if any CLI registration concern appears | No external calls | Low |

### Tests to create

| File | Purpose of coverage | Wave | Fixtures / isolation | Risk |
| --- | --- | --- | --- | --- |
| `tests/ui-babel-actions.test.js` | Babel adapter validates max length, source/target language options, empty text, and provider failures before UI state treats them as success. | Babel adapter local | Fake translator/provider; no network | Medium |
| `tests/ui-babel-actions.test.js` | Babel adapter exposes translated text, dictionary entries, and copy result using injectable fake clipboard behavior. | Babel adapter local | Fake clipboard; no desktop clipboard dependency | Medium |
| `tests/ui-babel-actions.test.js` | Babel adapter converts provider/clipboard failures into safe user-facing errors without provider internals. | Babel adapter local | Throwing fakes | Medium |
| `tests/ui-tts-actions.test.js` | TTS adapter preflight rejects missing configured API key with safe setup guidance and never requests or stores an API key through normal UI input. | TTS adapter local | Fake config/service; no API key | High |
| `tests/ui-tts-actions.test.js` | TTS adapter validates input extension, input existence, output path shape, and supported voice before conversion call. | TTS adapter local | Synthetic `.txt`/`.md` fixtures under `./tmp` | High |
| `tests/ui-tts-actions.test.js` | TTS adapter reports running/completed/failed states with safe errors and no OpenAI, ffmpeg, filesystem internals, or raw paths beyond user-selected paths. | TTS adapter local | Fake TTS service; no OpenAI or ffmpeg | High |
| `tests/ui-tts-actions.test.js` | Voice selection persists supported voice through injected service/config and rejects unsupported voice values. | TTS adapter local | Fake persistence under `./tmp` if file-backed | Medium |
| `tests/ui-babel-tts-ui.test.js` | Babel UI workflow uses `Editor` for text, visible language controls, translate/copy actions, dictionary display, and safe empty/error/result states. | Babel UI local | Headless render with fake Babel adapter | Medium |
| `tests/ui-babel-tts-ui.test.js` | TTS UI workflow collects input/output paths, selected voice, progress/result state, and missing-credential guidance without rendering an API-key input. | TTS UI local | Headless render with fake TTS adapter; no secrets | High |
| `tests/ui-babel-tts-ui.test.js` | Utility overlay keeps Babel/TTS off top nav, closes via `Esc`, and does not collide with Sync utility state. | Babel/TTS local and final utility integration | Headless render with fake utility state | High |

### Dependencies and gates

- Depends on shared utility overlay host and utility state split from Sync.
- `senda` must review Babel/TTS copy before implementation and before closure, especially missing credential guidance, progress/failure copy, and dictionary headings.
- TTS/Babel tests must not require real API keys, OpenAI calls, ffmpeg execution, network access, real clipboard access, or real external providers.
- Any file input, output audio path, fake config, or fixture must live under `./tmp` inside the repo.
- If implementation proposes secret entry through terminal UI, stop for security review; current Valyrian `Input` lacks a masked-secret prop.

### Final integration checks

- Re-run Babel/TTS utility tests after Sync merges because both share utility overlay state.
- Re-run `tests/tts.test.js` only if adapter work changes the TTS service contract; otherwise keep adapter tests on fakes.
- Run global `node --test` only after utility overlay conflicts and `senda` closure are resolved.
