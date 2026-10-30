import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios";

const workflows = [
  {
    name: "ilu adapter resolves source root and ignore patterns under ~/.ilu",
    fixture: { remote: "empty", local: { todos: "Private root task" }, excludedFiles: { ".config/private.json": "synthetic-private" } },
    steps: [{ action: "cli", args: ["sync", "init", "--remote", "$REMOTE"], name: "published" }],
    check({ at, home }) {
      assert.equal(at.published.exitCode, 0);
      assert.equal(at.published.storageRoot, `${home}/.ilu`);
      assert.match(at.published.remoteFiles["todos.json"], /Private root task/);
      assert.equal(at.published.remoteFiles[".config/private.json"], null);
      assert.equal(at.published.files[".config/private.json"], "synthetic-private");
    },
  },
  {
    name: "ilu adapter exposes normalized sync config and commit message builder",
    fixture: { remote: "empty", local: { todos: "Commit inbox" } },
    steps: [
      { action: "cli", args: ["sync", "status"], name: "default" },
      { action: "cli", args: ["sync", "init", "--remote", "$REMOTE"], name: "initialized" },
      { action: "cli-ui", args: ["todo", "--add"], answers: { title: "Commit task", description: "" }, name: "saved", waitRemote: true },
    ],
    check({ at }) {
      assert.match(at.default.screen, /disabled/i);
      assert.equal(at.default.transport.length, 0);
      const config = JSON.parse(at.initialized.files[".config/sync-config.json"]);
      assert.equal(config.branch, "main");
      assert.equal(config.autoSync, true);
      assert.equal(config.autoPull, true);
      assert.equal(config.autoPush, true);
      assert.match(at.saved.remoteFiles["todos.json"], /Commit task/);
      assert.ok(at.saved.remoteCommits.some(commit => /todos/i.test(commit.message)));
    },
  },
  {
    name: "ilu adapter expone solo el contrato vigente del consumer",
    fixture: { remote: "empty", local: { todos: "Consumer inbox" } },
    steps: [
      { action: "cli", args: ["sync", "init", "--remote", "$REMOTE"], name: "initialized" },
      { action: "cli", args: ["sync", "status"], name: "status" },
      { action: "cli", args: ["sync", "retry"], name: "retried" },
    ],
    check({ at }) {
      assert.equal(at.initialized.exitCode, 0);
      assert.equal(at.status.exitCode, 0);
      assert.match(at.status.screen, /healthy/i);
      assert.equal(at.retried.exitCode, 0);
      assert.match(at.retried.remoteFiles["todos.json"], /Consumer inbox/);
    },
  },
  {
    name: "ilu adapter ignora compatibilidad anterior y solo lee sync-config.json en .config",
    fixture: {
      remote: "empty", initialize: true,
      config: { enabled: true, branch: "main", autoSync: true, autoPull: false, autoPush: true },
      excludedFiles: { ".sync/config.json": JSON.stringify({ enabled: false, remoteUrl: "./tmp/nonexistent-old.git", branch: "old", autoSync: false, autoPull: false, autoPush: false }) },
    },
    steps: [
      { action: "cli-ui", args: ["todo", "--add"], answers: { title: "Current configuration task", description: "" }, name: "saved", waitRemote: true },
      { action: "cli", args: ["sync", "status"], name: "status" },
    ],
    check({ at }) {
      assert.equal(at.saved.exitCode, 0);
      assert.match(at.saved.remoteFiles["todos.json"], /Current configuration task/);
      assert.match(at.status.screen, /healthy/i);
      const config = JSON.parse(at.status.files[".config/sync-config.json"]);
      assert.equal(config.branch, "main");
      assert.equal(config.autoPull, false);
      assert.equal(config.autoPush, true);
      assert.equal(JSON.parse(at.status.files[".sync/config.json"]).enabled, false);
    },
  },
];

for (const { name, fixture, steps, check } of workflows) {
  test(name, async (t) => {
    const checkpoints = steps.map(step => step.name);
    const result = await captureIluScenario({ testName: t.name, command: ["bash", "--noprofile", "--norc"], scenario: "syncWorkflow", input: { fixture, steps: [...steps, { action: "exit" }] } });
    assertCaptureArtifacts({ result, checkpoints, testName: t.name, diagnostic: message => t.diagnostic(message) });
    check(result);
    assert.equal(result.exitCode, 0);
  });
}
