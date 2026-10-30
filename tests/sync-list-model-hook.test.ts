import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios";

test("list model routes persistence notifications through consumer hooks lazily", async (t) => {
  const checkpoints = ["idle", "added", "checked", "edited", "removed"];
  const result = await captureIluScenario({
    testName: t.name,
    command: ["bash", "--noprofile", "--norc"],
    scenario: "syncWorkflow",
    input: {
      fixture: { remote: "empty", initialize: true, config: { autoPull: false } },
      steps: [
        { action: "open", view: "Todo" },
        { action: "observe", name: "idle" },
        { action: "ui", operation: "add-list", title: "Hook list" },
        { action: "ui", operation: "add-task", title: "Hook one" },
        { action: "settle-sync", name: "added" },
        { action: "ui", operation: "check-task", title: "Hook one" },
        { action: "settle-sync", name: "checked" },
        { action: "ui", operation: "edit-task", title: "Hook one", values: { title: "Hook two" } },
        { action: "settle-sync", name: "edited" },
        { action: "ui", operation: "remove-task", title: "Hook two", confirm: true },
        { action: "settle-sync", name: "removed" },
        { action: "exit" },
      ],
    },
  });
  assertCaptureArtifacts({ result, checkpoints, testName: t.name, diagnostic: message => t.diagnostic(message) });
  assert.equal(result.at.idle.transport.length, 0);
  assert.match(result.at.added.remoteFiles["todos.json"], /Hook one/);
  const checked = JSON.parse(result.at.checked.remoteFiles["todos.json"]);
  const lists = Array.isArray(checked) ? checked : checked.collections.todos.data;
  assert.equal(lists.flatMap(list => list.tasks).find(task => task.title === "Hook one").done, true);
  assert.match(result.at.edited.remoteFiles["todos.json"], /Hook two/);
  assert.doesNotMatch(result.at.removed.remoteFiles["todos.json"], /Hook two/);
  assert.equal(result.exitCode, 0);
});
