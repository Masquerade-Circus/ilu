import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { captureCommand, assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

test("physical capture Help and contextual footer preserve real copy, paste, draft and save behavior", async (context) => {
  const outputRoot = path.resolve(import.meta.dirname, "..", "tmp", "terminal-captures");
  const before = new Set(fs.existsSync(outputRoot) ? fs.readdirSync(outputRoot) : []);
  const options = {
    testName: context.name,
    scenario: "helpFooter",
    command: captureCommand,
    viewport: { cols: 80, rows: 24 }
  };
  const checkpoints = ["footer-input", "footer-editor", "help-over-editor", "help-closed"];
  const result = await captureIluScenario(options);
  assert.equal(result.exitCode, 0);
  assertCaptureArtifacts({
    result,
    testName: context.name,
    checkpoints,
    diagnostic: (message) => context.diagnostic(message)
  });
  for (const entry of fs.readdirSync(outputRoot)) {
    if (!before.has(entry)) {
      assert.equal(fs.statSync(path.join(outputRoot, entry)).isDirectory(), false);
    }
  }
  const published = [
    ...checkpoints.map((name) => result.screenshots[name]),
    result.videoPath,
    result.actionsPath,
    result.outputPath
  ];
  const stale = Buffer.from("Synthetic stale artifact for the repeated Help capture");
  for (const file of published) {
    fs.appendFileSync(file, stale);
  }
  const prefix = context.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const stableFiles = fs
    .readdirSync(outputRoot)
    .filter((name) =>
      name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .startsWith(prefix)
    )
    .sort();
  const repeated = await captureIluScenario(options);
  assert.equal(repeated.exitCode, 0);
  assertCaptureArtifacts({
    result: repeated,
    testName: context.name,
    checkpoints,
    diagnostic: (message) => context.diagnostic(message)
  });
  for (const name of checkpoints) {
    assert.equal(repeated.screenshots[name], result.screenshots[name]);
  }
  assert.equal(repeated.videoPath, result.videoPath);
  assert.equal(repeated.actionsPath, result.actionsPath);
  assert.equal(repeated.outputPath, result.outputPath);
  for (const file of published) {
    assert.equal(fs.readFileSync(file).includes(stale), false);
  }
  assert.deepEqual(
    fs
      .readdirSync(outputRoot)
      .filter((name) =>
        name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .startsWith(prefix)
      )
      .sort(),
    stableFiles
  );
  for (const entry of fs.readdirSync(outputRoot)) {
    if (!before.has(entry)) {
      assert.equal(fs.statSync(path.join(outputRoot, entry)).isDirectory(), false);
    }
  }
});

test("physical capture real CLI failure retains its nonzero exit and inspectable error artifacts", async (context) => {
  const command = ["node", path.resolve(import.meta.dirname, "..", "bin", "cli.js"), "--unsupported-capture-option"];
  const stem = context.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const artifactRoot = path.resolve(import.meta.dirname, "..", "tmp", "terminal-captures");
  const diagnosticFile = path.join(artifactRoot, `${stem}.capture-diagnostics.json`);
  const unavailablePrompt = "Title of the board";
  // A real rejected CLI command never opens this prompt. The harness must retain
  // that observation failure and its pre-close evidence, not report success.
  await assert.rejects(
    captureIluScenario({
      testName: context.name,
      scenario: "cliScript",
      command,
      input: { steps: [{ waitFor: unavailablePrompt }] },
      viewport: { cols: 80, rows: 24 }
    }),
    (error) => error instanceof Error && error.message.includes(unavailablePrompt)
  );
  const failedDiagnostic = JSON.parse(fs.readFileSync(diagnosticFile, "utf8"));
  assert.equal(failedDiagnostic.sender.observable, false);
  assert.ok(failedDiagnostic.receiver.samples.some((sample) => sample.receivedBytes > 0));
  assert.notEqual(failedDiagnostic.beforeClose.observation.application.exitCode, 0);
  assert.ok(
    failedDiagnostic.beforeClose.processes.some(
      (entry) =>
        entry.pid === failedDiagnostic.beforeClose.observation.application.hostPid && !entry.state.startsWith("Z")
    )
  );
  const beforeCloseIndex = failedDiagnostic.stages.findIndex((stage) => stage.name === "before-public-close");
  const closedIndex = failedDiagnostic.stages.findIndex((stage) => stage.name === "public-close-completed");
  assert.ok(beforeCloseIndex >= 0 && closedIndex > beforeCloseIndex);
  assert.ok(Date.parse(failedDiagnostic.beforeClose.at) <= Date.parse(failedDiagnostic.stages[closedIndex].at));
  // Preserve the failed capture before the same stable test identity is reused.
  const failureEvidence = path.resolve(import.meta.dirname, "..", "tmp", "capture-diagnostic-failures", stem);
  fs.mkdirSync(failureEvidence, { recursive: true, mode: 0o700 });
  for (const name of fs.readdirSync(artifactRoot)) {
    if (name.startsWith(`${stem}.`) || new RegExp(`^${stem}-[0-9]+\\.png$`).test(name)) {
      const file = path.join(artifactRoot, name);
      if (fs.lstatSync(file).isFile()) {
        fs.copyFileSync(file, path.join(failureEvidence, name));
      }
    }
  }
  const result = await captureIluScenario({
    testName: context.name,
    scenario: "cliFailure",
    command,
    viewport: { cols: 80, rows: 24 }
  });
  assert.equal(Number.isInteger(result.exitCode), true);
  assert.notEqual(result.exitCode, 0);
  const diagnostic = JSON.parse(fs.readFileSync(result.diagnosticsPath, "utf8"));
  assert.equal(diagnostic.beforeClose.observation.application.exitCode, result.exitCode);
  assert.ok(diagnostic.receiver.samples.some((sample) => sample.receivedBytes > 0));
  assertCaptureArtifacts({
    result,
    testName: context.name,
    checkpoints: ["cli-error"],
    diagnostic: (message) => context.diagnostic(message)
  });
});

const tabs = ["Todo", "Notes", "Board", "Clocks", "Sync", "Translate", "Speech"];
const seed = {
  todos: [
    { title: "Today", current: true, tasks: [{ title: "Ship read view", description: "Task body", done: false }] }
  ],
  notes: [{ title: "Research", current: true, notes: [{ title: "Threat model", content: "Note body" }] }],
  boards: [
    {
      title: "Launch board",
      current: true,
      columns: [
        { title: "Backlog", cards: [{ title: "Write tests" }, { title: "Wire UI" }] },
        { title: "Ready", cards: [] },
        { title: "Done", cards: [] }
      ]
    }
  ],
  clocks: [
    { name: "UTC", timezone: "Etc/UTC" },
    { name: "Mexico City", timezone: "America/Mexico_City" }
  ]
};
const cases = [
  {
    name: "active editor renders only the active page factory",
    steps: [
      { remember: ["notes", "boards", "clocks"] },
      { click: "Add task" },
      { fill: { label: "Task details", text: "abc" } },
      { expect: { text: "abc", absent: ["Threat model", "Write tests"] } },
      { unchanged: ["notes", "boards", "clocks"] },
      { screenshot: "active-editor" },
      { click: "Cancel" }
    ]
  },
  {
    name: "headless custom key commands activate the requested page and its controls",
    steps: [
      { key: "CTRL_2" },
      { key: "CTRL_1" },
      { click: "Add task" },
      { type: "Requested page" },
      { expect: { text: "Requested page" } },
      { screenshot: "requested-editor" },
      { click: "Cancel" }
    ]
  },
  {
    name: "successful Todo task actions request a scoped todo snapshot refresh",
    steps: [
      { remember: ["notes", "boards", "clocks"] },
      { click: "Add task" },
      { type: "Scoped" },
      { click: "Save" },
      { expect: { text: "Scoped" } },
      { data: { domain: "todos", title: "Scoped", count: 1 } },
      { unchanged: ["notes", "boards", "clocks"] }
    ]
  },
  {
    name: "renderSmoke imprime app base con top nav y keymaps sin duplicar titulo",
    steps: [
      {
        expect: {
          sameRowOrdered: tabs.filter((tab) => tab !== "Sync"),
          footerActionsVisible: true,
          absentStandaloneTitle: "ilu"
        }
      }
    ]
  },
  {
    name: "top nav usa botones themed y estado activo por ANSI, no marcadores ASCII",
    steps: [
      {
        expect: {
          navActiveBackground: { Todo: "#315f9e" },
          navInactiveBackground: { Notes: "#1f2328" },
          navAsciiMarkers: false
        }
      },
      { key: "CTRL_2" },
      { expect: { navActiveBackground: { Notes: "#315f9e" } } }
    ]
  },
  {
    name: "top nav separa apps de Sync global alineado a la derecha",
    steps: [
      {
        expect: {
          sameRowOrdered: ["Todo", "Notes", "Board", "Clocks", "Translate", "Speech", "Sync"],
          navSyncRightAligned: true,
          withinViewport: true
        }
      }
    ]
  },
  {
    name: "top nav Sync button reflects sync status without using footer status copy",
    steps: [
      {
        syncStatusTour: {
          statuses: ["idle", "synced", "pending", "syncing", "failed", "setup"],
          throughRealOperations: true,
          assertInNavNotFooter: true,
          withinViewport: true
        }
      }
    ]
  },
  {
    name: "createHeadlessSession muestra solo contenido de la vista activa",
    steps: [
      {
        expect: {
          text: "Ship read view",
          absent: ["Threat model", "Launch board", "Write tests"],
          absentStandaloneTitle: "Today"
        }
      }
    ]
  },
  {
    name: "footer muestra salida y clocks compactos con nombres y segundos fuera de Clocks",
    steps: [
      {
        expect: {
          footerClockSeconds: ["UTC", "Mexico City"],
          footerAbsent: ["Etc/UTC", "America/Mexico_City"],
          footerActionsVisible: true
        }
      }
    ]
  },
  {
    name: "vistas vacias usan copy especifico con acciones visibles de TUI",
    seed: { todos: [], notes: [], boards: [], clocks: [] },
    steps: [
      { expect: { empty: true, text: "Add task" } },
      { key: "CTRL_2" },
      { expect: { empty: true, text: "Add note" } },
      { key: "CTRL_4" },
      { expect: { empty: true, text: "Add clock" } },
      { key: "CTRL_3" },
      { expect: { empty: true, text: "Add column", absent: ["adapter", "snapshot", "runtime"] } }
    ]
  },
  {
    name: "footer respeta 80 columnas con cuatro clocks compactos",
    seed: {
      ...seed,
      clocks: ["UTC", "Mexico City", "Madrid", "Tokyo"].map((name, index) => ({
        name,
        timezone: ["Etc/UTC", "America/Mexico_City", "Europe/Madrid", "Asia/Tokyo"][index]
      }))
    },
    steps: [{ expect: { withinViewport: true, footerActionsVisible: true } }]
  },
  {
    name: "footerSegments permite padding cero cuando clocks caben exacto en 80 columnas",
    seed: { ...seed, clocks: [{ name: "X".repeat(43), timezone: "Etc/UTC" }] },
    steps: [{ expect: { footerWidth: 80, footerClockSeconds: ["X".repeat(43)], footerActionsVisible: true } }]
  },
  {
    name: "footerLine no devuelve texto mayor al ancho disponible con cuatro clocks compactos",
    seed: {
      ...seed,
      clocks: ["UTC", "Mexico City", "Madrid", "Tokyo"].map((name, index) => ({
        name,
        timezone: ["Etc/UTC", "America/Mexico_City", "Europe/Madrid", "Asia/Tokyo"][index]
      }))
    },
    steps: [{ expect: { withinViewport: true, footerActionsVisible: true } }]
  },
  {
    name: "footerLine omite errores de clocks que no caben completos en el footer fijo",
    seed: { ...seed, clocks: [{ name: "Bad clock", timezone: "Synthetic/InvalidZone" }] },
    steps: [
      {
        expect: {
          footerActionsVisible: true,
          withinViewport: true,
          footerAbsent: ["RangeError", "stack", "Invalid time zone", "Synthetic/InvalidZone"]
        }
      }
    ]
  },
  {
    name: "footerLine omite estados de sync porque Sync vive en el top nav global",
    steps: [
      {
        syncStatusTour: {
          statuses: ["idle", "syncing", "pending", "synced", "failed", "setup"],
          throughRealOperations: true,
          assertInNavNotFooter: true,
          footerActionsVisible: true
        }
      }
    ]
  },
  {
    name: "Clocks tab muestra nombres completos de relojes",
    steps: [{ key: "CTRL_4" }, { expect: { texts: ["UTC", "Mexico City", "Etc/UTC", "America/Mexico_City"] } }]
  },
  {
    name: "mountInteractiveSession habilita mouse SGR y cambia tab con input real de stdin",
    steps: [
      { expectTerminalSequences: { enabled: ["1000", "1006"] } },
      { click: "Board", area: "nav" },
      { expect: { texts: ["Launch board", "Write tests"], absent: "Ship read view" } },
      { exitNormally: true },
      { expectTerminalRestored: true }
    ]
  },
  {
    name: "mountInteractiveSession actualiza el título de terminal con la app activa",
    steps: [
      { expectTerminalTitle: "Ilu - Todo" },
      { key: "CTRL_3" },
      { expectTerminalTitle: "Ilu - Board" },
      { key: "CTRL_7" },
      { expectTerminalTitle: "Ilu - Speech" }
    ]
  },
  {
    name: "createHeadlessSession does not subscribe to sync status updates",
    cliReadOnly: ["todo"],
    steps: [{ expect: { text: "Ship read view" } }, { remoteOperations: { backgroundSync: 0 } }]
  },
  {
    name: "mountInteractiveSession flushes debounced sync before session cleanup on destroy",
    startupSync: { fixture: "private-empty-remote", autoPull: false },
    steps: [
      { click: "Add task" },
      { type: "Flush on exit" },
      { click: "Save" },
      { exitNormally: true },
      { remoteData: { task: "Flush on exit" } },
      { expectTerminalRestored: true }
    ]
  },
  {
    name: "mountInteractiveSession waits for TUI sync client shutdown before terminal cleanup",
    startupSync: { fixture: "private-empty-remote", autoPull: false },
    steps: [
      { syncBoundary: { defer: "push", as: "shutdown" } },
      { click: "Add task" },
      { type: "Shutdown task" },
      { click: "Save" },
      { requestNormalExit: true },
      { expectTerminalRestored: false },
      { releaseSyncBoundary: "shutdown" },
      { expectExit: 0 },
      { remoteData: { task: "Shutdown task" } },
      { expectTerminalRestored: true }
    ]
  },
  {
    name: "mountInteractiveSession updates Sync top nav after background board sync completes",
    startupSync: { fixture: "private-empty-remote", autoPull: false },
    steps: [
      { syncBoundary: { defer: "push", as: "board-sync" } },
      { key: "CTRL_3" },
      { click: "Add card" },
      { type: "Sync board card" },
      { click: "Save" },
      { expect: { navSyncStatus: "pending" } },
      { releaseSyncBoundary: "board-sync" },
      { expect: { navSyncStatus: "synced" } },
      { remoteData: { card: "Sync board card" } }
    ]
  },
  {
    name: "mountInteractiveSession refreshes recovery outcomes and unsubscribes on destroy",
    workflow: {
      fixture: {
        remote: "empty",
        initialize: true,
        local: { todos: "Recovery Todo", notes: "Recovery Notes", boards: "Recovery board", card: "Original card" },
        config: { enabled: false, autoPull: true, autoSync: true }
      },
      steps: [
        { action: "open", view: "Todo" },
        {
          action: "external-writer",
          domain: "todos",
          values: { title: "External Todo" },
          publish: true,
          readLocalFirst: true
        },
        { action: "ui", operation: "add-task", title: "Rejected stale task" },
        { action: "wait-screen", pattern: "Local data was reloaded" },
        { action: "observe", name: "reloaded" },
        { action: "close-ui" },
        { action: "cli", args: ["sync", "enable"] },
        { action: "open", view: "Notes" },
        {
          action: "external-writer",
          domain: "notes",
          values: { title: "External Notes" },
          publish: true,
          readLocalFirst: true
        },
        { action: "ui", operation: "add-note", title: "Rejected stale note", content: "Not saved" },
        { action: "wait-recovery", domain: "notes" },
        { action: "observe", name: "reconciled" },
        { action: "ui", operation: "dismiss-notice" },
        { action: "ui", operation: "switch-view", view: "Board" },
        {
          action: "external-writer",
          domain: "boards",
          values: { title: "External board" },
          publish: true,
          readLocalFirst: true
        },
        { action: "transport", mode: "unknown-failure" },
        { action: "ui", operation: "add-card", title: "Rejected stale card", expectRecovery: true },
        { action: "wait-recovery-blocked" },
        { action: "observe", name: "blocked" },
        { action: "exit" },
        { action: "expect-no-output-after-exit", durationMs: 150 }
      ]
    }
  },
  {
    name: "createHeadlessSession cambia a Board al hacer click en top nav",
    steps: [
      { click: "Board", area: "nav" },
      { expect: { texts: ["Launch board", "Write tests"], absent: "Ship read view" } }
    ]
  },
  {
    name: "createHeadlessSession cambia a Clocks al hacer click en top nav y muestra nombres completos",
    steps: [{ click: "Clocks", area: "nav" }, { expect: { texts: ["UTC", "Mexico City"] } }]
  },
  {
    name: "help overlay distinguishes contextual copy from closing Help",
    steps: [
      { key: "CTRL_K" },
      { expect: { helpCopyGuidance: true, helpEscapeGuidance: true } },
      { key: "ESCAPE" },
      { expect: { text: "Ship read view" } }
    ]
  },
  {
    name: "help overlay keeps independent app actions on separate lines",
    steps: [
      ...["Todo", "Notes", "Clocks", "Sync", "Translate", "Speech"].flatMap((tab) => [
        { key: `CTRL_${tabs.indexOf(tab) + 1}` },
        { key: "CTRL_K" },
        { expect: { helpActionsOnSeparateRows: tab } },
        { screenshot: `help-${tab.toLowerCase()}` },
        { key: "ESCAPE" }
      ])
    ]
  },
  {
    name: "Ctrl+H no abre help ni se mantiene como alias inseguro",
    steps: [{ key: "CTRL_H" }, { expect: { absent: "Todo help" } }]
  },
  {
    name: "Ctrl+K opens contextual help for every app",
    steps: [
      ...tabs.flatMap((tab, index) => [
        { key: `CTRL_${index + 1}` },
        { key: "CTRL_K" },
        {
          expect: { text: `${tab} help`, helpCopyGuidance: true, helpEscapeGuidance: true, helpKeyboardGuidance: true }
        },
        { key: "CTRL_K" },
        { expect: { absent: `${tab} help` } }
      ])
    ]
  },
  {
    name: "help overlay closes with Esc and Close button without exiting",
    steps: [
      { key: "CTRL_K" },
      { expect: { text: "Todo help" } },
      { key: "ESCAPE" },
      { expect: { text: "Ship read view", absent: "Todo help" } },
      { key: "CTRL_K" },
      { click: "Close", area: "overlay" },
      { expect: { text: "Ship read view", absent: "Todo help" } },
      { key: "CTRL_3" },
      { key: "CTRL_K" },
      { scroll: { text: "Tab moves focus", direction: "down", count: 25 } },
      { expect: { helpEscapeGuidance: true, text: "add cards" } },
      { key: "ESCAPE" }
    ]
  },
  {
    name: "global Help advertises every numbered shortcut and each key opens the advertised app",
    steps: [
      { key: "CTRL_K" },
      { expect: { advertisedTabShortcuts: tabs } },
      { key: "ESCAPE" },
      ...tabs.flatMap((tab, index) => [{ key: `CTRL_${index + 1}` }, { expect: { activeTab: tab } }])
    ]
  },
  {
    name: "footer Ctrl+C hint follows copy focus and overlay close behavior",
    steps: [
      { expect: { footerExitHint: true } },
      { click: "Add task" },
      { expect: { footerCopyHint: true } },
      { key: "TAB" },
      { expect: { footerCopyHint: true } },
      { key: "SHIFT_TAB" },
      { type: "Draft task" },
      { key: "CTRL_A" },
      { key: "CTRL_C" },
      { clipboardEquals: { label: "Task title", endLabel: "Task details", text: "Draft task" } },
      { key: "TAB", repeat: 3 },
      { expect: { footerCloseHint: true } },
      { key: "CTRL_C" },
      { expect: { footerExitHint: true, absent: "Cancel" } }
    ]
  },
  {
    name: "Ctrl+C exits from Help instead of acting as overlay help copy",
    steps: [{ key: "CTRL_K" }, { expect: { text: "Todo help" } }, { key: "CTRL_C" }, { expectExit: 0 }]
  },
  {
    name: "Ctrl+C in a focused input uses Valyrian copy and keeps the UI running",
    steps: [
      { key: "CTRL_3" },
      { click: "Add card" },
      { type: "Ship card" },
      { key: "CTRL_A" },
      { key: "CTRL_C" },
      { clipboardEquals: { label: "Title", endLabel: "Description", text: "Ship card" } },
      { expect: { text: "Cancel" } },
      { click: "Cancel" }
    ]
  },
  ...[
    {
      tab: "Todo",
      form: "add-item",
      editor: "todo-add-description",
      copy: {
        domain: "todos",
        title: "Task title",
        label: "Task details",
        end: "Save",
        open: [{ click: "Add task" }],
        main: "Add task"
      }
    },
    {
      tab: "Todo",
      form: "add-list",
      editor: "todo-add-list-description",
      copy: {
        domain: "todos",
        title: "List title",
        label: "List details",
        end: "Add list",
        open: [{ click: "Manage lists" }, { click: "Add list" }],
        main: "Manage lists"
      }
    },
    {
      tab: "Notes",
      form: "add-item",
      editor: "note-add-content",
      copy: {
        domain: "notes",
        title: "Note title",
        label: "Note content",
        end: "Save",
        open: [{ click: "Add note" }],
        main: "Add note"
      }
    },
    {
      tab: "Notes",
      form: "add-list",
      editor: "note-add-list-description",
      copy: {
        domain: "notes",
        title: "List title",
        label: "List details",
        end: "Add list",
        open: [{ click: "Manage lists" }, { click: "Add list" }],
        main: "Manage lists"
      }
    },
    {
      tab: "Board",
      form: "add-card",
      editor: "board-add-description",
      copy: {
        domain: "boards",
        title: "Title",
        label: "Description",
        end: "Save",
        open: [{ click: "Add card" }],
        main: "Add card"
      }
    },
    {
      tab: "Board",
      form: "add-board",
      editor: "board-add-board-description",
      copy: {
        domain: "boards",
        title: "Title",
        label: "Description",
        end: "Save",
        open: [{ click: "Add board" }],
        main: "Add card"
      }
    },
    { tab: "Translate", form: "translate", editor: "translate-text" }
  ].map((target) => ({
    name: `terminal integration contextual Editor copy preserves selection and explicit exits: ${target.editor}`,
    steps:
      "copy" in target
        ? [
            { key: `CTRL_${tabs.indexOf(target.tab) + 1}` },
            { remember: [target.copy.domain] },
            ...target.copy.open,
            { fill: { label: target.copy.title, text: "Clipboard sentinel" } },
            { key: "CTRL_A" },
            { key: "CTRL_C" },
            { fill: { label: target.copy.label, text: "Alpha\nBeta" } },
            { key: "CTRL_C" },
            { clipboardEquals: { label: target.copy.title, endLabel: target.copy.label, text: "Clipboard sentinel" } },
            { key: "TAB" },
            { key: "CTRL_A" },
            { key: "CTRL_C" },
            { key: "END" },
            { key: "CTRL_C" },
            { clipboardEquals: { label: target.copy.label, endLabel: target.copy.end, text: "Alpha\nBeta" } },
            { key: "HOME" },
            { key: "SHIFT_END" },
            { key: "CTRL_C" },
            { clipboardEquals: { label: target.copy.title, endLabel: target.copy.label, text: "Beta" } },
            { key: "TAB" },
            { type: "Gamma" },
            { key: "CTRL_A" },
            { key: "CTRL_C" },
            { clipboardEquals: { label: target.copy.label, endLabel: target.copy.end, text: "Alpha\nGamma" } },
            { expect: { footerCopyHint: true } },
            { screenshot: "edited-selection" },
            { key: "ESCAPE" },
            { expect: { absent: target.copy.title, text: target.copy.main } },
            ...target.copy.open,
            { click: "Cancel" },
            { expect: { absent: target.copy.title, text: target.copy.main } },
            { unchanged: [target.copy.domain] }
          ]
        : [
            { key: "CTRL_6" },
            { fill: { label: "Text to translate", text: "Clipboard sentinel" } },
            { key: "CTRL_A" },
            { key: "CTRL_C" },
            { fill: { label: "Text to translate", text: "Alpha\nBeta" } },
            { key: "CTRL_C" },
            { clipboardEquals: "Clipboard sentinel" },
            { fill: { label: "Text to translate", text: "Alpha\nBeta" } },
            { key: "CTRL_A" },
            { key: "CTRL_C" },
            { key: "END" },
            { key: "CTRL_C" },
            { clipboardEquals: "Alpha\nBeta" },
            { key: "HOME" },
            { key: "SHIFT_END" },
            { key: "CTRL_C" },
            { clipboardEquals: "Beta" },
            { fill: { label: "Text to translate", text: "Alpha\nBeta" } },
            { key: "HOME" },
            { key: "SHIFT_END" },
            { type: "Gamma" },
            { key: "CTRL_A" },
            { key: "CTRL_C" },
            { clipboardEquals: "Alpha\nGamma" },
            { expect: { footerCopyHint: true } },
            { screenshot: "edited-selection" },
            { key: "CTRL_1" },
            { expect: { text: "Add task", absent: "Text to translate (" } }
          ]
  })),
  {
    name: "terminal integration Help above an Editor describes copy and keeps global Ctrl+C semantics",
    steps: [
      { click: "Add task" },
      { fill: { label: "Task details", text: "Hidden draft" } },
      { key: "CTRL_A" },
      { key: "CTRL_C" },
      { key: "CTRL_K" },
      { expect: { helpCopyGuidance: true, helpEscapeGuidance: true, footerCopyHint: false } },
      { screenshot: "help-global-exit" },
      { key: "ESCAPE" },
      { expect: { text: "Hidden draft" } },
      { clipboardEquals: { label: "Task details", endLabel: "Save", text: "Hidden draft" } },
      { key: "CTRL_K" },
      { key: "CTRL_C" },
      { expectExit: 0 }
    ]
  },
  {
    name: "Ctrl+K puts help above an already open page overlay and Close targets help",
    steps: [
      { click: "Add task" },
      { type: "Preserved draft" },
      { key: "CTRL_K" },
      { expect: { text: "Todo help", overlayAbsent: "Preserved draft" } },
      { screenshot: "help-above-draft" },
      { click: "Close", area: "overlay" },
      { expect: { text: "Preserved draft", absent: "Todo help" } },
      { screenshot: "draft-restored" },
      { click: "Cancel" }
    ]
  },
  {
    name: "Esc sin overlay activo no sale de la app",
    steps: [{ key: "ESCAPE" }, { expect: { text: "Ship read view" } }]
  },
  {
    name: "Esc cierra help sin usar semantica de salida de Ctrl+C",
    steps: [{ key: "CTRL_K" }, { key: "ESCAPE" }, { expect: { text: "Ship read view", absent: "Todo help" } }]
  },
  {
    name: "createHeadlessSession cambia activeTab con CTRL_1 a CTRL_4",
    steps: [
      { key: "CTRL_4" },
      ...tabs.slice(0, 4).flatMap((tab, index) => [{ key: `CTRL_${index + 1}` }, { expect: { activeTab: tab } }])
    ]
  },
  {
    name: "chrome persistente no muestra contenido redundante y respeta 80 columnas",
    steps: [
      {
        expect: {
          text: "Ship read view",
          absentStandaloneTitle: "Today",
          absent: ["Ctrl+A", "Ctrl+B", "Ctrl+H"],
          withinViewport: true
        }
      },
      { key: "CTRL_2" },
      { expect: { text: "Threat model", absentStandaloneTitle: "Research" } },
      { key: "CTRL_3" },
      { expect: { absentStandaloneTitle: "Launch board", withinViewport: true } }
    ]
  },
  {
    name: "Column details footer usa una sola linea con labels compactos",
    steps: [
      { key: "CTRL_3" },
      { click: "Ready" },
      { key: "o" },
      {
        expect: {
          overlayBottomActions: ["Rename", "WIP", "Default", "Remove column", "Close"],
          overlayAbsent: ["Left", "Right"],
          withinViewport: true
        }
      },
      { screenshot: "overlay" },
      { key: "ESCAPE" }
    ]
  },
  {
    name: "Column details footer renderiza Current con el mismo componente de boton compartido",
    steps: [
      { key: "CTRL_3" },
      { click: "Backlog" },
      { key: "o" },
      {
        expect: {
          overlayBottomActions: ["Rename", "WIP", "Current", "Remove column", "Close"],
          controlBackground: { Current: "#1f2328" },
          withinViewport: true
        }
      },
      { screenshot: "overlay" },
      { key: "ESCAPE" }
    ]
  },
  {
    name: "Column details arma Remove column inline y segundo click elimina la columna",
    steps: [
      { key: "CTRL_3" },
      { remember: ["boards"] },
      { click: "Ready" },
      { key: "o" },
      { click: "Remove column" },
      { expect: { text: "Delete column", overlayTexts: ["WIP", "Close"] } },
      { unchanged: ["boards"] },
      { click: "Delete column", area: "overlay", occurrence: -1 },
      { data: { domain: "boards", absentColumn: "Ready" } }
    ]
  },
  {
    name: "LEFT y RIGHT no son consumidos por Board cuando un overlay tiene foco de input",
    steps: [
      { key: "CTRL_3" },
      { remember: ["boards"] },
      { click: "Add card" },
      { type: "abc" },
      { key: "LEFT" },
      { type: "X" },
      { expect: { text: "abXc" } },
      { unchanged: ["boards"] },
      { click: "Save" },
      { data: { domain: "boards", card: "abXc", column: "Backlog" } }
    ]
  },
  {
    name: "createHeadlessSession mantiene app dentro de viewport 80x24 con board largo",
    seed: {
      ...seed,
      boards: [
        {
          title: "Long board",
          current: true,
          columns: [
            {
              title: "Backlog with a deliberately long title",
              cards: Array.from({ length: 4 }, (_, index) => ({ title: `Check overly wide board columns ${index}` }))
            },
            {
              title: "Doing",
              cards: Array.from({ length: 3 }, (_, index) => ({ title: `Avoid implementation text ${index}` }))
            },
            { title: "Done", cards: [{ title: "Read-only model loads" }, { title: "Footer key hints remain visible" }] }
          ]
        }
      ]
    },
    steps: [
      { key: "CTRL_3" },
      {
        expect: {
          withinViewport: true,
          footerActionsVisible: true,
          sameRow: ["(4)", "Doing", "Done"],
          absent: "Backlog with a deliberately long title"
        }
      }
    ]
  },
  {
    name: "mountInteractiveSession delegates stdout resize handling to Valyrian runtime",
    steps: [
      { key: "CTRL_3" },
      { resize: { cols: 100, rows: 24 } },
      { resize: { cols: 60, rows: 24 } },
      { expect: { withinViewport: true, sameRow: ["Backlog", "Ready", "Done"] } }
    ]
  },
  {
    name: "mountInteractiveSession abre card con doublepress real de mouse",
    steps: [
      { key: "CTRL_3" },
      { doubleClick: "Wire UI" },
      { expect: { text: "Backlog | Wire UI" } },
      { screenshot: "card-details" },
      { key: "ESCAPE" }
    ]
  },
  {
    name: "createHeadlessSession no selecciona Board cards por ids sinteticos fuera del runtime",
    steps: [
      { key: "CTRL_3" },
      { remember: ["boards"] },
      { type: "board-card-1-1" },
      { expect: { notSelectedText: "Write tests", absent: "Backlog | Write tests" } },
      { unchanged: ["boards"] }
    ]
  },
  {
    name: "mountInteractiveSession delega mouse reporting al lifecycle de Valyrian sin duplicar secuencias",
    steps: [
      { expectTerminalSequences: { enabledExactlyOnce: ["1000", "1002", "1006"] } },
      { click: "Board", area: "nav" },
      { expect: { text: "Write tests" } },
      { exitNormally: true },
      { expectTerminalRestored: true }
    ]
  },
  {
    name: "Esc cierra overlay de Board solo cuando Board esta activo",
    steps: [
      { key: "CTRL_3" },
      { click: "Add card" },
      { key: "ESCAPE" },
      { expect: { absent: "Description" } },
      { click: "Add card" },
      { key: "CTRL_2" },
      { key: "ESCAPE" },
      { expect: { text: "Threat model", absent: "Description" } }
    ]
  },
  {
    name: "Headless semantic click fallback respeta trapFocus cuando hay overlay activo",
    steps: [
      { key: "CTRL_3" },
      { locate: { text: "Notes", as: "nav-notes" } },
      { locate: { text: "Add card", as: "background-add" } },
      { click: "Add card" },
      { clickRemembered: "nav-notes" },
      { expect: { text: "Description", absent: "Threat model" } },
      { screenshot: "trapped-form" },
      { click: "Cancel" },
      { click: "Write tests" },
      { key: "o" },
      { clickRemembered: "background-add" },
      { expect: { text: "Backlog | Write tests", absent: "Description" } },
      { screenshot: "trapped-details" },
      { key: "ESCAPE" }
    ]
  },
  {
    name: "mountInteractiveSession pasa dimensiones seguras cuando el TTY reporta cero",
    initialPtySize: { cols: 0, rows: 0 },
    steps: [
      { expect: { text: "Todo", withinViewport: true, absentStandaloneTitle: "ilu" } },
      { resize: { cols: 80, rows: 24 } },
      { click: "Add task" },
      { expect: { text: "Cancel" } },
      { click: "Cancel" }
    ]
  },
  {
    name: "resolveLayoutOptions usa columns de stdout para sesiones interactivas sin cols explicito",
    initialPtySize: { cols: 60, rows: 24 },
    steps: [{ expect: { withinViewport: true, frameColumns: 60, frameRows: 24 } }]
  },
  {
    name: "App hides page overlays when switching to another app",
    steps: [
      { click: "Add task" },
      { key: "CTRL_3" },
      { doubleClick: "Launch board" },
      { key: "CTRL_4" },
      { click: "Add clock" },
      { key: "CTRL_2" },
      { expect: { text: "Threat model", absent: ["Task title", "Board: Launch board", "Clock name"] } }
    ]
  }
];

for (const entry of cases) {
  test(entry.name, async (context) => {
    if (Object.hasOwn(entry, "workflow")) {
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "syncWorkflow",
        command: ["sh"],
        viewport: { cols: 100, rows: 40 },
        input: entry.workflow
      });
      assert.equal(result.exitCode, 0);
      for (const [checkpoint, domain, title, rejected] of [
        ["reloaded", "todos", "External Todo", "Rejected stale task"],
        ["reconciled", "notes", "External Notes", "Rejected stale note"],
        ["blocked", "boards", "External board", "Rejected stale card"]
      ]) {
        const observed = result.at[checkpoint];
        assert.match(observed.files[`${domain}.json`], new RegExp(title));
        assert.doesNotMatch(observed.files[`${domain}.json`], new RegExp(rejected));
        assert.doesNotMatch(observed.screen, /fatal:|Error:|at .*\.ts:/);
        if (checkpoint !== "blocked") {
          assert.match(observed.screen, new RegExp(title));
        }
      }
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: ["reloaded", "reconciled", "blocked"],
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
    if (Object.hasOwn(entry, "startupSync")) {
      const board = entry.steps.some((step) => typeof step.remoteData?.card === "string");
      const shutdown = entry.steps.some((step) => step.requestNormalExit === true);
      const title = entry.steps.find((step) => typeof step.type === "string").type;
      const gated = board || shutdown;
      const steps = [
        { action: "open", view: board ? "Board" : "Todo" },
        { action: "ui", operation: board ? "add-card" : "add-task", title },
        { action: "observe", name: "pending" }
      ];
      if (gated) {
        steps.push({ action: "wait-transport", operation: "push", gated: true });
      }
      if (board) {
        steps.push({ action: "release-transport" }, { action: "settle-sync", name: "saved" });
      } else if (shutdown) {
        steps.push(
          { action: "close-ui", background: true },
          { action: "observe", name: "waiting" },
          { action: "release-transport" },
          { action: "wait-command", name: "closed" }
        );
      } else {
        steps.push({ action: "close-ui", name: "closed" });
      }
      steps.push({ action: "exit" });
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "syncWorkflow",
        command: ["sh"],
        viewport: { cols: 80, rows: 24 },
        input: {
          fixture: {
            remote: "empty",
            initialize: true,
            local: { todos: seed.todos, notes: seed.notes, boards: seed.boards },
            config: { autoPull: true },
            ...(gated ? { transport: { gate: "push", arm: "after-open" } } : {})
          },
          steps
        }
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.at.pending.screen.split("\n")[0], /sync\s+pending/i);
      const final = result.at[board ? "saved" : "closed"];
      const file = board ? "boards.json" : "todos.json";
      assert.ok(final.remoteFiles[file].includes(title));
      assert.equal(final.files[file], final.remoteFiles[file]);
      if (board) {
        assert.match(final.screen.split("\n")[0], /synced/i);
      } else {
        assert.equal(final.exitCode, 0);
        assert.equal(final.applicationExited, true);
        assert.ok(final.applicationExitedAt >= final.transport.at(-1).finishedAt);
        for (const mode of ["1000", "1002", "1006"]) {
          const enabled = result.terminalOutput.lastIndexOf(`\x1b[?${mode}h`);
          assert.ok(enabled >= 0 && result.terminalOutput.lastIndexOf(`\x1b[?${mode}l`) > enabled);
        }
        assert.ok(result.terminalOutput.lastIndexOf("\x1b[?25h") > result.terminalOutput.lastIndexOf("\x1b[?25l"));
      }
      if (shutdown) {
        assert.equal(result.at.waiting.applicationExited, false);
      }
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: ["pending", ...(shutdown ? ["waiting"] : []), board ? "saved" : "closed"],
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
    if (Object.hasOwn(entry, "cliReadOnly")) {
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "syncWorkflow",
        command: ["sh"],
        viewport: { cols: 80, rows: 24 },
        input: {
          fixture: { remote: "empty", initialize: true, local: { todos: seed.todos }, config: { autoPull: false } },
          steps: [{ action: "cli", args: entry.cliReadOnly, name: "read-only" }, { action: "exit" }]
        }
      });
      const observed = result.at["read-only"];
      assert.equal(result.exitCode, 0);
      assert.equal(observed.exitCode, 0);
      assert.match(observed.screen, /Ship read view/);
      assert.equal(observed.transport.length, 0);
      assert.equal(observed.files["todos.json"], observed.remoteFiles["todos.json"]);
      const state = JSON.parse(observed.files[".sync-core/state.json"]);
      assert.equal(state.status, "healthy");
      assert.equal(state.hasPendingRemote, false);
      assert.equal(observed.files[".config/sync-pending.json"], null);
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: ["read-only"],
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
    if (entry.steps.some((step) => Object.hasOwn(step, "syncStatusTour"))) {
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "syncWorkflow",
        command: ["sh"],
        viewport: { cols: 80, rows: 24 },
        input: {
          fixture: {
            remote: "empty",
            local: { todos: "Sync tour" },
            config: { enabled: true, autoSync: true, autoPull: true, remoteUrl: "", branch: "main" },
            transport: { gate: "push", arm: "after-open" }
          },
          steps: [
            { action: "open", view: "Todo" },
            { action: "observe", name: "idle" },
            { action: "ui", operation: "add-task", title: "Setup task" },
            { action: "wait-status", status: "setup", name: "setup" },
            { action: "release-transport" },
            { action: "close-ui" },
            { action: "cli", args: ["sync", "init", "--remote", "$REMOTE"] },
            { action: "open", view: "Todo" },
            { action: "observe", name: "synced" },
            { action: "ui", operation: "add-task", title: "Pending task" },
            { action: "observe", name: "pending" },
            { action: "wait-transport", operation: "push", gated: true },
            { action: "observe", name: "syncing" },
            { action: "transport", mode: "unknown-failure" },
            { action: "release-transport" },
            { action: "wait-status", status: "failed", name: "failed" },
            { action: "exit" }
          ]
        }
      });
      assert.equal(result.exitCode, 0);
      const labels = {
        idle: /\bSync\s*$/,
        setup: /set\s*up\s+sync/i,
        synced: /\bsynced\b/i,
        pending: /sync\s+pending/i,
        syncing: /syncing/i,
        failed: /sync\s+failed/i
      };
      for (const [name, label] of Object.entries(labels)) {
        const lines = result.at[name].screen.split("\n");
        assert.match(lines[0], label, `The ${name} state must remain visible in the global navigation`);
        const footer = lines.find((line) => /Ctrl\+K:\s*Help/.test(line));
        assert.equal(typeof footer, "string");
        assert.match(footer, /Ctrl\+C:\s*Exit/);
        assert.doesNotMatch(footer, /sync|pending|failed|set\s*up/i);
        assert.ok(
          lines.every((line) => line.length <= 80),
          "Status changes must remain within the real viewport"
        );
      }
      assert.match(result.at.failed.files["todos.json"], /Pending task/);
      assert.doesNotMatch(result.at.failed.remoteFiles["todos.json"], /Pending task/);
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: Object.keys(labels),
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
    const initialSize = Object.hasOwn(entry, "initialPtySize") ? entry.initialPtySize : null;
    let command = captureCommand;
    let viewport = { cols: 80, rows: 24 };
    if (initialSize !== null) {
      assert.ok(
        [initialSize.cols, initialSize.rows].every((value) => Number.isInteger(value) && value >= 0 && value <= 1000)
      );
      if (initialSize.cols === 0 || initialSize.rows === 0) {
        command = [
          "sh",
          "-c",
          `stty cols ${initialSize.cols} rows ${initialSize.rows} && exec "$@"`,
          "ilu-capture",
          ...captureCommand
        ];
      } else {
        viewport = initialSize;
      }
    }
    const result = await captureIluScenario({
      testName: context.name,
      scenario: "tuiInteraction",
      command,
      viewport,
      input: {
        seed: "seed" in entry ? entry.seed : seed,
        ...("startupSync" in entry ? { startupSync: entry.startupSync } : {}),
        ...("cliReadOnly" in entry ? { cliReadOnly: entry.cliReadOnly } : {}),
        steps: [...entry.steps, { screenshot: "result" }],
        externalIsolation: "deny-unmatched",
        finish: "normal-exit"
      }
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
