import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios";

test("board model routes persistence notifications through consumer hooks lazily", async (t) => {
  const checkpoints = ["idle", "added", "edited", "moved", "removed"];
  const result = await captureIluScenario({
    testName: t.name,
    command: ["bash", "--noprofile", "--norc"],
    scenario: "syncWorkflow",
    input: {
      fixture: { remote: "empty", initialize: true, config: { autoPull: false } },
      steps: [
        { action: "open", view: "Board" },
        { action: "observe", name: "idle" },
        { action: "ui", operation: "add-board", title: "Hook board" },
        { action: "ui", operation: "add-card", title: "Hook card" },
        { action: "settle-sync", name: "added" },
        { action: "ui", operation: "edit-card", title: "Hook card", values: { title: "Hook edited" } },
        { action: "settle-sync", name: "edited" },
        { action: "ui", operation: "move-card", title: "Hook edited", column: "Ready" },
        { action: "settle-sync", name: "moved" },
        { action: "ui", operation: "remove-card", title: "Hook edited", confirm: true },
        { action: "settle-sync", name: "removed" },
        { action: "exit" },
      ],
    },
  });
  assertCaptureArtifacts({ result, checkpoints, testName: t.name, diagnostic: message => t.diagnostic(message) });
  assert.equal(result.at.idle.transport.length, 0, "reading a board must not publish a mutation");
  assert.match(result.at.added.remoteFiles["boards.json"], /Hook card/);
  assert.match(result.at.edited.remoteFiles["boards.json"], /Hook edited/);
  const moved = JSON.parse(result.at.moved.remoteFiles["boards.json"]);
  const boards = Array.isArray(moved) ? moved : moved.collections.boards.data;
  assert.ok(boards.some(board => board.columns.some(column => column.title === "Ready" && column.cards.some(card => card.title === "Hook edited"))));
  assert.doesNotMatch(result.at.removed.remoteFiles["boards.json"], /Hook edited/);
  assert.equal(result.exitCode, 0);
});
