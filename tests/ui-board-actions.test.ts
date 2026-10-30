import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const cases = [
  {
    name: "addCard rejects an empty title before calling the model",
    caseId: "board-empty-card-title",
    journey: ["Open Board and Add card", "Enter whitespace title and Details description", "Try Save"],
    expected: { saveRejected: true, cardsUnchanged: true, editorStillOpen: true }
  },
  {
    name: "addCard trims title and description before persistence",
    caseId: "board-trim-card",
    journey: ["Add card with title '  Ship modal  ' and description '  Wire save  '", "Restart and open card details"],
    expected: { savedCard: { title: "Ship modal", description: "Wire save" }, restoredCard: { title: "Ship modal", description: "Wire save" } }
  },
  {
    name: "addCard allows empty description after trimming",
    caseId: "board-empty-description",
    journey: ["Add Card with a whitespace description", "Open card details after restart"],
    expected: { savedCard: { title: "Card", description: "" }, restoredCard: { title: "Card", description: "" } }
  },
  {
    name: "addCard reports missing current board without closing the caller flow as success",
    caseId: "board-no-current",
    fixture: "no-boards",
    journey: ["Open Board with no boards", "Attempt Add card through available controls", "Inspect the empty state and persisted store"],
    expected: { cardCreationBlocked: true, cardCreated: false, boardCreatedImplicitly: false, applicationUsable: true }
  },
  {
    name: "addCard converts model failures into safe user-facing errors",
    caseId: "board-add-card-write-failure",
    fixture: "block-target-after-start",
    journey: ["Open Add card with valid Card and Details", "Block the real boards file target", "Try Save"],
    expected: { saveRejected: true, cardsUnchanged: true, leakedPrivateDetails: false, applicationUsable: true }
  },
  {
    name: "card and column actions fail closed when model operations are missing",
    caseId: "board-card-column-storage-unavailable",
    fixture: "block-target-after-start",
    journey: ["Use independent restored fixture state for each attempted operation", "Block boards storage without replacing model methods", "Attempt card add, edit, move, priority, removal", "Attempt column add, rename, move left, move right, removal, WIP and default changes"],
    expected: { rejectedOperations: ["add-card", "edit-card", "move-card", "prioritize-card", "remove-card", "add-column", "rename-column", "move-column-left", "move-column-right", "remove-column", "set-wip", "set-default"], boardsUnchanged: true, leakedPrivateDetails: false }
  },
  {
    name: "card and column actions call existing model APIs with safe payloads",
    caseId: "board-card-column-crud",
    journey: ["Edit second Backlog card with '  New  ' and '  Desc  '", "Move it to second column", "Prioritize it to first in Backlog", "Remove it", "Add column '  Review  '", "Rename second column '  Doing  '", "Move Doing left then right", "Remove empty Doing", "Restart"],
    expected: { editedCard: { title: "New", description: "Desc" }, movedCardColumn: 2, prioritizedCardPosition: 1, removedCardPresent: false, addedColumnTitle: "Review", renamedColumnTitle: "Doing", reorderedColumnPositions: [1, 2], removedColumnPresent: false, persistedAfterRestart: true }
  },
  {
    name: "actions reject invalid selections before calling the model",
    caseId: "board-invalid-selections",
    journey: ["Open an empty board and try card edit, move, priority and removal without a selected card", "Submit whitespace title in Add column and Rename column", "Try moving the first column left"],
    expected: { invalidOperationsChangedData: false, blankColumnSaved: false, firstColumnMovedLeft: false }
  },
  {
    name: "useBoard rejects missing ids before calling the model",
    caseId: "board-empty-selector",
    fixture: "no-boards",
    journey: ["Open board selector with no boards", "Try activating its empty selection", "Inspect data and application state"],
    expected: { boardCreatedImplicitly: false, nonexistentBoardOpened: false, applicationUsable: true }
  },
  {
    name: "useBoard opens a board through the model with a trimmed id",
    caseId: "board-string-id-selection",
    fixture: "legacy-string-ids",
    journey: ["Select Ops board backed by legacy string id board-2", "Inspect its Queue cards", "Restart and inspect current board"],
    expected: { currentBoardId: "board-2", currentBoardTitle: "Ops board", restoredBoardTitle: "Ops board", selectedCardTitles: ["Ops card"] }
  },
  {
    name: "useBoard converts model failures into safe user-facing errors",
    caseId: "board-selection-write-failure",
    fixture: "block-target-after-start",
    journey: ["Block boards storage after startup", "Select Ops board", "Observe failure without internal details"],
    expected: { switchRejected: true, currentBoardTitle: "Launch board", boardsUnchanged: true, leakedPrivateDetails: false }
  },
  {
    name: "useBoard forwards numeric iludb ids without string coercion",
    caseId: "board-numeric-id-selection",
    fixture: "numeric-ids",
    journey: ["Select Ops board with actual numeric iludb id 2", "Inspect Queue and Ops card", "Restart"],
    expected: { currentBoardId: 2, currentBoardTitle: "Ops board", restoredBoardId: 2, selectedCardTitles: ["Ops card"] }
  },
  {
    name: "board management and column parity actions reject invalid values before model calls",
    caseId: "board-management-invalid-values",
    journey: ["Try Add board and Rename board with whitespace titles", "Try rename and remove with an empty selector in a separate empty fixture", "Try resetting columns without a board", "Submit WIP -1 and abc", "Attempt default-column selection with no column"],
    expected: { rejectedInputs: ["blank-board-title", "missing-rename-selection", "blank-renamed-title", "missing-remove-selection", "reset-without-board", "negative-wip", "nonnumeric-wip", "missing-default-column"], boardsUnchanged: true }
  },
  {
    name: "board management actions call existing model APIs with trimmed safe payloads",
    caseId: "board-management-crud",
    journey: ["Add '  Product  ' with '  Work  '", "Rename Launch board to '  Launch v2  ' with '  Done  '", "Select Launch v2 and remove it", "Inspect fallback and restart"],
    expected: { addedBoard: { title: "Product", description: "Work" }, renamedBoardBeforeRemoval: { title: "Launch v2", description: "Done" }, removedBoardPresent: false, currentBoardTitle: "Ops board", restoredBoardTitle: "Ops board" }
  },
  {
    name: "column parity actions enforce reset constraints and forward WIP/default operations",
    caseId: "board-column-settings",
    fixture: "empty-boards",
    journey: ["Reset empty board to default columns", "Set first column WIP to 0", "Set second column WIP to ' 4 '", "Set second as default", "Add a card with no explicit column", "Restart"],
    expected: { resetColumnTitles: ["Backlog", "Ready", "In Progress", "Done"], firstColumnWip: null, secondColumnWip: 4, defaultColumnIndex: 2, addedCardColumnIndex: 2, restoredDefaultColumnIndex: 2 }
  },
  {
    name: "resetDefaultColumns blocks non-empty boards before calling the model",
    caseId: "board-reset-nonempty",
    journey: ["Open a board containing Card", "Attempt reset to default columns", "Inspect the card and original columns after rejection"],
    expected: { resetRejected: true, boardsUnchanged: true, retainedCardTitles: ["Card", "Second card"] }
  },
  {
    name: "board and column parity actions convert model failures into safe user-facing errors",
    caseId: "board-management-write-failures",
    fixture: "block-target-after-start",
    journey: ["From separate valid fixtures block boards target after startup", "Try board add, board rename, WIP change, default change and empty-column reset", "Observe each failure without exposing private paths"],
    expected: { rejectedOperations: ["add-board", "rename-board", "set-wip", "set-default", "reset-columns"], boardsUnchanged: true, leakedPrivateDetails: false, applicationUsable: true }
  }
];

for (const entry of cases) {
  test(entry.name, async context => {
    const result = await captureIluScenario({ testName: context.name, scenario: "adapterBehavior", command: ["node", "bin/cli.js", "ui"], input: {
      area: "board", caseId: entry.caseId,
      fixture: { kind: entry.fixture ?? "numeric-ids", boards: [
        { id: 1, title: "Launch board", description: "Old", current: true, columns: [{ title: "Backlog", cards: [{ title: "Card", description: "Details" }, { title: "Second card", description: "" }] }, { title: "Ready", cards: [] }] },
        { id: 2, title: "Ops board", description: "", current: false, columns: [{ title: "Queue", cards: [{ title: "Ops card", description: "" }] }] }
      ] }, journey: entry.journey
    }, viewport: { cols: 120, rows: 40 } });
    assert.equal(result.exitCode, 0);
    for (const [key, expected] of Object.entries(entry.expected)) {
      assert.deepEqual(result.observed[key], expected, `${entry.caseId}: ${key}`);
    }
    assertCaptureArtifacts({ result, testName: context.name, checkpoints: ["condition", "outcome"], diagnostic: message => context.diagnostic(message) });
  });
}
