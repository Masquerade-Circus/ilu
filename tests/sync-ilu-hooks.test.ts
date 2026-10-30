import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios";

const workflows = [
  {
    name: "ilu sync hook logs syncing before notifying a local mutation",
    fixture: { remote: "empty", initialize: true, config: { autoPull: false }, transport: { gate: "push" } },
    steps: [
      { action: "cli-ui", args: ["todo", "--add"], answers: { title: "Visible progress", description: "" }, background: true },
      { action: "wait-transport", operation: "push", name: "syncing" },
      { action: "release-transport" },
      { action: "wait-command", name: "saved" },
    ],
    check({ at }) {
      assert.match(at.syncing.screen, /sync/i);
      assert.doesNotMatch(at.syncing.remoteFiles["todos.json"] ?? "", /Visible progress/);
      assert.equal(at.saved.exitCode, 0);
      assert.match(at.saved.remoteFiles["todos.json"], /Visible progress/);
    },
  },
  {
    name: "ilu sync hook keeps direct auto sync when only a status subscriber is present",
    fixture: { remote: "empty", initialize: true, config: { autoPull: false } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Subscriber mutation" },
      { action: "settle-sync", name: "saved" },
    ],
    check({ at }) {
      assert.match(at.saved.screen, /synced|healthy/i);
      assert.match(at.saved.remoteFiles["todos.json"], /Subscriber mutation/);
      assert.equal(at.saved.files[".config/sync-pending.json"], null);
    },
  },
  {
    name: "ilu sync hook does not debounce direct auto sync with status subscriber only",
    fixture: { remote: "empty", initialize: true, config: { autoPull: false } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Direct first" },
      { action: "settle-sync", beforeDebounce: true, name: "first" },
      { action: "ui", operation: "add-task", title: "Direct second" },
      { action: "settle-sync", beforeDebounce: true, name: "second" },
    ],
    check({ at }) {
      assert.match(at.first.remoteFiles["todos.json"], /Direct first/);
      assert.doesNotMatch(at.first.remoteFiles["todos.json"], /Direct second/);
      assert.match(at.second.remoteFiles["todos.json"], /Direct first/);
      assert.match(at.second.remoteFiles["todos.json"], /Direct second/);
      assert.notEqual(at.first.remoteHead, at.second.remoteHead);
      assert.ok(at.first.elapsedSinceMutationMs < 5000, "a status-only subscriber must not introduce the TUI runner debounce");
      assert.ok(at.second.elapsedSinceMutationMs < 5000);
    },
  },
  {
    name: "ilu sync hook flushPending is a no-op when only status subscriber exists",
    fixture: { remote: "empty", initialize: true, config: { autoPull: false } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Single publication" },
      { action: "settle-sync", beforeDebounce: true, name: "saved" },
      { action: "close-ui" },
      { action: "cli", args: ["sync", "status"], name: "idle" },
    ],
    check({ at }) {
      assert.match(at.saved.remoteFiles["todos.json"], /Single publication/);
      assert.equal(at.idle.remoteHead, at.saved.remoteHead, "reading status after command shutdown must not duplicate the publication");
      assert.equal(at.idle.transport.filter(event => event.operation === "push").length, at.saved.transport.filter(event => event.operation === "push").length);
      assert.match(at.idle.screen, /healthy/i);
    },
  },
  {
    name: "ilu sync hook reports failed instead of synced when runtime persists a degraded state",
    fixture: { remote: "empty", initialize: true, config: { autoPull: false }, transport: { mode: "network-failure" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Degraded task" },
      { action: "wait-status", status: "degraded_network", name: "failed" },
    ],
    check({ at }) {
      assert.match(at.failed.screen, /failed|unavailable|pending/i);
      assert.doesNotMatch(at.failed.screen, /synced|healthy/i);
      assert.match(at.failed.files["todos.json"], /Degraded task/);
      assert.doesNotMatch(at.failed.remoteFiles["todos.json"] ?? "", /Degraded task/);
      assert.equal(JSON.parse(at.failed.files[".sync-core/state.json"]).hasPendingRemote, true);
    },
  },
  {
    name: "ilu sync hook does not report active syncing when autoSync is disabled",
    fixture: { remote: "empty", initialize: true, config: { autoSync: false, autoPull: false } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Deferred task" },
      { action: "wait-status", status: "pending_remote", name: "pending" },
    ],
    check({ at }) {
      assert.match(at.pending.screen, /pending/i);
      assert.doesNotMatch(at.pending.screen, /syncing|synced|healthy/i);
      assert.equal(at.pending.transport.length, 0);
      assert.match(at.pending.files["todos.json"], /Deferred task/);
      assert.doesNotMatch(at.pending.remoteFiles["todos.json"] ?? "", /Deferred task/);
      assert.ok(at.pending.files[".config/sync-pending.json"]);
    },
  },
  {
    name: "ilu sync hook reports setup instead of failed when sync is enabled without remote config",
    fixture: { remote: "none", config: { enabled: true, remoteUrl: null, autoSync: true } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Setup task" },
      { action: "wait-status", status: "setup", name: "setup" },
    ],
    check({ at }) {
      assert.match(at.setup.screen, /setup/i);
      assert.doesNotMatch(at.setup.screen, /failed|synced/i);
      assert.match(at.setup.files["todos.json"], /Setup task/);
      assert.equal(at.setup.transport.length, 0);
    },
  },
  {
    name: "ilu sync hook debounces configured TUI runner even without status subscribers",
    // The real TUI subscribes to status. Preserve deferred publication and exit
    // flush through that public route, without fabricating a no-listener mode.
    fixture: { remote: "empty", initialize: true, config: { autoPull: true } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "observe", name: "idle" },
      { action: "ui", operation: "add-task", title: "Exit flush task" },
      { action: "observe", name: "pending", beforeDebounce: true },
      { action: "close-ui", name: "flushed" },
    ],
    check({ at }) {
      assert.match(at.pending.files["todos.json"], /Exit flush task/);
      assert.match(at.pending.screen, /pending/i);
      assert.ok(at.pending.elapsedSinceMutationMs < 5000);
      assert.equal(at.pending.transport.filter(event => event.operation === "push").length, at.idle.transport.filter(event => event.operation === "push").length);
      assert.equal(at.pending.remoteHead, at.idle.remoteHead);
      assert.doesNotMatch(at.pending.remoteFiles["todos.json"] ?? "", /Exit flush task/);
      assert.equal(at.flushed.exitCode, 0);
      assert.match(at.flushed.remoteFiles["todos.json"], /Exit flush task/);
      assert.equal(at.flushed.files[".config/sync-pending.json"], null);
    },
  },
  {
    name: "ilu sync hook sends interactive mutations through configured TUI runner instead of direct runtime",
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, transport: { gate: "push", arm: "after-open" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Background task" },
      { action: "wait-transport", operation: "push" },
      { action: "ui", operation: "switch-view", view: "Notes" },
      { action: "observe", name: "responsive" },
      { action: "release-transport" },
      { action: "settle-sync", name: "saved" },
    ],
    check({ at }) {
      assert.match(at.responsive.screen, /Add note/);
      assert.doesNotMatch(at.responsive.remoteFiles["todos.json"] ?? "", /Background task/);
      assert.match(at.saved.remoteFiles["todos.json"], /Background task/);
      assert.match(at.saved.screen, /synced|healthy/i);
    },
  },
  {
    name: "ilu sync hook preserves setup classification from configured TUI runner errors",
    // Missing remote configuration selects the direct executor in production.
    // The preserved guarantee is visible setup classification and durable local
    // work, not injection of an error into a runner that cannot start this way.
    fixture: { remote: "none", config: { enabled: true, remoteUrl: null, autoSync: true } },
    steps: [
      { action: "open", view: "Board" },
      { action: "ui", operation: "add-board", title: "Unconfigured board" },
      { action: "wait-status", status: "setup", name: "setup" },
    ],
    check({ at }) {
      assert.match(at.setup.screen, /setup/i);
      assert.doesNotMatch(at.setup.screen, /failed|synced/i);
      assert.match(at.setup.files["boards.json"], /Unconfigured board/);
      assert.equal(at.setup.transport.length, 0);
    },
  },
  {
    name: "ilu sync hook completes debounced board move status when runner resolves without a terminal event",
    // Preserve the completed move and its terminal visible status. The real
    // runner owns event delivery, so this case does not suppress its events or
    // claim coverage of the synthetic missing-event fallback branch.
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, local: { boards: "Move board", card: "Move card" } },
    steps: [
      { action: "open", view: "Board" },
      { action: "ui", operation: "move-card", title: "Move card", column: "Ready" },
      { action: "settle-sync", name: "saved" },
    ],
    check({ at }) {
      assert.match(at.saved.screen, /synced|healthy/i);
      const snapshot = JSON.parse(at.saved.remoteFiles["boards.json"]);
      const boards = Array.isArray(snapshot) ? snapshot : snapshot.collections.boards.data;
      assert.ok(boards.some(board => board.columns.some(column => column.title === "Ready" && column.cards.some(card => card.title === "Move card"))));
      assert.equal(at.saved.files[".config/sync-pending.json"], null);
    },
  },
  {
    name: "ilu sync hook does not synthesize synced while runner has queued work",
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, transport: { gate: "push", releases: "one-at-a-time", arm: "after-open" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Queued first" },
      { action: "wait-transport", operation: "push" },
      { action: "ui", operation: "add-task", title: "Queued second" },
      { action: "wait-debounce" },
      { action: "release-transport", count: 1 },
      { action: "wait-transport", operation: "push", occurrence: 2, name: "queued" },
      { action: "release-transport" },
      { action: "settle-sync", name: "saved" },
    ],
    check({ at }) {
      assert.doesNotMatch(at.queued.screen, /synced|healthy/i);
      assert.doesNotMatch(at.queued.remoteFiles["todos.json"] ?? "", /Queued second/);
      assert.match(at.saved.remoteFiles["todos.json"], /Queued first/);
      assert.match(at.saved.remoteFiles["todos.json"], /Queued second/);
      assert.match(at.saved.screen, /synced|healthy/i);
    },
  },
];

for (const { name, fixture, steps, check } of workflows) {
  test(name, async (t) => {
    const checkpoints = steps.filter(step => typeof step.name === "string").map(step => step.name);
    const result = await captureIluScenario({ testName: t.name, command: ["bash", "--noprofile", "--norc"], scenario: "syncWorkflow", input: { fixture, steps: [...steps, { action: "exit" }] } });
    assertCaptureArtifacts({ result, checkpoints, testName: t.name, diagnostic: message => t.diagnostic(message) });
    check(result);
    assert.equal(result.exitCode, 0);
  });
}
