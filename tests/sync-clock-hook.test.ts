import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios";

test("clock model routes persistence notifications through consumer hooks lazily", async (t) => {
  const checkpoints = ["idle", "added", "removed", "cancelled"];
  const result = await captureIluScenario({
    testName: t.name,
    command: ["bash", "--noprofile", "--norc"],
    scenario: "syncWorkflow",
    input: {
      fixture: { remote: "empty", initialize: true, config: { autoPull: false } },
      steps: [
        { action: "open", view: "Clocks" },
        { action: "observe", name: "idle" },
        { action: "ui", operation: "add-clock", name: "Hook UTC", timezone: "Etc/UTC" },
        { action: "settle-sync", name: "added" },
        { action: "ui", operation: "remove-clock", name: "Hook UTC", confirm: true },
        { action: "settle-sync", name: "removed" },
        { action: "ui", operation: "remove-clock", confirm: false },
        { action: "observe", name: "cancelled" },
        { action: "exit" },
      ],
    },
  });
  assertCaptureArtifacts({ result, checkpoints, testName: t.name, diagnostic: message => t.diagnostic(message) });
  assert.equal(result.at.idle.transport.length, 0);
  assert.match(result.at.added.remoteFiles["clocks.json"], /Hook UTC/);
  assert.doesNotMatch(result.at.removed.remoteFiles["clocks.json"], /Hook UTC/);
  assert.equal(result.at.cancelled.files["clocks.json"], result.at.removed.files["clocks.json"]);
  assert.equal(result.at.cancelled.remoteFiles["clocks.json"], result.at.removed.remoteFiles["clocks.json"]);
  assert.equal(result.exitCode, 0);
});
