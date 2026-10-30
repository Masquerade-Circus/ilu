import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios";

test("sync status returns current runtime status for healthy and degraded cases", async (t) => {
  const checkpoints = ["healthy", "degraded"];
  const result = await captureIluScenario({
    testName: t.name, command: ["bash", "--noprofile", "--norc"], scenario: "syncWorkflow",
    input: {
      fixture: { remote: "empty", initialize: true },
      steps: [
        { action: "cli", args: ["sync", "status"], name: "healthy" },
        { action: "transport", mode: "network-failure" },
        { action: "open", view: "Todo" },
        { action: "ui", operation: "add-task", title: "Offline status task" },
        { action: "wait-status", status: "degraded_network" },
        { action: "close-ui" },
        { action: "cli", args: ["sync", "status"], name: "degraded" },
        { action: "exit" },
      ],
    },
  });
  assertCaptureArtifacts({ result, checkpoints, testName: t.name, diagnostic: message => t.diagnostic(message) });
  assert.equal(result.at.healthy.exitCode, 0);
  assert.match(result.at.healthy.screen, /healthy/i);
  assert.equal(result.at.degraded.exitCode, 0);
  assert.match(result.at.degraded.screen, /degraded_network/i);
  assert.match(result.at.degraded.screen, /pending.*yes/i);
  assert.match(result.at.degraded.files["todos.json"], /Offline status task/);
  const degraded = JSON.parse(result.at.degraded.files[".sync-core/state.json"]);
  assert.equal(degraded.hasPendingRemote, true);
  assert.equal(degraded.lastErrorKind, "network");
  assert.equal(degraded.status, "degraded_network");
});

test("sync status prints user-facing status output", async (t) => {
  const checkpoints = ["status"];
  const result = await captureIluScenario({ testName: t.name, command: ["bash", "--noprofile", "--norc"], scenario: "syncWorkflow", input: {
    fixture: { remote: "empty", initialize: true },
    steps: [{ action: "cli", args: ["sync", "status"], name: "status" }, { action: "exit" }],
  } });
  assertCaptureArtifacts({ result, checkpoints, testName: t.name, diagnostic: message => t.diagnostic(message) });
  assert.equal(result.at.status.exitCode, 0);
  assert.match(result.at.status.screen, /healthy/i);
  assert.equal(result.at.status.transport.length, 0, "status must not publish new data");
  assert.equal(result.exitCode, 0);
});
