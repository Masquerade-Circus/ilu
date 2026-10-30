import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { captureIluScenario } from "./test-helpers/terminal-capture";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios";

// Inspect the real fixture workspace, not a driver-provided list of paths.
// Git object directories may legitimately change with each new revision.
function inspectSyncWorkspace(result) {
  const tmpRoot = fs.realpathSync(path.resolve(import.meta.dirname, "..", "tmp"));
  const workspaceRoot = fs.realpathSync(result.workspaceRoot);
  const relativeRoot = path.relative(tmpRoot, workspaceRoot);
  assert.ok(relativeRoot.length > 0 && !relativeRoot.startsWith("..") && !path.isAbsolute(relativeRoot));
  const repositoryPaths = {
    local: fs.realpathSync(result.at.repeated.storageRoot),
    remote: fs.realpathSync(result.at.repeated.remotePath),
    externalWriter: fs.realpathSync(result.at.external.externalWriterPath)
  };
  const home = fs.realpathSync(result.home);
  for (const directory of [home, ...Object.values(repositoryPaths)]) {
    const relative = path.relative(workspaceRoot, directory);
    assert.ok(
      relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative),
      "the captured HOME and every Git fixture must belong to this test's private workspace"
    );
    assert.ok(fs.statSync(directory).isDirectory());
  }
  const configuredRemote = JSON.parse(result.at.repeated.files[".config/sync-config.json"]).remoteUrl;
  assert.equal(
    fs.realpathSync(configuredRemote),
    repositoryPaths.remote,
    "inspect the remote actually selected by the CLI"
  );
  assert.ok(fs.statSync(path.join(repositoryPaths.local, ".git")).isDirectory());
  assert.ok(fs.statSync(path.join(repositoryPaths.externalWriter, ".git")).isDirectory());
  assert.ok(fs.statSync(path.join(repositoryPaths.remote, "HEAD")).isFile());
  assert.ok(fs.statSync(path.join(repositoryPaths.remote, "objects")).isDirectory());
  const directories: string[] = [];
  const pending = [workspaceRoot];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      assert.equal(
        entry.isSymbolicLink(),
        false,
        "fixture inspection must not follow links outside its owned workspace"
      );
      if (!entry.isDirectory()) {
        continue;
      }
      const child = path.join(directory, entry.name);
      directories.push(path.relative(workspaceRoot, child));
      if (entry.name !== ".git" && child !== repositoryPaths.remote) {
        pending.push(child);
      }
    }
  }
  return {
    workspaceRoot,
    home,
    repositoryPaths,
    directories: directories.sort(),
    siblings: fs.readdirSync(path.dirname(workspaceRoot)).sort(),
    tmpEntries: fs.readdirSync(tmpRoot).sort()
  };
}

const workflows = [
  {
    name: "bootstrap local data to empty local bare remote",
    fixture: { remote: "empty", local: { todos: "Inbox" } },
    steps: [{ action: "cli", args: ["sync", "init", "--remote", "$REMOTE"], name: "published" }],
    check({ at }) {
      assert.equal(at.published.exitCode, 0);
      assert.match(at.published.remoteFiles["todos.json"], /Inbox/);
      assert.ok(at.published.remoteHead);
      assert.ok(at.published.files[".sync-core/state.json"]);
      assert.equal(at.published.isGitRepository, true);
      assert.equal(at.published.remoteFiles[".config/sync-config.json"], null);
      assert.equal(at.published.remoteFiles[".sync-core/state.json"], null);
    }
  },
  {
    name: "bootstrap empty local storage from remote with history",
    fixture: { remote: "seeded", remoteData: { todos: "Seed" } },
    steps: [
      { action: "cli", args: ["sync", "init", "--remote", "$REMOTE"], name: "adopted" },
      { action: "cli", args: ["todo"], name: "visible" }
    ],
    check({ at }) {
      assert.equal(at.adopted.exitCode, 0);
      assert.match(at.adopted.files["todos.json"], /Seed/);
      assert.equal(at.visible.exitCode, 0);
      assert.match(at.visible.screen, /Seed/);
    }
  },
  {
    name: "cli sync init no deja bootstrap parcial cuando HOME inicia vacío y el remoto ya tiene historia",
    fixture: {
      remote: "seeded",
      remoteData: {
        todos: "Seed",
        notes: "Seed note",
        boards: "Seed board",
        clocks: [{ name: "CDMX", timezone: "America/Mexico_City" }]
      }
    },
    steps: [
      { action: "cli", args: ["sync", "init", "--remote", "$REMOTE", "--branch", "main"], name: "adopted" },
      { action: "open", view: "Todo" },
      { action: "observe", name: "todo" },
      { action: "ui", operation: "switch-view", view: "Notes" },
      { action: "observe", name: "notes" },
      { action: "ui", operation: "switch-view", view: "Board" },
      { action: "observe", name: "boards" },
      { action: "ui", operation: "switch-view", view: "Clocks" },
      { action: "observe", name: "clocks" }
    ],
    check({ at }) {
      assert.equal(at.adopted.exitCode, 0);
      for (const file of [
        "todos.json",
        "notes.json",
        "boards.json",
        "clocks.json",
        ".config/sync-config.json",
        ".sync-core/state.json"
      ]) {
        assert.equal(typeof at.adopted.files[file], "string", `bootstrap must adopt ${file}`);
      }
      assert.equal(at.adopted.isGitRepository, true);
      assert.match(at.todo.screen, /Seed/);
      assert.match(at.notes.screen, /Seed note/);
      assert.match(at.boards.screen, /Seed board/);
      assert.match(at.clocks.screen, /CDMX/);
    }
  },
  {
    name: "auto-sync after mutation pushes to local bare remote",
    fixture: { remote: "empty", initialize: true, config: { autoPull: false } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-list", title: "Auto Inbox" },
      { action: "settle-sync", name: "saved" }
    ],
    check({ at }) {
      assert.match(at.saved.remoteFiles["todos.json"], /Auto Inbox/);
      assert.match(at.saved.screen, /synced|healthy/i);
      assert.equal(at.saved.files[".config/sync-pending.json"], null);
    }
  },
  {
    name: "iludb recovery integrates the current external snapshot before the user repeats a stale mutation",
    repeat: 2,
    fixture: { remote: "empty", initialize: true, local: { todos: "Inbox" }, config: { autoPull: true } },
    steps({ iteration }) {
      return [
        { action: "open", view: "Todo" },
        { action: "observe", name: "before" },
        {
          action: "external-writer",
          domain: "todos",
          values: { description: `External revision ${iteration}` },
          publish: true,
          name: "external"
        },
        { action: "ui", operation: "add-task", title: `Repeat after recovery ${iteration}` },
        { action: "wait-recovery", name: "recovered" },
        { action: "ui", operation: "dismiss-notice" },
        { action: "ui", operation: "add-task", title: `Repeat after recovery ${iteration}` },
        { action: "settle-sync", name: "repeated" }
      ];
    },
    check({ at }, { iteration }) {
      const revision = `External revision ${iteration}`;
      const title = `Repeat after recovery ${iteration}`;
      assert.doesNotMatch(
        at.before.files["todos.json"],
        /External revision|Repeat after recovery/,
        "reusing a fixture must restore a reproducible starting state, not replay stale evidence"
      );
      assert.doesNotMatch(at.before.remoteFiles["todos.json"], /External revision|Repeat after recovery/);
      assert.match(at.recovered.screen, /repeat|retry|changed|conflict/i);
      assert.ok(at.recovered.files["todos.json"].includes(revision));
      assert.doesNotMatch(at.recovered.files["todos.json"], /Repeat after recovery/);
      assert.equal(JSON.parse(at.recovered.files[".sync-core/state.json"]).status, "healthy");
      assert.equal(at.recovered.files[".config/sync-pending.json"], null);
      assert.ok(at.recovered.remoteFiles["todos.json"].includes(revision));
      assert.doesNotMatch(at.recovered.remoteFiles["todos.json"], /Repeat after recovery/);
      assert.ok(at.repeated.remoteFiles["todos.json"].includes(revision));
      assert.ok(at.repeated.remoteFiles["todos.json"].includes(title));
      assert.ok(
        at.repeated.screen.includes(title),
        "the captured application must display the task created in this execution"
      );
      assert.notEqual(at.repeated.remoteHead, at.before.remoteHead, "this execution must publish its own mutation");
      const snapshot = JSON.parse(at.repeated.files["todos.json"]);
      const lists = Array.isArray(snapshot) ? snapshot : snapshot.collections.todos.data;
      assert.equal(lists.flatMap((list) => list.tasks).filter((task) => task.title === title).length, 1);
      assert.equal(
        lists.flatMap((list) => list.tasks).filter((task) => task.title.startsWith("Repeat after recovery")).length,
        1
      );
    }
  },
  {
    name: "sync consumer createSyncRuntime() sin argumentos sigue funcionando después de bootstrap",
    fixture: { remote: "empty", local: { todos: "Bootstrap inbox" } },
    steps: [
      { action: "cli", args: ["sync", "init", "--remote", "$REMOTE"], name: "initialized" },
      { action: "cli", args: ["sync", "status"], name: "fresh-process" },
      { action: "cli", args: ["sync", "retry"], name: "retried" }
    ],
    check({ at }) {
      assert.equal(at.initialized.exitCode, 0);
      assert.equal(at["fresh-process"].exitCode, 0);
      assert.match(at["fresh-process"].screen, /healthy/i);
      assert.equal(at.retried.exitCode, 0);
      assert.match(at.retried.remoteFiles["todos.json"], /Bootstrap inbox/);
    }
  },
  {
    name: "remote unavailable does not remove local data",
    fixture: { remote: "empty", initialize: true, config: { autoPull: false } },
    steps: [
      { action: "transport", mode: "network-failure" },
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Offline inbox" },
      { action: "wait-status", status: "degraded_network", name: "offline" },
      { action: "close-ui" },
      { action: "open", view: "Todo" },
      { action: "observe", name: "reloaded" }
    ],
    check({ at }) {
      assert.match(at.offline.files["todos.json"], /Offline inbox/);
      assert.match(at.reloaded.screen, /Offline inbox/);
      assert.match(at.reloaded.files["todos.json"], /Offline inbox/);
      assert.doesNotMatch(at.reloaded.remoteFiles["todos.json"] ?? "", /Offline inbox/);
      assert.ok(at.reloaded.files[".config/sync-pending.json"]);
    }
  },
  {
    name: "sync enable and disable are idempotent with the real runtime",
    fixture: { remote: "empty", initialize: true },
    steps: [
      { action: "cli", args: ["sync", "disable"], name: "disabled-one" },
      { action: "cli", args: ["sync", "disable"], name: "disabled-two" },
      { action: "cli", args: ["sync", "status"], name: "disabled-status" },
      { action: "cli", args: ["sync", "enable"], name: "enabled-one" },
      { action: "cli", args: ["sync", "enable"], name: "enabled-two" },
      { action: "cli", args: ["sync", "status"], name: "enabled-status" }
    ],
    check({ at }) {
      assert.equal(Object.keys(at).length, 6);
      for (const observation of Object.values(at) as any[]) {
        assert.equal(observation.exitCode, 0);
      }
      assert.match(at["disabled-status"].screen, /disabled/i);
      assert.match(at["enabled-status"].screen, /healthy/i);
      assert.equal(JSON.parse(at["disabled-two"].files[".config/sync-config.json"]).enabled, false);
      assert.equal(JSON.parse(at["enabled-two"].files[".config/sync-config.json"]).enabled, true);
      assert.equal(at["disabled-one"].remoteHead, at["enabled-two"].remoteHead);
    }
  },
  {
    name: "legacy sync state migrates once into private core state without carrying enabled",
    fixture: {
      remote: "empty",
      initialize: true,
      removeCoreState: true,
      legacyState: {
        enabled: false,
        status: "degraded_network",
        hasPendingRemote: true,
        pendingOperationId: "legacy-operation",
        retryCount: 9,
        backoffUntil: 4102444800000,
        lastErrorKind: "network",
        lastErrorMessage: "Network unavailable"
      }
    },
    steps: [
      { action: "cli", args: ["sync", "status"], name: "migrated" },
      { action: "write-legacy-state", state: { pendingOperationId: "must-not-overwrite" } },
      { action: "cli", args: ["sync", "status"], name: "again" }
    ],
    check({ at }) {
      const state = JSON.parse(at.migrated.files[".sync-core/state.json"]);
      assert.equal(state.pendingOperationId, "legacy-operation");
      assert.equal(state.hasPendingRemote, true);
      assert.equal(state.retryCount, 0);
      assert.equal(state.lastErrorMessage, "Network unavailable");
      assert.equal(Object.hasOwn(state, "enabled"), false, "legacy enabled must not disable current configured sync");
      assert.equal(JSON.parse(at.again.files[".sync-core/state.json"]).pendingOperationId, "legacy-operation");
      assert.doesNotMatch(at.again.screen, /disabled/i);
    }
  },
  {
    name: "legacy network pending state remains retryable without a backoff timestamp",
    fixture: {
      remote: "empty",
      initialize: true,
      removeCoreState: true,
      legacyState: {
        status: "degraded_network",
        hasPendingRemote: true,
        pendingOperationId: "legacy-network",
        lastErrorKind: "network"
      },
      transport: { gate: "push" }
    },
    steps: [
      { action: "open", view: "Sync" },
      { action: "wait-transport", operation: "push", name: "retrying" },
      { action: "release-transport" },
      { action: "settle-sync", name: "recovered" }
    ],
    check({ at }) {
      assert.ok(at.retrying.transport.some((event) => event.operation === "push"));
      assert.equal(JSON.parse(at.retrying.files[".sync-core/state.json"]).retryable, true);
      assert.equal(JSON.parse(at.retrying.files[".sync-core/state.json"]).backoffUntil, null);
      assert.match(at.recovered.screen, /healthy|synced/i);
      assert.equal(at.recovered.files[".config/sync-pending.json"], null);
    }
  },
  {
    name: "legacy auth pending state remains terminal even when it has a backoff timestamp",
    fixture: {
      remote: "empty",
      initialize: true,
      removeCoreState: true,
      config: { autoPull: false },
      legacyState: {
        status: "degraded_auth",
        hasPendingRemote: true,
        pendingOperationId: "legacy-auth",
        lastErrorKind: "auth",
        backoffUntil: 1
      },
      transport: { mode: "auth-failure" }
    },
    steps: [
      { action: "open", view: "Sync" },
      { action: "observe", name: "terminal" },
      { action: "observe-after-retry-window", name: "still-terminal" }
    ],
    check({ at }) {
      const state = JSON.parse(at.terminal.files[".sync-core/state.json"]);
      assert.equal(state.retryable, false);
      assert.equal(state.hasPendingRemote, true);
      assert.match(at.terminal.screen, /auth|failed|pending/i);
      assert.equal(at["still-terminal"].transport.length, at.terminal.transport.length);
      assert.equal(at["still-terminal"].remoteHead, at.terminal.remoteHead);
    }
  },
  {
    name: "autoSync false persists pending policy across module reload and retry clears it only after success",
    fixture: { remote: "empty", initialize: true, config: { autoSync: false, autoPull: false } },
    steps: [
      {
        action: "cli-ui",
        args: ["todo", "--add"],
        answers: { title: "Durable pending", description: "" },
        name: "pending"
      },
      { action: "cli", args: ["sync", "status"], name: "reloaded" },
      { action: "transport", mode: "auth-failure" },
      { action: "cli", args: ["sync", "retry"], name: "failed" },
      { action: "transport", mode: "healthy" },
      { action: "cli", args: ["sync", "retry"], name: "retried" },
      { action: "cli", args: ["sync", "status"], name: "healthy" }
    ],
    check({ at }) {
      assert.ok(at.pending.files[".config/sync-pending.json"]);
      assert.match(at.reloaded.screen, /pending_remote/i);
      assert.equal(at.reloaded.transport.length, 0);
      assert.ok(at.failed.files[".config/sync-pending.json"]);
      assert.doesNotMatch(at.failed.remoteFiles["todos.json"] ?? "", /Durable pending/);
      assert.match(at.retried.remoteFiles["todos.json"], /Durable pending/);
      assert.equal(at.retried.files[".config/sync-pending.json"], null);
      assert.match(at.healthy.screen, /healthy/i);
    }
  },
  {
    name: "disable during backoff prevents another backend call and enable reconciles pending work",
    fixture: { remote: "empty", initialize: true, config: { autoPull: false }, transport: { mode: "network-failure" } },
    steps: [
      { action: "open", view: "Todo" },
      { action: "ui", operation: "add-task", title: "Backoff task" },
      { action: "wait-backoff" },
      { action: "ui", operation: "sync-disable" },
      { action: "observe", name: "disabled" },
      { action: "observe-after-retry-window", name: "quiet" },
      { action: "transport", mode: "healthy" },
      { action: "ui", operation: "sync-enable" },
      { action: "settle-sync", name: "enabled" }
    ],
    check({ at }) {
      assert.equal(at.quiet.transport.length, at.disabled.transport.length);
      assert.equal(JSON.parse(at.disabled.files[".config/sync-config.json"]).enabled, false);
      assert.ok(at.disabled.files[".config/sync-pending.json"]);
      assert.match(at.enabled.remoteFiles["todos.json"], /Backoff task/);
      assert.equal(at.enabled.files[".config/sync-pending.json"], null);
      assert.match(at.enabled.screen, /healthy|synced/i);
    }
  },
  {
    name: "disable waits for an automatic rehydrated backend before rapid enable starts another runtime",
    fixture: {
      remote: "empty",
      initialize: true,
      pendingData: { todos: "Rehydrated task" },
      coreState: {
        status: "degraded_network",
        hasPendingRemote: true,
        pendingOperationId: "automatic-rehydrated",
        retryCount: 0,
        backoffUntil: null,
        lastErrorKind: "network",
        retryable: true,
        pendingContext: { action: "save" }
      },
      transport: { gate: "push" }
    },
    steps: [
      { action: "open", view: "Sync", background: true },
      { action: "wait-transport", operation: "push" },
      { action: "ui", operation: "sync-disable", background: true },
      { action: "ui", operation: "sync-enable", background: true },
      { action: "observe", name: "blocked" },
      { action: "release-transport" },
      { action: "settle-sync", name: "enabled" }
    ],
    check({ at }) {
      const pushes = at.blocked.transport.filter((event) => event.operation === "push");
      assert.equal(pushes.length, 1, "rapid enable must not overlap the rehydrated transport");
      assert.doesNotMatch(at.blocked.remoteFiles["todos.json"] ?? "", /Rehydrated task/);
      assert.match(at.enabled.remoteFiles["todos.json"], /Rehydrated task/);
      const intervals = at.enabled.transport.filter((event) => event.operation === "push");
      for (let index = 1; index < intervals.length; index += 1) {
        assert.ok(intervals[index].startedAt >= intervals[index - 1].finishedAt);
      }
      assert.match(at.enabled.screen, /healthy|synced/i);
    }
  }
];

for (const { name, fixture, steps, check, repeat = 1 } of workflows) {
  test(name, async (t) => {
    let firstWorkspace = null;
    let firstMedia = null;
    for (let iteration = 1; iteration <= repeat; iteration += 1) {
      const runSteps = typeof steps === "function" ? steps({ iteration }) : steps;
      const checkpoints = runSteps.filter((step) => typeof step.name === "string").map((step) => step.name);
      const result = await captureIluScenario({
        testName: t.name,
        command: ["bash", "--noprofile", "--norc"],
        scenario: "syncWorkflow",
        input: { fixture, steps: [...runSteps, { action: "exit" }] }
      });
      assertCaptureArtifacts({ result, checkpoints, testName: t.name, diagnostic: (message) => t.diagnostic(message) });
      check(result, { iteration });
      assert.equal(result.exitCode, 0);
      if (repeat > 1) {
        const workspace = inspectSyncWorkspace(result);
        const media = [result.screenshots.repeated, result.videoPath].map((file) => ({
          file,
          hash: createHash("sha256").update(fs.readFileSync(file)).digest("hex")
        }));
        if (iteration === 1) {
          firstWorkspace = workspace;
          firstMedia = media;
        } else {
          assert.deepEqual(
            workspace,
            firstWorkspace,
            "repeating the same real Sync case must reuse its HOME, repositories and workspace without accumulating random directories"
          );
          for (const [index, artifact] of media.entries()) {
            assert.equal(artifact.file, firstMedia[index].file, "the same test must overwrite its stable media paths");
            assert.notEqual(
              artifact.hash,
              firstMedia[index].hash,
              "the new execution must replace the old capture bytes"
            );
          }
        }
        t.diagnostic(`Sync iteration ${iteration}: ${JSON.stringify({ ...workspace, media })}`);
      }
    }
  });
}
