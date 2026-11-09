import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { captureCommand, assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

// Required driver semantics: all steps exercise the real captured CLI. Geometry
// and styles come from its current PTY, with PNG for inspection. External
// failures are injected only at an isolated provider boundary, fail closed.
const cases = [
  [
    "shared action-result helper rejects unsafe raw error details",
    [
      {
        provider: {
          kind: "translation",
          response: { error: "synthetic provider failure token=CANARY_SECRET at private-canary.ts" }
        }
      },
      { key: "CTRL_6" },
      { fill: { label: "Text to translate", text: "Safe text" } },
      { click: "Translate", area: "actions" },
      { expect: { error: true, absent: ["CANARY_SECRET", "private-canary.ts", "stack"] } },
      { provider: { kind: "translation", response: { sentences: [{ trans: "Texto seguro" }] } } },
      { click: "Translate", area: "actions" },
      { expect: { text: "Texto seguro" } },
      { screenshot: "result" }
    ]
  ],
  [
    "utility launcher actions are removed because utility apps live in top nav",
    [
      {
        expect: {
          sameRowOrdered: ["Todo", "Notes", "Board", "Clocks", "Translate", "Speech", "Sync"],
          absent: ["Tools", "Choose a tool"],
          withinViewport: true
        }
      },
      { screenshot: "result" }
    ]
  ],
  [
    "top nav leaves one visual row before the active panel",
    [{ expect: { blankRowsAfter: { text: "Todo", count: 1 }, withinViewport: true } }, { screenshot: "result" }]
  ],
  [
    "board action bar keeps board actions without utility launcher noise",
    [
      { key: "CTRL_3" },
      { expect: { sameRow: ["Add card", "Add column"], absent: "Tools", withinViewport: true } },
      { screenshot: "result" }
    ]
  ],
  [
    "utility app surfaces use approved app wording without tool overlay copy",
    [
      { key: "CTRL_5" },
      { expect: { text: "Set up sync" } },
      { key: "CTRL_6" },
      { expect: { text: "Text to translate" } },
      { key: "CTRL_7" },
      { expect: { text: "Text to Speech", absent: ["Tools", "Choose a tool"] } },
      { screenshot: "result" }
    ]
  ],
  [
    "utility secondary overlays close with Escape while Ctrl+C stays delegated to focused inputs",
    [
      { remember: ["sync-config"] },
      { key: "CTRL_5" },
      { click: "Set up sync" },
      { key: "CTRL_C" },
      { expect: { text: "Remote URL" } },
      { screenshot: "result" },
      { key: "ESCAPE" },
      { expect: { text: "Retry sync", absent: "Remote URL" } },
      { unchanged: ["sync-config"] }
    ]
  ],
  [
    "Board, Todo details, and utility overlays fill the 80x24 surface without overdraw",
    [
      { key: "CTRL_3" },
      { click: "Add card" },
      { expect: { overlayMargin: 0.1, overlayFullSurface: true, withinViewport: true } },
      { key: "ESCAPE" },
      { key: "CTRL_1" },
      { click: "Capture task" },
      { key: "o" },
      { expect: { overlayMargin: 0.1, overlayFullSurface: true, withinViewport: true } },
      { key: "ESCAPE" },
      { key: "CTRL_5" },
      { click: "Set up sync" },
      { expect: { overlayMargin: 0.1, overlayFullSurface: true, withinViewport: true } },
      { screenshot: "result" },
      { key: "ESCAPE" }
    ]
  ],
  [
    "Board overlays keep the base board panel mounted by default",
    [
      { key: "CTRL_3" },
      { remember: ["boards"] },
      { rememberBoardBackdrop: true },
      { click: "Add card" },
      { expect: { boardBackdrop: true } },
      { screenshot: "add-card" },
      { click: "Save" },
      { expect: { invalid: true, boardBackdrop: true } },
      { screenshot: "card-action-error" },
      { key: "ESCAPE" },
      { click: "Context card" },
      { rememberBoardBackdrop: true },
      { key: "o" },
      { expect: { boardBackdrop: true } },
      { screenshot: "card-details" },
      { click: "Edit", area: "overlay" },
      { expect: { boardBackdrop: true } },
      { screenshot: "edit-card" },
      { key: "ESCAPE" },
      { click: "Context card" },
      { key: "o" },
      { click: "Remove", area: "overlay" },
      { expect: { boardBackdrop: true } },
      { screenshot: "remove-card-confirm" },
      { key: "ESCAPE" },
      { unchanged: ["boards"] },
      { click: "Ready" },
      { rememberBoardBackdrop: true },
      { key: "o" },
      { expect: { boardBackdrop: true } },
      { screenshot: "column-details" },
      { click: "Rename", area: "overlay" },
      { expect: { boardBackdrop: true } },
      { screenshot: "rename-column" },
      { key: "ESCAPE" },
      { click: "Ready" },
      { rememberBoardBackdrop: true },
      { key: "o" },
      { click: "WIP", area: "overlay" },
      { expect: { boardBackdrop: true } },
      { screenshot: "set-wip-limit" },
      { key: "ESCAPE" },
      { rememberBoardBackdrop: true },
      { click: "Add column" },
      { expect: { boardBackdrop: true } },
      { screenshot: "add-column" },
      { key: "ESCAPE" },
      { rememberBoardBackdrop: true },
      { click: "Add board" },
      { expect: { boardBackdrop: true } },
      { screenshot: "add-board" },
      { key: "ESCAPE" },
      { unchanged: ["boards"] },
      { doubleClick: "Context board" },
      { key: "ESCAPE" },
      { remember: ["boards"] },
      { rememberBoardBackdrop: true },
      { doubleClick: "Context board" },
      { click: "Rename", area: "overlay" },
      { expect: { boardBackdrop: true } },
      { screenshot: "rename-board" },
      { key: "ESCAPE" },
      { doubleClick: "Context board" },
      { click: "Delete board", area: "overlay", occurrence: -1 },
      { expect: { boardBackdrop: true } },
      { screenshot: "remove-board-confirm" },
      { key: "ESCAPE" },
      { doubleClick: "Empty context board" },
      { key: "ESCAPE" },
      { rememberBoardBackdrop: true },
      { click: "Reset to default layout" },
      { expect: { boardBackdrop: true } },
      { screenshot: "reset-columns-confirm" },
      { key: "ESCAPE" },
      { data: { domain: "boards", board: "Context board", column: "Backlog", cardTitles: ["Context card"] } },
      {
        data: { domain: "boards", currentTitle: "Empty context board", columnTitles: ["Empty Backlog", "Empty Ready"] }
      },
      { screenshot: "result" }
    ],
    {
      boards: [
        {
          title: "Context board",
          current: true,
          columns: [
            { title: "Backlog", cards: [{ title: "Context card" }] },
            { title: "Ready", cards: [] }
          ]
        },
        {
          title: "Empty context board",
          current: false,
          columns: [
            { title: "Empty Backlog", cards: [] },
            { title: "Empty Ready", cards: [] }
          ]
        }
      ]
    }
  ],
  [
    "Todo details overlay pins its action row to the internal bottom nav row",
    [
      { click: "Capture task" },
      { key: "o" },
      { expect: { overlayBottomActions: ["Edit task", "Mark done", "Remove task", "Close"], withinViewport: true } },
      { screenshot: "result" },
      { key: "ESCAPE" }
    ]
  ],
  [
    "Note details overlay pins its action row to the internal bottom nav row",
    [
      { key: "CTRL_2" },
      { click: "Capture note" },
      { key: "ENTER" },
      { expect: { overlayBottomActions: ["Edit note", "Remove note", "Close"], withinViewport: true } },
      { screenshot: "result" },
      { key: "ESCAPE" }
    ]
  ],
  [
    "shared snapshot enrichment exposes list identities without calling mutators",
    [
      { remember: ["todos", "notes", "boards", "clocks"] },
      { expect: { text: "Capture task" } },
      { key: "CTRL_2" },
      { expect: { text: "Capture note" } },
      { expect: { sameRow: ["Capture Notes", "Archive Notes"] } },
      { key: "CTRL_4" },
      { expect: { text: "Etc/UTC" } },
      { unchanged: ["todos", "notes", "boards", "clocks"] },
      { screenshot: "result" }
    ],
    { clocks: [{ name: "UTC", timezone: "Etc/UTC" }] }
  ],
  [
    "top nav exposes Translate and Speech as apps with Sync as a global control without Tools launcher copy",
    [
      { expect: { sameRowOrdered: ["Translate", "Speech", "Sync"], absent: ["Tools", "Choose a tool"] } },
      { click: "Sync", area: "nav" },
      { expect: { text: "Set up sync" } },
      { click: "Translate", area: "nav" },
      { expect: { text: "Text to translate" } },
      { click: "Speech", area: "nav" },
      { expect: { text: "Text to Speech" } },
      { screenshot: "result" }
    ]
  ],
  [
    "Ctrl shortcuts can select the utility apps as top-level routes",
    [
      { key: "CTRL_5" },
      { expect: { text: "Retry sync" } },
      { key: "CTRL_6" },
      { expect: { text: "Text to translate" } },
      { key: "CTRL_7" },
      { expect: { text: "Text to Speech" } },
      { screenshot: "result" }
    ]
  ],
  [
    "AppOverlay pins bottomNav to the internal bottom row with tall content",
    [
      { click: "Capture task" },
      { key: "o" },
      {
        expect: {
          overlayBottomActions: ["Edit task", "Remove task", "Close"],
          overlayFullSurface: true,
          withinViewport: true
        }
      },
      { scroll: { text: "Row", direction: "down", count: 30 } },
      {
        expect: {
          overlayBottomActions: ["Edit task", "Remove task", "Close"],
          overlayFullSurface: true,
          withinViewport: true
        }
      },
      { screenshot: "result" },
      { key: "ESCAPE" }
    ]
  ],
  [
    "shared overlay props keep the 10 percent margin contract and modal defaults",
    [
      { remember: ["todos"] },
      { locate: { text: "Capture task", as: "background" } },
      { click: "Add task" },
      { expect: { overlayMargin: 0.1, overlayFullSurface: true } },
      { clickRemembered: "background" },
      ...[1, 2].flatMap((cycle) => [
        { key: "TAB" },
        { expect: { footerCopyHint: true } },
        { type: `E${cycle}` },
        { expect: { text: cycle === 1 ? "E1" : "E1E2" } },
        { key: "TAB" },
        { expect: { controlBackground: { Save: "#315f9e" } } },
        { key: "TAB" },
        { expect: { controlBackground: { Cancel: "#315f9e" } } },
        { key: "TAB" },
        { expect: { footerCopyHint: true } },
        { type: `T${cycle}` },
        { expect: { text: cycle === 1 ? "T1" : "T1T2" } }
      ]),
      { expect: { text: "Task title" } },
      { unchanged: ["todos"] },
      { screenshot: "result" },
      { click: "Cancel" }
    ]
  ],
  [
    "StateText applies semantic tone styles to ANSI output without depending on global text state lookup",
    [
      // StateText is consumed by the list/clock panels. Its loading helper has no
      // CLI/TUI caller, so a Translate provider delay cannot exercise that branch.
      { remember: ["clocks"] },
      { storageFault: { domain: "clocks", kind: "deny-read" } },
      { key: "CTRL_4" },
      { expect: { semanticState: { tone: "error", pattern: "Clocks.*unavailable" } } },
      { screenshot: "read-error" },
      { storageFault: { domain: "clocks", kind: "restore-read" } },
      { expect: { semanticState: { tone: "empty", pattern: "No clocks yet" } } },
      { unchanged: ["clocks"] },
      { screenshot: "result" }
    ],
    { todos: [], notes: [], boards: [], clocks: [] }
  ],
  [
    "utility app render paths do not start status or voice preparation side effects",
    [
      { remember: ["tts-config", "sync-config"] },
      { key: "CTRL_5" },
      { resize: { cols: 100, rows: 30 } },
      { resize: { cols: 80, rows: 24 } },
      { key: "CTRL_7" },
      { click: "Choose voice" },
      { resize: { cols: 100, rows: 30 } },
      { resize: { cols: 80, rows: 24 } },
      { expect: { text: "Cancel" } },
      { externalCalls: { translation: 0, speech: 0 } },
      { unchanged: ["tts-config", "sync-config"] },
      { screenshot: "result" },
      { key: "ESCAPE" }
    ]
  ]
] as const;

for (const [name, steps, seed] of cases) {
  test(name, async (context) => {
    const result = await captureIluScenario({
      testName: context.name,
      scenario: "tuiInteraction",
      command: captureCommand,
      viewport: { cols: 80, rows: 24 },
      input: { seed: seed ?? {}, steps, externalIsolation: "deny-unmatched", finish: "normal-exit" }
    });
    assert.equal(result.exitCode, 0);
    assertCaptureArtifacts({
      result,
      testName: context.name,
      checkpoints: ["result"],
      diagnostic: (message) => context.diagnostic(message)
    });
  });
}
