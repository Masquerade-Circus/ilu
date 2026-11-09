import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { captureCommand, assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

// syncBoundary controls only the external Git transport, never syncActions,
// createTuiSyncClient or application state. Every remote is capture-owned. SSH
// acceptance uses a controlled transport, with unmatched network denied.
const cases = [
  [
    "terminal integration Sync LogView preserves readable ordered details with its default renderer",
    [
      { key: "CTRL_5" },
      {
        expect: {
          orderedStatusDetails: ["status", "pending-remote"],
          minimumVisibleDetails: 2,
          lastDetail: "pending-remote",
          absent: "[object Object]"
        }
      },
      { screenshot: "result" }
    ]
  ],
  [
    "Sync app opens from top nav and shows detailed status",
    [
      { click: "Sync", area: "nav" },
      {
        expect: {
          texts: ["Status:", "Retry sync", "Enable sync", "Disable sync", "Set up sync"],
          sameRowOrdered: ["Todo", "Notes", "Board", "Clocks"],
          withinViewport: true
        }
      },
      { screenshot: "result" }
    ],
    "no-remote"
  ],
  [
    "Sync app renders action controls in the bottom action area",
    [
      { key: "CTRL_5" },
      {
        expect: {
          pageBottomActions: ["Retry sync", "Enable sync", "Disable sync", "Set up sync"],
          withinViewport: true
        }
      },
      { screenshot: "result" }
    ],
    "no-remote"
  ],
  [
    "Sync retry updates visible status through the utility command path",
    [
      { key: "CTRL_5" },
      { click: "Retry sync" },
      { expect: { syncStatus: "synced", absent: ["CANARY_SECRET", "stack"] } },
      { remoteData: { matchesLocal: true } },
      { screenshot: "result" }
    ]
  ],
  [
    "Sync setup overlay pins setup actions to the overlay bottom",
    [
      { key: "CTRL_5" },
      { click: "Set up sync" },
      { expect: { overlayBottomActions: ["Confirm setup", "Set up sync", "Cancel"], withinViewport: true } },
      { screenshot: "result" },
      { key: "ESCAPE" }
    ],
    "no-remote"
  ],
  [
    "Ctrl+C exits when Help is above Sync setup overlay",
    [
      { key: "CTRL_5" },
      { click: "Set up sync" },
      { key: "CTRL_K" },
      { expect: { text: "Sync help" } },
      { screenshot: "result" },
      { key: "CTRL_C" },
      { expectExit: 0 }
    ],
    "no-remote"
  ],
  [
    "Sync init form requires explicit confirmation and keeps test remote under repo tmp",
    [
      { remember: ["sync-config"] },
      { key: "CTRL_5" },
      { click: "Set up sync" },
      { click: "Set up sync", area: "overlay" },
      { expect: { invalid: true } },
      { unchanged: ["sync-config"] },
      { syncTransportCount: 0 },
      { fill: { label: "Remote URL", valueFrom: "privateRemote" } },
      { click: "Set up sync", area: "overlay" },
      { expect: { textPattern: "Confirm.*setup" } },
      { unchanged: ["sync-config"] },
      { syncTransportCount: 0 },
      { click: "Confirm setup", area: "overlay", occurrence: -1 },
      { click: "Set up sync", area: "overlay" },
      { expect: { textPattern: "Status:.*Synced", absent: "Remote URL" } },
      { data: { domain: "sync-config", enabled: true, branch: "main", remoteUnderPrivateWorkspace: true } },
      { screenshot: "result" }
    ],
    "private-local"
  ],
  [
    "Sync init blocks embedded credentials before calling the action",
    [
      { remember: ["sync-config"] },
      { key: "CTRL_5" },
      { click: "Set up sync" },
      { fill: { label: "Remote URL", text: "https://user:CANARY_SECRET@example.test/repo.git" } },
      { click: "Confirm setup" },
      { click: "Set up sync", area: "overlay" },
      { expect: { textPattern: "(?:must not|reject|not allowed).*credentials", absent: "CANARY_SECRET" } },
      { syncTransportCount: 0 },
      { unchanged: ["sync-config"] },
      { screenshot: "result" },
      { key: "ESCAPE" }
    ],
    "private-unconfigured"
  ],
  [
    "Sync init blocks SSH password before calling the action",
    [
      { remember: ["sync-config"] },
      { key: "CTRL_5" },
      { click: "Set up sync" },
      { fill: { label: "Remote URL", text: "ssh://git:CANARY_SECRET@example.test/repo.git" } },
      { click: "Confirm setup" },
      { click: "Set up sync", area: "overlay" },
      { expect: { textPattern: "(?:must not|reject|not allowed).*credentials", absent: "CANARY_SECRET" } },
      { syncTransportCount: 0 },
      { unchanged: ["sync-config"] },
      { screenshot: "result" },
      { key: "ESCAPE" }
    ],
    "private-unconfigured"
  ],
  [
    "Sync init form allows SSH remotes with a normal user",
    [
      { key: "CTRL_5" },
      { click: "Set up sync" },
      { fill: { label: "Remote URL", text: "ssh://git@ilu-sync.invalid/repo.git" } },
      { click: "Confirm setup" },
      { click: "Set up sync", area: "overlay" },
      { expect: { textPattern: "Status:.*Synced", absent: "Remote URL" } },
      {
        data: { domain: "sync-config", remoteUrl: "ssh://git@ilu-sync.invalid/repo.git", branch: "main", enabled: true }
      },
      { screenshot: "result" }
    ],
    "private-ssh"
  ],
  [
    "Esc keeps Sync app open when no secondary overlay is active",
    [{ key: "CTRL_5" }, { key: "ESCAPE" }, { expect: { text: "Retry sync" } }, { screenshot: "result" }]
  ],
  [
    "Sync enable and disable update status through visible utility controls",
    [
      { key: "CTRL_5" },
      { click: "Enable sync" },
      { data: { domain: "sync-config", enabled: true } },
      { click: "Disable sync" },
      { data: { domain: "sync-config", enabled: false } },
      { expect: { syncStatus: "off" } },
      { screenshot: "result" }
    ],
    "disabled"
  ],
  [
    "Sync utility prevents duplicate operation while a command is pending",
    [
      { syncBoundary: { defer: "retry", as: "retry" } },
      { key: "CTRL_5" },
      { click: "Retry sync" },
      { click: "Retry sync" },
      { remoteOperations: { retry: 1 } },
      { expect: { pending: true } },
      { screenshot: "result" },
      { releaseSyncBoundary: "retry" },
      { expect: { syncStatus: "synced", pending: false } },
      { remoteData: { matchesLocal: true } }
    ]
  ]
] as const;

for (const [name, steps, fixture] of cases) {
  test(name, async (context) => {
    if (name === "Sync utility prevents duplicate operation while a command is pending") {
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "syncWorkflow",
        command: ["sh"],
        viewport: { cols: 80, rows: 24 },
        input: {
          fixture: {
            remote: "empty",
            initialize: true,
            local: { todos: [{ title: "Today", tasks: [], current: true }] },
            config: { autoPull: false, autoSync: false }
          },
          steps: [
            { action: "open", view: "Todo" },
            { action: "ui", operation: "add-task", title: "One manual retry" },
            { action: "ui", operation: "switch-view", view: "Sync" },
            { action: "transport", mode: "network-failure" },
            { action: "ui", operation: "sync-retry" },
            { action: "wait-backoff" },
            { action: "ui", operation: "sync-retry" },
            { action: "observe", name: "pending" },
            { action: "transport", mode: "healthy" },
            { action: "settle-sync", name: "saved" },
            { action: "observe-after-retry-window", name: "result" },
            { action: "close-ui" },
            { action: "exit" }
          ]
        }
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.at.pending.screen, /Sync in progress|Pending sync/);
      assert.match(result.at.result.screen, /Status:.*Synced/i);
      assert.equal(result.at.result.files["todos.json"], result.at.result.remoteFiles["todos.json"]);
      const successfulPushes = result.at.result.transport.filter(
        (event) => event.operation === "push" && event.exitCode === 0
      );
      assert.equal(
        successfulPushes.length,
        1,
        "A second activation during retry backoff must not schedule another publication"
      );
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: ["pending", "saved", "result"],
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
    if (name === "Sync enable and disable update status through visible utility controls") {
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "syncWorkflow",
        command: ["sh"],
        viewport: { cols: 80, rows: 24 },
        input: {
          fixture: {
            remote: "empty",
            initialize: true,
            local: { todos: [{ title: "Today", tasks: [], current: true }] },
            config: { enabled: false, autoPull: false }
          },
          steps: [
            { action: "open", view: "Sync" },
            { action: "observe", name: "disabled" },
            { action: "ui", operation: "sync-enable" },
            { action: "observe", name: "enabled" },
            { action: "ui", operation: "sync-disable" },
            { action: "observe", name: "result" },
            { action: "close-ui" },
            { action: "exit" }
          ]
        }
      });
      assert.equal(result.exitCode, 0);
      assert.equal(JSON.parse(result.at.disabled.files[".config/sync-config.json"]).enabled, false);
      assert.equal(JSON.parse(result.at.enabled.files[".config/sync-config.json"]).enabled, true);
      assert.equal(JSON.parse(result.at.result.files[".config/sync-config.json"]).enabled, false);
      assert.match(result.at.result.screen, /Status:.*off/i);
      assert.equal(result.at.result.files["todos.json"], result.at.disabled.files["todos.json"]);
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: ["disabled", "enabled", "result"],
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
    if (
      name === "terminal integration Sync LogView preserves readable ordered details with its default renderer" ||
      name === "Sync retry updates visible status through the utility command path"
    ) {
      const retry = name === "Sync retry updates visible status through the utility command path";
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "syncWorkflow",
        command: ["sh"],
        viewport: { cols: 80, rows: 24 },
        input: {
          fixture: {
            remote: "empty",
            initialize: true,
            local: { todos: [{ title: "Today", tasks: [], current: true }] },
            config: { autoPull: false, autoSync: false }
          },
          steps: [
            { action: "open", view: "Todo" },
            { action: "ui", operation: "add-task", title: "Pending log task" },
            { action: "ui", operation: "switch-view", view: "Sync" },
            ...(retry
              ? [
                  { action: "ui", operation: "sync-retry" },
                  { action: "settle-sync", name: "result" }
                ]
              : [{ action: "observe", name: "result" }]),
            { action: "close-ui" },
            { action: "exit" }
          ]
        }
      });
      assert.equal(result.exitCode, 0);
      assert.doesNotMatch(result.at.result.screen, /\[object Object\]/);
      assert.ok(result.at.result.files["todos.json"].includes("Pending log task"));
      if (retry) {
        assert.match(result.at.result.screen, /Status:.*synced/i);
        assert.doesNotMatch(result.at.result.screen, /CANARY_SECRET|\bstack\b/);
        assert.equal(result.at.result.remoteFiles["todos.json"], result.at.result.files["todos.json"]);
        assert.equal(result.at.result.files[".config/sync-pending.json"], null);
      } else {
        const lines = result.at.result.screen.split("\n");
        const status = lines.findIndex((line) => /Status:.*pending/i.test(line));
        const pending = lines.findIndex((line) => /Pending sync:\s*yes/i.test(line));
        assert.ok(
          status >= 0 && pending > status,
          "Status and pending details must remain readable in their real order"
        );
        assert.ok(!result.at.result.remoteFiles["todos.json"].includes("Pending log task"));
      }
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: ["result"],
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
    const result = await captureIluScenario({
      testName: context.name,
      scenario: "tuiInteraction",
      command: captureCommand,
      viewport: { cols: 80, rows: 24 },
      input: {
        ...(fixture === "private-unconfigured" || fixture === "private-local" || fixture === "private-ssh"
          ? {
              syncFixture: {
                remote: "empty",
                denyExternalTransport: fixture !== "private-local",
                ...(fixture === "private-ssh" ? { ssh: "local-boundary" } : {})
              }
            }
          : fixture === "no-remote" || name === "Esc keeps Sync app open when no secondary overlay is active"
            ? {}
            : { startupSync: { fixture: fixture ?? "local-pending-private-remote", autoPull: false } }),
        steps,
        externalIsolation: "deny-unmatched",
        finish: "normal-exit"
      }
    });
    assert.equal(result.exitCode, 0);
    if (fixture === "private-ssh") {
      const started = result.syncTransport.filter((event) => !Object.hasOwn(event, "finishedAt"));
      const finished = result.syncTransport.filter((event) => Object.hasOwn(event, "finishedAt"));
      assert.ok(started.length > 0 && started.every((event) => event.protocol === "ssh" && event.local === true));
      assert.equal(finished.length, started.length);
      assert.ok(finished.every((event) => event.exitCode === 0));
    }
    assertCaptureArtifacts({
      result,
      testName: context.name,
      checkpoints: ["result"],
      diagnostic: (message) => context.diagnostic(message)
    });
  });
}
