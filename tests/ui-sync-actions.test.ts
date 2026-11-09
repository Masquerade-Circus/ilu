import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { captureCommand, assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const unsafeRemoteUrls = [
  "https://user:password@example.test/repo.git",
  "https://token@example.test/repo.git",
  "https://ghp_TOKEN@example.test/repo.git",
  "ssh://git:token@example.test/repo.git"
];

const cases = [
  {
    name: "Sync UI adapter maps detailed statuses to approved safe labels",
    caseId: "sync-statuses",
    workflow: {
      fixture: {
        remote: "empty",
        initialize: true,
        removeCoreState: true,
        config: { enabled: true, autoPull: false, autoSync: false },
        legacyState: {
          status: "healthy",
          hasPendingRemote: true,
          pendingOperationId: "legacy-pending",
          lastErrorKind: null
        }
      },
      steps: [
        { action: "open", view: "Sync" },
        { action: "wait-screen", pattern: "Status:\\s*Pending sync" },
        { action: "observe", name: "condition" },
        { action: "ui", operation: "sync-retry" },
        { action: "wait-screen", pattern: "Status:\\s*Synced" },
        { action: "observe", name: "healthy" },
        { action: "close-ui" },
        { action: "open", view: "Todo" },
        { action: "ui", operation: "add-task", title: "Manual pending matrix task" },
        { action: "close-ui" },
        { action: "cli", args: ["sync", "status"], name: "raw-pending" },
        { action: "open", view: "Sync" },
        { action: "observe", name: "pending" },
        { action: "ui", operation: "sync-disable" },
        { action: "observe", name: "off" },
        { action: "ui", operation: "sync-enable" },
        { action: "wait-screen", pattern: "Status:\\s*Synced" },
        { action: "transport", mode: "network-failure" },
        { action: "ui", operation: "switch-view", view: "Todo" },
        { action: "ui", operation: "add-task", title: "Offline matrix task" },
        { action: "ui", operation: "sync-retry" },
        { action: "wait-backoff" },
        { action: "close-ui" },
        { action: "open", view: "Sync" },
        { action: "wait-screen", pattern: "Status:\\s*Sync failed" },
        { action: "observe", name: "failed" },
        { action: "close-ui" },
        { action: "configure-sync", settings: { remoteUrl: "" } },
        { action: "open", view: "Sync" },
        { action: "observe", name: "outcome" },
        { action: "exit" }
      ]
    },
    fixture: "local-remotes-status-matrix",
    journey: [
      "With separate local-only fixture states open Sync for healthy, healthy with pending work, pending_remote, disabled, misconfigured and degraded_network",
      "Inspect each status meaning without asserting exact copy"
    ],
    expected: {
      visibleStatusMeanings: ["synced", "pending", "pending", "off", "not-configured", "failed"],
      rawInternalStatusLeaked: false
    }
  },
  {
    name: "Sync UI adapter redacts unsafe command failures",
    caseId: "sync-safe-status-failure",
    workflow: {
      fixture: {
        remote: "empty",
        initialize: true,
        config: { enabled: true, autoPull: false, autoSync: false },
        pendingData: { todos: "Local pending safe failure" },
        transport: {
          arm: "after-open",
          mode: "unknown-failure",
          stderr: "SYNTHETIC_PRIVATE_PATH token=TEST_ONLY_TOKEN\n"
        }
      },
      steps: [
        { action: "open", view: "Sync" },
        { action: "observe", name: "condition" },
        { action: "ui", operation: "sync-retry" },
        { action: "wait-status", status: "failed" },
        { action: "observe", name: "outcome" },
        { action: "ui", operation: "switch-view", view: "Todo" },
        { action: "observe", name: "usable" },
        { action: "exit" }
      ]
    },
    fixture: "local-transport-failure-with-synthetic-private-detail",
    journey: [
      "Open Sync with a failing local transport",
      "Refresh status and observe a recoverable failure",
      "Inspect visible screen and details for private path and token leakage"
    ],
    expected: {
      visibleStatusMeanings: ["failed"],
      leakedPrivateDetails: false,
      localDomainFilesUnchanged: true,
      applicationUsable: true
    }
  },
  {
    name: "Sync retry, enable, and disable call command functions only after explicit action",
    caseId: "sync-explicit-controls",
    workflow: {
      fixture: { remote: "empty", initialize: true, config: { enabled: false, autoPull: false, autoSync: false } },
      steps: [
        { action: "open", view: "Sync" },
        { action: "observe", name: "condition" },
        { action: "ui", operation: "sync-retry" },
        { action: "observe", name: "retried" },
        { action: "ui", operation: "sync-enable" },
        { action: "observe", name: "enabled" },
        { action: "ui", operation: "sync-disable" },
        { action: "observe", name: "disabled" },
        { action: "close-ui" },
        { action: "open", view: "Sync" },
        { action: "observe", name: "outcome" },
        { action: "exit" }
      ]
    },
    fixture: "configured-disabled-local-remote",
    journey: [
      "Open Sync and inspect initially disabled persisted config and remote refs",
      "Verify no enable, disable or retry mutation from merely viewing",
      "Click Retry sync",
      "Click Enable sync",
      "Click Disable sync",
      "Restart"
    ],
    expected: {
      viewingChangedEnabledSetting: false,
      viewingChangedRemoteRefs: false,
      explicitOperationOrder: ["retry", "enable", "disable"],
      enabledAfterEnable: true,
      enabledAfterDisable: false,
      restoredEnabled: false
    }
  },
  {
    name: "Sync init rejects missing remote URL, branch, and confirmation without command calls",
    caseId: "sync-required-setup",
    publicFixture: { remote: "empty", denyExternalTransport: true },
    steps: [
      { remember: ["todos", "notes", "boards", "clocks", "sync-config"] },
      { key: "CTRL_5" },
      { click: "Set up sync" },
      { screenshot: "condition" },
      { click: "Set up sync", area: "overlay" },
      { expect: { invalid: true } },
      { unchanged: ["todos", "notes", "boards", "clocks", "sync-config"] },
      { syncTransportCount: 0 },
      { fill: { label: "Remote URL", valueFrom: "privateRemote" } },
      { fill: { label: "Branch", text: "   " } },
      { click: "Set up sync", area: "overlay" },
      { expect: { invalid: true } },
      { unchanged: ["todos", "notes", "boards", "clocks", "sync-config"] },
      { syncTransportCount: 0 },
      { fill: { label: "Branch", text: "main" } },
      { click: "Set up sync", area: "overlay" },
      { expect: { textPattern: "Confirm.*setup" } },
      { unchanged: ["todos", "notes", "boards", "clocks", "sync-config"] },
      { syncTransportCount: 0 },
      { screenshot: "outcome" },
      { key: "ESCAPE" }
    ],
    fixture: "unconfigured-with-local-remote",
    journey: [
      "Open setup and submit without remote URL",
      "Enter local fixture remote and clear branch, then submit",
      "Enter main without confirmation and submit",
      "Inspect config, remote refs and local files after each rejection"
    ],
    expected: {
      rejectedInputs: ["missing-remote", "missing-branch", "unconfirmed"],
      syncConfigCreated: false,
      remoteRefsUnchanged: true,
      localDomainFilesUnchanged: true
    }
  },
  {
    name: "Sync init rejects any embedded URL userinfo before command calls",
    caseId: "sync-userinfo-rejection",
    publicFixture: { remote: "empty", denyExternalTransport: true },
    steps: [
      { remember: ["todos", "notes", "boards", "clocks", "sync-config"] },
      { key: "CTRL_5" },
      { click: "Set up sync" },
      { screenshot: "condition" },
      { click: "Confirm setup", area: "overlay", occurrence: -1 },
      ...unsafeRemoteUrls.flatMap((remote) => [
        { fill: { label: "Remote URL", text: remote } },
        { fill: { label: "Branch", text: "main" } },
        { click: "Set up sync", area: "overlay" },
        { expect: { textPattern: "(?:must not|reject|not allowed).*credentials", absent: remote } },
        { unchanged: ["todos", "notes", "boards", "clocks", "sync-config"] },
        { syncTransportCount: 0 }
      ]),
      { screenshot: "outcome" },
      { key: "ESCAPE" }
    ],
    fixture: "unconfigured-deny-all-network",
    journey: [
      "Submit each synthetic URL with main and explicit confirmation",
      "Check validation before any transport attempt"
    ],
    remoteUrls: unsafeRemoteUrls,
    expected: {
      rejectedRemoteCount: 4,
      transportRequests: 0,
      syncConfigCreated: false,
      localDomainFilesUnchanged: true
    }
  },
  {
    name: "Sync init action allows SSH remotes with a normal user",
    caseId: "sync-normal-ssh-user",
    publicFixture: { remote: "empty", denyExternalTransport: true, ssh: "local-boundary" },
    steps: [
      { key: "CTRL_5" },
      { click: "Set up sync" },
      { fill: { label: "Remote URL", text: "ssh://git@ilu-sync.invalid/repo.git" } },
      { click: "Confirm setup", area: "overlay", occurrence: -1 },
      { screenshot: "condition" },
      { click: "Set up sync", area: "overlay" },
      { expect: { textPattern: "Status:.*Synced", absent: "Remote URL" } },
      {
        data: { domain: "sync-config", remoteUrl: "ssh://git@ilu-sync.invalid/repo.git", branch: "main", enabled: true }
      },
      { screenshot: "outcome" }
    ],
    fixture: "local-git-remote-with-intercepted-ssh-transport",
    journey: [
      "Set up ssh://git@example.test/repo.git with main and confirmation",
      "External SSH transport must map exclusively to the owned local bare repo",
      "Inspect configured remote and refreshed visible status"
    ],
    expected: {
      setupAccepted: true,
      configuredRemoteUrl: "ssh://git@example.test/repo.git",
      configuredBranch: "main",
      realNetworkConnections: 0,
      statusRefreshedAfterSetup: true
    }
  },
  {
    name: "Sync init preserves command safety path and refreshes status after setup",
    caseId: "sync-init-refresh-pending",
    workflow: {
      fixture: { remote: "empty", local: { todos: "Inbox", notes: "Notes" } },
      steps: [
        { action: "open", view: "Sync" },
        { action: "ui", operation: "sync-init", waitFor: "Status:.*Synced" },
        { action: "observe", name: "condition" },
        { action: "close-ui" },
        { action: "configure-sync", settings: { autoPull: false, autoSync: false } },
        { action: "transport", mode: "unknown-failure" },
        { action: "open", view: "Todo" },
        { action: "ui", operation: "add-task", title: "Retained pending work" },
        { action: "ui", operation: "sync-retry" },
        { action: "wait-screen", pattern: "Status:\\s*Sync failed" },
        { action: "observe", name: "outcome" },
        { action: "exit" }
      ]
    },
    fixture: "local-empty-remote-then-temporarily-unavailable-transport",
    journey: [
      "Set up owned empty local remote with main and confirmation",
      "Make only the local remote transport temporarily unavailable after local setup",
      "Create local pending work",
      "Refresh Sync and inspect pending state with persisted local work"
    ],
    expected: {
      setupAccepted: true,
      configuredBranch: "main",
      pendingWorkVisible: true,
      pendingWorkPersisted: true,
      localWorkPreserved: true,
      statusRefreshedAfterSetup: true
    }
  },
  {
    name: "Sync UI adapter classifies setup and init safety stops without leaking internals",
    caseId: "sync-setup-safety-stops",
    workflow: {
      fixture: {
        remote: "seeded",
        local: { todos: "Local safety list" },
        remoteData: { todos: "Remote safety list" },
        config: { enabled: true, remoteUrl: "", branch: "main", autoPull: true, autoSync: true }
      },
      steps: [
        { action: "open", view: "Sync" },
        { action: "observe", name: "condition" },
        { action: "ui", operation: "sync-init", waitFor: "Setup stopped.*protect.*files" },
        { action: "observe", name: "outcome" },
        { action: "exit" }
      ]
    },
    fixture: "missing-enabled-remote-and-both-sides-populated",
    journey: [
      "Open Sync with enabled config missing remoteUrl and inspect setup-required state",
      "In a separate private HOME attempt confirmed init with both local and owned local remote already populated",
      "Inspect safety stop and compare both histories and domain files"
    ],
    expected: {
      missingRemoteRequiresSetup: true,
      conflictingInitRejected: true,
      localDomainFilesUnchanged: true,
      remoteRefsUnchanged: true,
      leakedPrivateDetails: false
    }
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
      if (entry.caseId === "sync-statuses") {
        const legacy = JSON.parse(result.at.condition.files[".sync-core/state.json"]);
        assert.equal(legacy.status, "healthy");
        assert.equal(legacy.hasPendingRemote, true);
        for (const [checkpoint, meaning] of [
          ["condition", /Status:\s*Pending sync/i],
          ["healthy", /Status:\s*Synced/i],
          ["pending", /Status:\s*Pending sync/i],
          ["off", /Status:\s*Sync off/i],
          ["failed", /Status:\s*Sync failed/i],
          ["outcome", /Status:\s*Not set up/i]
        ]) {
          assert.match(result.at[checkpoint].screen, meaning, checkpoint);
          assert.doesNotMatch(
            result.at[checkpoint].screen,
            /healthy|pending_remote|degraded_network|misconfigured/i,
            checkpoint
          );
        }
        assert.match(result.at["raw-pending"].screen, /Sync:\s*pending_remote/i);
        assert.equal(JSON.parse(result.at.failed.files[".sync-core/state.json"]).status, "degraded_network");
      }
      if (entry.caseId === "sync-init-refresh-pending") {
        const config = JSON.parse(result.at.condition.files[".config/sync-config.json"]);
        assert.equal(config.enabled, true);
        assert.equal(config.branch, "main");
        assert.match(result.at.condition.screen, /Status:\s*Synced/i);
        assert.match(result.at.outcome.files["todos.json"], /Retained pending work/);
        assert.doesNotMatch(result.at.outcome.remoteFiles["todos.json"], /Retained pending work/);
        assert.notEqual(result.at.outcome.files[".config/sync-pending.json"], null);
        assert.match(result.at.outcome.screen, /Pending sync:\s*yes/i);
        assert.ok(result.at.outcome.transport.some((event) => event.exitCode === 128));
      }
      if (entry.caseId === "sync-setup-safety-stops") {
        assert.match(result.at.condition.screen, /Status:\s*Not set up/i);
        assert.match(result.at.outcome.screen, /Setup stopped.*protect.*files/i);
        assert.doesNotMatch(result.at.outcome.screen, /Initialization stopped|Error:|at .*\.ts:/);
        assert.equal(result.at.outcome.remoteHead, result.at.condition.remoteHead);
        for (const file of ["todos.json", "notes.json", "boards.json", "clocks.json", ".config/sync-config.json"]) {
          assert.equal(result.at.outcome.files[file], result.at.condition.files[file], file);
          assert.equal(result.at.outcome.remoteFiles[file], result.at.condition.remoteFiles[file], `remote: ${file}`);
        }
      }
      if (entry.caseId === "sync-safe-status-failure") {
        assert.match(result.at.outcome.screen, /Status:\s*Sync failed/i);
        assert.match(result.at.usable.screen, /Local pending safe failure/);
        for (const checkpoint of ["outcome", "usable"]) {
          assert.doesNotMatch(result.at[checkpoint].screen, /SYNTHETIC_PRIVATE_PATH|TEST_ONLY_TOKEN|fatal:|at .*\.ts:/);
          for (const file of ["todos.json", "notes.json", "boards.json", "clocks.json"]) {
            assert.equal(result.at[checkpoint].files[file], result.at.condition.files[file], `${checkpoint}: ${file}`);
          }
          assert.equal(result.at[checkpoint].remoteHead, result.at.condition.remoteHead);
        }
        assert.ok(
          result.at.outcome.transport.some((event) => event.exitCode === 128 && /TEST_ONLY_TOKEN/.test(event.stderr))
        );
      }
      if (entry.caseId === "sync-explicit-controls") {
        const initial = result.at.condition;
        assert.equal(JSON.parse(initial.files[".config/sync-config.json"]).enabled, false);
        assert.equal(initial.transport.length, 0);
        for (const [checkpoint, enabled] of [
          ["retried", false],
          ["enabled", true],
          ["disabled", false],
          ["outcome", false]
        ]) {
          const observed = result.at[checkpoint];
          assert.equal(JSON.parse(observed.files[".config/sync-config.json"]).enabled, enabled, checkpoint);
          assert.equal(observed.remoteHead, initial.remoteHead, checkpoint);
          assert.equal(observed.files["todos.json"], initial.files["todos.json"], checkpoint);
          assert.match(observed.screen, enabled ? /Status:\s*Synced/i : /Status:\s*Sync off/i, checkpoint);
        }
      }
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: entry.workflow.steps.filter((step) => typeof step.name === "string").map((step) => step.name),
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
    if (Object.hasOwn(entry, "steps")) {
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "tuiInteraction",
        command: captureCommand,
        viewport: { cols: 100, rows: 40 },
        input: {
          syncFixture: entry.publicFixture,
          steps: entry.steps,
          externalIsolation: "deny-unmatched",
          finish: "normal-exit"
        }
      });
      assert.equal(result.exitCode, 0);
      if (entry.caseId === "sync-normal-ssh-user") {
        const started = result.syncTransport.filter((event) => !Object.hasOwn(event, "finishedAt"));
        const finished = result.syncTransport.filter((event) => Object.hasOwn(event, "finishedAt"));
        assert.ok(started.length > 0 && started.every((event) => event.protocol === "ssh" && event.local === true));
        assert.equal(finished.length, started.length);
        assert.ok(finished.every((event) => event.exitCode === 0));
      }
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: ["condition", "outcome"],
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
    const result = await captureIluScenario({
      testName: context.name,
      scenario: "adapterBehavior",
      command: ["node", "bin/cli.js", "ui"],
      input: {
        area: "sync",
        caseId: entry.caseId,
        fixture: entry.fixture,
        journey: entry.journey,
        remoteUrls: "remoteUrls" in entry ? entry.remoteUrls : []
      },
      viewport: { cols: 100, rows: 40 }
    });
    assert.equal(result.exitCode, 0);
    for (const [key, expected] of Object.entries(entry.expected)) {
      assert.deepEqual(result.observed[key], expected, `${entry.caseId}: ${key}`);
    }
    assertCaptureArtifacts({
      result,
      testName: context.name,
      checkpoints: ["condition", "outcome"],
      diagnostic: (message) => context.diagnostic(message)
    });
  });
}
