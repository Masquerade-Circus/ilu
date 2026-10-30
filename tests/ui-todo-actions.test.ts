import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const lists = [
  { title: "Today", description: "Now", current: true, tasks: [{ title: "Open task", description: "Ship", done: false, labels: [{ title: "work" }] }, { title: "Done task", description: "", done: true, labels: [] }] },
  { title: "Later", description: "", current: false, tasks: [] }
];
const cases = [
  {
    name: "Todo adapter rejects invalid task input before model calls",
    caseId: "todo-invalid-task",
    journey: ["Submit Add task with a whitespace title", "Cancel the editor", "Open a separate empty list and attempt edit, completion and removal without an item", "Return to Today"],
    expected: { invalidTaskSaved: false, originalTasksUnchanged: true, emptyListTasks: [] }
  },
  {
    name: "Todo adapter rejects invalid reorder requests before model calls",
    caseId: "todo-invalid-reorder",
    journey: ["Focus Open task and press Shift+Up", "Open an empty list and press Shift+Down", "Use a non-move key, then return to Today"],
    expected: { savedTaskTitles: ["Open task", "Done task"], emptyListTasks: [], unrelatedKeyMovedTask: false }
  },
  {
    name: "Todo adapter reorders tasks through the model and treats end boundaries as no-ops",
    caseId: "todo-reorder-boundaries",
    journey: ["Move Done task up", "Assert visible and persisted order Done task, Open task", "Select the last Open task and move down", "Assert no change", "Move Open task up", "Restart and inspect Today"],
    expected: { intermediateTaskTitles: ["Done task", "Open task"], lowerBoundaryUnchanged: true, savedTaskTitles: ["Open task", "Done task"], restoredTaskTitles: ["Open task", "Done task"] }
  },
  {
    name: "Todo adapter calls model task APIs with trimmed values and preserves labels when editing",
    caseId: "todo-crud-labels",
    journey: ["Add '  Add UI  ' with '  Details  '", "Edit Open task to '  Edited  ' and '  New desc  '", "Inspect its labels before removal", "Complete Edited", "Reopen Done task", "Remove Edited", "Restart"],
    expected: { addedTask: { title: "Add UI", description: "Details" }, editedTask: { title: "Edited", description: "New desc", labels: [{ title: "work" }] }, completedTitlesBeforeReopen: ["Edited", "Done task"], completedTitlesAfterReopen: ["Edited"], savedTaskTitles: ["Done task", "Add UI"], restoredTaskTitles: ["Done task", "Add UI"] }
  },
  {
    name: "Todo adapter supports list use add rename remove with current-list fallback",
    caseId: "todo-list-management",
    journey: ["Select Later", "Create '  Inbox  ' with '  Capture  '", "Rename Later to '  Later renamed  ' with '  Queue  '", "Select Later renamed and remove it", "Restart"],
    expected: { addedList: { title: "Inbox", description: "Capture" }, renamedListBeforeRemoval: { title: "Later renamed", description: "Queue" }, removedListPresent: false, currentListTitle: "Today", restoredCurrentListTitle: "Today" }
  },
  {
    name: "Todo adapter converts thrown model failures into safe copy",
    caseId: "todo-write-failure",
    journey: ["Open Add task", "Make the real todos storage target unwritable", "Submit a valid title", "Observe the error and navigate away without a crash"],
    expected: { saveRejected: true, originalTasksUnchanged: true, leakedPrivateDetails: false, applicationUsable: true }
  }
];

for (const entry of cases) {
  test(entry.name, async context => {
    const result = await captureIluScenario({ testName: context.name, scenario: "adapterBehavior", command: ["node", "bin/cli.js", "ui"], input: { area: "todo", caseId: entry.caseId, fixture: { lists, persistence: entry.caseId === "todo-write-failure" ? "blocked-target" : "real-files" }, journey: entry.journey }, viewport: { cols: 100, rows: 40 } });
    assert.equal(result.exitCode, 0);
    for (const [key, expected] of Object.entries(entry.expected)) {
      assert.deepEqual(result.observed[key], expected, `${entry.caseId}: ${key}`);
    }
    assertCaptureArtifacts({ result, testName: context.name, checkpoints: ["condition", "outcome"], diagnostic: message => context.diagnostic(message) });
  });
}
