import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const lists = [
  {
    title: "Research",
    description: "Ideas",
    current: true,
    notes: [
      { title: "Threat model", content: "Line 1\nLine 2", labels: [{ title: "sec" }] },
      { title: "Abuse cases", content: "Boundaries", labels: [] }
    ]
  },
  { title: "Archive", description: "", current: false, notes: [] }
];
const cases = [
  {
    name: "Notes adapter rejects invalid note input before model calls",
    caseId: "notes-invalid-input",
    journey: [
      "Open Notes and submit an empty note title with Body content",
      "Cancel",
      "Select empty Archive and attempt edit and removal without an item",
      "Return to Research"
    ],
    expected: {
      invalidNoteSaved: false,
      originalNotesUnchanged: true,
      archiveNotes: [],
      emptyListControlsUnavailable: true
    }
  },
  {
    name: "Notes adapter rejects invalid reorder requests before model calls",
    caseId: "notes-invalid-reorder",
    journey: [
      "Focus Threat model and press Shift+Up",
      "Select empty Archive and press Shift+Down",
      "Use a non-move key",
      "Return to Research"
    ],
    expected: { savedNoteTitles: ["Threat model", "Abuse cases"], archiveNotes: [], unrelatedKeyMovedNote: false }
  },
  {
    name: "Notes adapter reorders notes through the model and treats end boundaries as no-ops",
    caseId: "notes-reorder-boundaries",
    journey: [
      "Move Abuse cases up",
      "Inspect visible and persisted order",
      "Select last Threat model and move down",
      "Assert boundary no-op",
      "Move Threat model up",
      "Restart"
    ],
    expected: {
      intermediateNoteTitles: ["Abuse cases", "Threat model"],
      lowerBoundaryUnchanged: true,
      savedNoteTitles: ["Threat model", "Abuse cases"],
      restoredNoteTitles: ["Threat model", "Abuse cases"]
    }
  },
  {
    name: "Notes adapter preserves multiline content and calls model APIs",
    caseId: "notes-multiline-crud",
    journey: [
      "Add '  New note  ' with Line A and Line B on separate lines",
      "Edit Threat model to '  Edited  ' with First and Second on separate lines",
      "Remove Abuse cases",
      "Restart and reopen Edited"
    ],
    expected: {
      addedNote: { title: "New note", content: "Line A\nLine B" },
      editedNote: { title: "Edited", content: "First\nSecond", labels: [{ title: "sec" }] },
      savedNoteTitles: ["Edited", "New note"],
      restoredEditedContent: "First\nSecond"
    }
  },
  {
    name: "Notes adapter supports note list management and fallback current list",
    caseId: "notes-list-management",
    journey: [
      "Select Archive",
      "Add '  Scratch  ' with '  Drafts  '",
      "Rename Archive to '  Archive renamed  ' and clear description",
      "Select Archive renamed and remove it",
      "Restart"
    ],
    expected: {
      addedList: { title: "Scratch", description: "Drafts" },
      renamedListBeforeRemoval: { title: "Archive renamed", description: "" },
      removedListPresent: false,
      currentListTitle: "Research",
      restoredCurrentListTitle: "Research"
    }
  },
  {
    name: "Notes adapter returns safe errors without leaking internal details",
    caseId: "notes-write-failure",
    journey: [
      "Open Add note",
      "Block the real notes storage target after startup",
      "Submit Note with Body",
      "Observe recoverable failure"
    ],
    expected: { saveRejected: true, originalNotesUnchanged: true, leakedPrivateDetails: false, applicationUsable: true }
  }
];

for (const entry of cases) {
  test(entry.name, async (context) => {
    const result = await captureIluScenario({
      testName: context.name,
      scenario: "adapterBehavior",
      command: ["node", "bin/cli.js", "ui"],
      input: {
        area: "notes",
        caseId: entry.caseId,
        fixture: { lists, persistence: entry.caseId === "notes-write-failure" ? "blocked-target" : "real-files" },
        journey: entry.journey
      },
      viewport: { cols: 100, rows: 40 }
    });
    assert.equal(result.exitCode, 0);
    for (const [key, expected] of Object.entries(entry.expected)) {
      assert.deepEqual(result.observed[key], expected, `${entry.caseId}: ${key}`);
    }
    assertCaptureArtifacts({
      result,
      testName: context.name,
      checkpoints: ["condition", "outcome"],
      diagnostic: (message) => context.diagnostic(message)
    });
  });
}
