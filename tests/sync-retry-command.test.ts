import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios";

const workflows = [
  {
    name: "sync retry delegates to the ilu wrapper without requiring a core retry method",
    fixture: { remote: "empty", initialize: true, config: { autoSync: false } },
    steps: [
      { action: "cli-ui", args: ["todo", "--add"], answers: { title: "Manual retry task", description: "" }, name: "pending" },
      { action: "cli", args: ["sync", "retry"], name: "retried" },
      { action: "cli", args: ["sync", "status"], name: "status" },
    ],
    check({ at }) {
      assert.equal(at.pending.exitCode, 0);
      assert.ok(at.pending.files[".config/sync-pending.json"]);
      assert.doesNotMatch(at.pending.remoteFiles["todos.json"] ?? "", /Manual retry task/);
      assert.equal(at.retried.exitCode, 0);
      assert.match(at.retried.remoteFiles["todos.json"], /Manual retry task/);
      assert.equal(at.retried.files[".config/sync-pending.json"], null);
      assert.match(at.status.screen, /healthy/i);
    },
  },
  {
    name: "sync enable re-enables runtime state instead of leaving it disabled",
    fixture: { remote: "empty", initialize: true },
    steps: [
      { action: "cli", args: ["sync", "disable"], name: "disabled" },
      { action: "cli", args: ["sync", "enable"], name: "enabled" },
      { action: "cli-ui", args: ["todo", "--add"], answers: { title: "Enabled task", description: "" }, name: "saved", waitRemote: true },
      { action: "cli", args: ["sync", "status"], name: "status" },
    ],
    check({ at }) {
      assert.equal(JSON.parse(at.disabled.files[".config/sync-config.json"]).enabled, false);
      assert.equal(at.enabled.exitCode, 0);
      assert.equal(JSON.parse(at.enabled.files[".config/sync-config.json"]).enabled, true);
      assert.match(at.saved.remoteFiles["todos.json"], /Enabled task/);
      assert.match(at.status.screen, /healthy/i);
    },
  },
  {
    name: "sync enable reescribe solo sync-config sin depender de config de tts",
    fixture: { remote: "empty", initialize: true, config: { autoSync: true, autoPull: false, autoPush: true }, excludedFiles: { ".config/tts-config.json": "{malformed synthetic TTS configuration" } },
    steps: [
      { action: "cli", args: ["sync", "disable"], name: "disabled" },
      { action: "cli", args: ["sync", "enable"], name: "enabled" },
      { action: "cli", args: ["sync", "status"], name: "status" },
    ],
    check({ at }) {
      assert.equal(at.enabled.exitCode, 0);
      const before = JSON.parse(at.disabled.files[".config/sync-config.json"]);
      const after = JSON.parse(at.enabled.files[".config/sync-config.json"]);
      assert.equal(after.enabled, true);
      for (const key of ["remoteUrl", "branch", "autoSync", "autoPull", "autoPush"]) {
        assert.equal(after[key], before[key], `enable must preserve sync policy ${key}`);
      }
      assert.equal(at.enabled.files[".config/tts-config.json"], at.disabled.files[".config/tts-config.json"]);
      assert.match(at.status.screen, /healthy/i);
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
