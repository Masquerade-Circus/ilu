import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios";

// Gates and failures belong exclusively to the external Git executable or to
// controlled fixture files. Never replace sync(), reconcileFile(), fork() or
// process.exit(). Original names identify the source cases, not coverage claims
// for injected callbacks or malformed IPC that users cannot produce in the TUI.
const workflows = [
  {
    name: "TUI sync runner rejects malformed IPC messages without touching sync runtime",
    // Observable replacement: invalid and cancelled drafts cannot mutate data
    // or enqueue sync. This does not exercise the malformed-IPC parser branch.
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, local: { todos: "Invalid input unchanged" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "observe", name: "before" },
      { action: "ui", operation: "add-task", title: "", submit: true },
      { action: "observe", name: "missing" },
      { action: "ui", operation: "cancel-dialog" },
      { action: "ui", operation: "add-task", title: "   ", submit: true },
      { action: "observe", name: "blank" },
      { action: "ui", operation: "cancel-dialog" },
      { action: "ui", operation: "add-task", title: "Cancelled invalid-operation probe", confirm: false },
      { action: "observe", name: "cancelled" },
    ],
    check({ at }) {
      for (const name of ["missing", "blank", "cancelled"]) {
        assert.equal(at[name].transport.length, at.before.transport.length);
        assert.equal(at[name].files["todos.json"], at.before.files["todos.json"]);
        assert.equal(at[name].files[".config/sync-pending.json"], at.before.files[".config/sync-pending.json"]);
        assert.equal(at[name].remoteHead, at.before.remoteHead);
      }
      assert.match(at.missing.screen, /required|empty|title/i);
      assert.match(at.blank.screen, /required|empty|title/i);
      assert.match(at.cancelled.screen, /Invalid input unchanged/);
      assert.doesNotMatch(at.cancelled.screen, /Cancelled invalid-operation probe/);
    },
  },
  {
    name: "TUI sync runner keeps one active Git sync and coalesces mutations for the next run",
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, transport: { gate: "push", releases: "one-at-a-time", arm: "after-open" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Active mutation" },
      { action: "wait-transport", operation: "push" },
      { action: "ui", operation: "add-task", title: "Queued mutation one" },
      { action: "ui", operation: "add-task", title: "Queued mutation two" },
      { action: "wait-debounce" },
      { action: "observe", name: "active" },
      { action: "release-transport", count: 1 },
      { action: "wait-transport", operation: "push", occurrence: 2, name: "trailing" },
      { action: "release-transport" },
      { action: "settle-sync", name: "saved" },
    ],
    check({ at }) {
      assert.equal(at.active.transport.filter(event => event.operation === "push").length, 1);
      assert.doesNotMatch(at.trailing.screen, /synced|healthy/i);
      const pushes = at.saved.transport.filter(event => event.operation === "push");
      assert.equal(pushes.length, 2, "mutations queued behind the first publication must coalesce into one trailing publication");
      assert.ok(pushes[1].startedAt >= pushes[0].finishedAt);
      for (const title of ["Active mutation", "Queued mutation one", "Queued mutation two"]) {
        assert.ok(at.saved.remoteFiles["todos.json"].includes(title));
      }
    },
  },
  {
    name: "TUI sync runner does not start queued mutation after active sync fails",
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, transport: { gate: "push", arm: "after-open" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Active write failure" },
      { action: "wait-transport", operation: "push" },
      { action: "ui", operation: "add-task", title: "Retained queued write" },
      { action: "wait-debounce" },
      { action: "filesystem-fault", target: "runtime-state", mode: "not-directory" },
      { action: "release-transport" },
      { action: "wait-status", status: "failed", name: "failed" },
      { action: "filesystem-fault", target: "runtime-state", mode: "restore" },
    ],
    check({ at }) {
      assert.equal(at.failed.transport.filter(event => event.operation === "push").length, 1);
      assert.match(at.failed.screen, /failed/i);
      assert.doesNotMatch(at.failed.screen, /synced|healthy/i);
      assert.match(at.failed.files["todos.json"], /Retained queued write/);
      assert.doesNotMatch(at.failed.remoteFiles["todos.json"] ?? "", /Retained queued write/);
      assert.ok(at.failed.files[".config/sync-pending.json"]);
    },
  },
  {
    name: "TUI sync runner reports failed instead of setup when a coalesced mutation hits a backend error with valid config",
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, transport: { gate: "push", releases: "one-at-a-time", arm: "after-open" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Before backend failure" },
      { action: "wait-transport", operation: "push" },
      { action: "ui", operation: "add-task", title: "After backend failure" },
      { action: "wait-debounce" },
      { action: "release-transport", count: 1 },
      { action: "wait-transport", operation: "push", occurrence: 2 },
      { action: "transport", mode: "unknown-failure" },
      { action: "release-transport" },
      { action: "wait-status", status: "failed", name: "failed" },
    ],
    check({ at }) {
      assert.match(at.failed.screen, /failed/i);
      assert.doesNotMatch(at.failed.screen, /setup|synced|healthy/i);
      assert.equal(JSON.parse(at.failed.files[".config/sync-config.json"]).enabled, true);
      const state = JSON.parse(at.failed.files[".sync-core/state.json"]);
      assert.equal(state.hasPendingRemote, true);
      assert.equal(state.lastErrorKind, "unknown");
      assert.match(at.failed.files["todos.json"], /After backend failure/);
      assert.doesNotMatch(at.failed.remoteFiles["todos.json"] ?? "", /After backend failure/);
    },
  },
  {
    name: "TUI sync runner flush waits for active and queued mutation before shutdown result",
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, transport: { gate: "push", releases: "one-at-a-time", arm: "after-open" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Shutdown active" },
      { action: "wait-transport", operation: "push" },
      { action: "ui", operation: "add-task", title: "Shutdown queued" },
      { action: "close-ui", background: true },
      { action: "observe", name: "waiting" },
      { action: "release-transport", count: 1 },
      { action: "wait-transport", operation: "push", occurrence: 2, name: "trailing" },
      { action: "release-transport" },
      { action: "wait-command", name: "closed" },
    ],
    check({ at }) {
      assert.equal(at.waiting.applicationExited, false);
      assert.equal(at.trailing.applicationExited, false);
      assert.equal(at.closed.exitCode, 0);
      assert.match(at.closed.remoteFiles["todos.json"], /Shutdown active/);
      assert.match(at.closed.remoteFiles["todos.json"], /Shutdown queued/);
      assert.equal(at.closed.files[".config/sync-pending.json"], null);
    },
  },
  {
    name: "TUI sync runner waits for active and trailing mutations before file recovery",
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, transport: { gate: "push", releases: "one-at-a-time", arm: "after-open" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Recovery active" },
      { action: "wait-transport", operation: "push" },
      { action: "ui", operation: "add-task", title: "Recovery trailing" },
      { action: "wait-debounce" },
      { action: "external-writer", domain: "todos", values: { description: "Current external snapshot" }, publish: false },
      { action: "ui", operation: "add-task", title: "Stale rejected" },
      { action: "observe", name: "waiting" },
      { action: "release-transport", count: 1 },
      { action: "wait-transport", operation: "push", occurrence: 2, name: "trailing" },
      { action: "release-transport" },
      { action: "wait-recovery", name: "recovered" },
    ],
    check({ at }) {
      assert.equal(at.waiting.transport.filter(event => event.operation === "push").length, 1);
      assert.doesNotMatch(at.waiting.files["todos.json"], /Stale rejected/);
      assert.match(at.recovered.files["todos.json"], /Current external snapshot/);
      assert.doesNotMatch(at.recovered.files["todos.json"], /Stale rejected/);
      assert.match(at.recovered.screen, /repeat|retry|changed/i);
      const pushes = at.recovered.transport.filter(event => event.operation === "push");
      assert.ok(pushes.length >= 2);
      for (let index = 1; index < pushes.length; index += 1) {
        assert.ok(pushes[index].startedAt >= pushes[index - 1].finishedAt);
      }
    },
  },
  {
    name: "TUI sync runner serializes recoveries for different files",
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, local: { todos: "Recovery todo", notes: "Recovery note" }, transport: { gate: "push", releases: "one-at-a-time", arm: "after-open" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "external-writer", domain: "todos", values: { description: "External todo" }, publish: false },
      { action: "external-writer", domain: "notes", values: { description: "External note" }, publish: false },
      { action: "ui", operation: "add-task", title: "Rejected stale todo", background: true },
      { action: "wait-transport", operation: "push", name: "first" },
      { action: "ui", operation: "add-note", title: "Rejected stale note", content: "Unsaved stale content", background: true },
      { action: "observe", name: "queued" },
      { action: "release-transport", count: 1 },
      { action: "wait-transport", operation: "push", occurrence: 2, name: "second" },
      { action: "release-transport" },
      { action: "wait-recovery", domain: "notes", name: "recovered" },
      { action: "ui", operation: "switch-view", view: "Todo" },
      { action: "observe", name: "todo-recovered" },
      { action: "ui", operation: "switch-view", view: "Notes" },
      { action: "observe", name: "notes-recovered" },
    ],
    check({ at }) {
      const pushes = at.recovered.transport.filter(event => event.operation === "push");
      assert.equal(pushes.length, 2);
      assert.ok(pushes[1].startedAt >= pushes[0].finishedAt);
      assert.equal(at.queued.transport.filter(event => event.operation === "push").length, 1);
      assert.match(at.recovered.files["todos.json"], /External todo/);
      assert.match(at.recovered.files["notes.json"], /External note/);
      assert.doesNotMatch(at.recovered.files["todos.json"], /Rejected stale todo/);
      assert.doesNotMatch(at.recovered.files["notes.json"], /Rejected stale note|Unsaved stale content/);
      assert.match(at["todo-recovered"].screen, /repeat|retry|changed/i);
      assert.match(at["notes-recovered"].screen, /repeat|retry|changed/i);
      assert.match(at.recovered.remoteFiles["todos.json"], /External todo/);
      assert.match(at.recovered.remoteFiles["notes.json"], /External note/);
    },
  },
  {
    name: "TUI sync runner shutdown waits for an active recovery response before close",
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, local: { todos: "Recovery inbox" }, transport: { gate: "push", arm: "after-open" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "external-writer", domain: "todos", values: { description: "Shutdown recovery" }, publish: false },
      { action: "ui", operation: "add-task", title: "Rejected stale" },
      { action: "wait-transport", operation: "push" },
      { action: "close-ui", background: true },
      { action: "observe", name: "waiting" },
      { action: "release-transport" },
      { action: "wait-command", name: "closed" },
    ],
    check({ at }) {
      assert.equal(at.waiting.applicationExited, false);
      assert.equal(at.closed.exitCode, 0);
      assert.match(at.closed.files["todos.json"], /Shutdown recovery/);
      assert.doesNotMatch(at.closed.files["todos.json"], /Rejected stale/);
      assert.match(at.closed.remoteFiles["todos.json"], /Shutdown recovery/);
      assert.ok(at.closed.applicationExitedAt >= at.closed.transport.at(-1).finishedAt);
    },
  },
  {
    name: "TUI sync runner shutdown waits for recovery and its deferred mutation before close",
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, local: { todos: "Recovery inbox", notes: "Notes inbox" }, transport: { gate: "push", releases: "one-at-a-time", arm: "after-open" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "external-writer", domain: "todos", values: { description: "Recovery first" }, publish: false },
      { action: "ui", operation: "add-task", title: "Rejected stale" },
      { action: "wait-transport", operation: "push" },
      { action: "ui", operation: "add-note", title: "Deferred note", content: "Keep after exit", background: true },
      { action: "close-ui", background: true },
      { action: "observe", name: "waiting" },
      { action: "release-transport", count: 1 },
      { action: "wait-transport", operation: "push", occurrence: 2, name: "deferred" },
      { action: "release-transport" },
      { action: "wait-command", name: "closed" },
    ],
    check({ at }) {
      assert.equal(at.waiting.applicationExited, false);
      assert.equal(at.deferred.applicationExited, false);
      assert.equal(at.closed.exitCode, 0);
      assert.match(at.closed.remoteFiles["todos.json"], /Recovery first/);
      assert.match(at.closed.remoteFiles["notes.json"], /Deferred note/);
      assert.ok(at.closed.applicationExitedAt >= at.closed.transport.at(-1).finishedAt);
    },
  },
  {
    name: "TUI sync runner shutdown waits for deferred mutation after recovery failure",
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, local: { todos: "Recovery inbox", notes: "Notes inbox" }, transport: { gate: "push", releases: "one-at-a-time", arm: "after-open" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "external-writer", domain: "todos", values: { description: "Failed recovery snapshot" }, publish: false },
      { action: "ui", operation: "add-task", title: "Rejected stale" },
      { action: "wait-transport", operation: "push" },
      { action: "ui", operation: "add-note", title: "Deferred after failure", content: "Persist this", background: true },
      { action: "close-ui", background: true },
      { action: "transport", mode: "unknown-failure", count: 1 },
      { action: "release-transport", count: 1 },
      { action: "transport", mode: "healthy" },
      { action: "wait-transport", operation: "push", occurrence: 2, name: "deferred" },
      { action: "release-transport" },
      { action: "wait-command", name: "closed" },
    ],
    check({ at }) {
      assert.equal(at.deferred.applicationExited, false);
      assert.match(at.closed.files["todos.json"], /Failed recovery snapshot/);
      assert.doesNotMatch(at.closed.files["todos.json"], /Rejected stale/);
      assert.match(at.closed.files["notes.json"], /Deferred after failure/);
      assert.match(at.closed.remoteFiles["notes.json"], /Deferred after failure/);
      assert.equal(at.closed.exitCode, 0);
      assert.ok(at.closed.applicationExitedAt >= at.closed.transport.at(-1).finishedAt);
    },
  },
  {
    name: "TUI sync runner emits queued recovery responses before shutdown response and close",
    // The user observes completed recovery and exit order, not IPC response IDs.
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, local: { todos: "Recovery todo", notes: "Recovery note" }, transport: { gate: "push", releases: "one-at-a-time", arm: "after-open" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "external-writer", domain: "todos", values: { description: "Queued todo recovery" }, publish: false },
      { action: "external-writer", domain: "notes", values: { description: "Queued note recovery" }, publish: false },
      { action: "ui", operation: "add-task", title: "Shutdown rejected todo", background: true },
      { action: "wait-transport", operation: "push" },
      { action: "ui", operation: "add-note", title: "Shutdown rejected note", content: "Unsaved shutdown note", background: true },
      { action: "close-ui", background: true },
      { action: "observe", name: "waiting" },
      { action: "release-transport", count: 1 },
      { action: "wait-transport", operation: "push", occurrence: 2, name: "second" },
      { action: "release-transport" },
      { action: "wait-command", name: "closed" },
      { action: "open", view: "Todo" },
      { action: "observe", name: "todo-visible" },
      { action: "ui", operation: "switch-view", view: "Notes" },
      { action: "observe", name: "notes-visible" },
    ],
    check({ at }) {
      assert.equal(at.waiting.applicationExited, false);
      assert.equal(at.second.applicationExited, false);
      const closed = at.closed;
      assert.equal(closed.exitCode, 0);
      assert.match(closed.files["todos.json"], /Queued todo recovery/);
      assert.match(closed.files["notes.json"], /Queued note recovery/);
      assert.doesNotMatch(closed.files["todos.json"], /Shutdown rejected todo/);
      assert.doesNotMatch(closed.files["notes.json"], /Shutdown rejected note|Unsaved shutdown note/);
      assert.match(closed.remoteFiles["todos.json"], /Queued todo recovery/);
      assert.match(closed.remoteFiles["notes.json"], /Queued note recovery/);
      const pushes = closed.transport.filter(event => event.operation === "push");
      assert.equal(pushes.length, 2);
      assert.ok(pushes[1].startedAt >= pushes[0].finishedAt);
      assert.ok(closed.applicationExitedAt >= pushes[1].finishedAt);
      assert.match(at["todo-visible"].screen, /Recovery todo/);
      assert.match(at["notes-visible"].screen, /Recovery note/);
    },
  },
  {
    name: "TUI sync runner closes after shutdown flush even when close throws",
    // The old injected throwing close() callback is not reachable from the CLI.
    // Preserve the valid user guarantee: orderly exit after a failed flush keeps
    // durable work and does not hang or discard local data. No exit monkey patch.
    fixture: { remote: "empty", initialize: true, config: { autoPull: false }, transport: { mode: "unknown-failure" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Failed flush retained" },
      { action: "wait-status", status: "failed", name: "failed" },
      { action: "close-ui", name: "closed" },
      { action: "open", view: "Todo" },
      { action: "observe", name: "reloaded" },
    ],
    check({ at }) {
      assert.match(at.failed.screen, /failed/i);
      assert.equal(at.closed.exitCode, 0);
      assert.match(at.closed.files["todos.json"], /Failed flush retained/);
      assert.ok(at.closed.files[".config/sync-pending.json"]);
      assert.match(at.reloaded.screen, /Failed flush retained/);
      assert.doesNotMatch(at.reloaded.remoteFiles["todos.json"] ?? "", /Failed flush retained/);
    },
  },
  {
    name: "TUI sync client forks runner with ignored stdout and stderr",
    fixture: { remote: "empty", initialize: true, config: { autoPull: true }, transport: { mode: "unknown-failure", arm: "after-open", stderr: "SYNTHETIC_BACKEND_STDERR_CANARY", stdout: "SYNTHETIC_BACKEND_STDOUT_CANARY" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Output isolation task" },
      { action: "wait-status", status: "failed", name: "isolated" },
      { action: "ui", operation: "switch-view", view: "Notes" },
      { action: "observe", name: "responsive" },
    ],
    check({ at, terminalOutput }) {
      assert.match(at.isolated.files["todos.json"], /Output isolation task/);
      assert.match(at.isolated.screen, /failed/i);
      assert.doesNotMatch(terminalOutput, /SYNTHETIC_BACKEND_(STDERR|STDOUT)_CANARY/);
      assert.ok(at.isolated.transport.some(event => event.stderr.includes("SYNTHETIC_BACKEND_STDERR_CANARY")));
      assert.match(at.responsive.screen, /Add note/);
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
