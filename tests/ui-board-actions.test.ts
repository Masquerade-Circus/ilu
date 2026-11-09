import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { captureCommand, assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const cases = [
  {
    name: "addCard rejects an empty title before calling the model",
    caseId: "board-empty-card-title",
    steps: [
      { key: "CTRL_3" },
      { remember: ["boards"] },
      { click: "Add card" },
      { fill: { label: "Title", text: "   " } },
      { fill: { label: "Description", text: "Details" } },
      { screenshot: "condition" },
      { click: "Save" },
      { expect: { invalid: true, texts: ["Description", "Cancel"] } },
      { unchanged: ["boards"] },
      { screenshot: "outcome" },
      { click: "Cancel" }
    ],
    journey: ["Open Board and Add card", "Enter whitespace title and Details description", "Try Save"],
    expected: { saveRejected: true, cardsUnchanged: true, editorStillOpen: true }
  },
  {
    name: "addCard trims title and description before persistence",
    caseId: "board-trim-card",
    steps: [
      { key: "CTRL_3" },
      { click: "Add card" },
      { fill: { label: "Title", text: "  Ship modal  " } },
      { fill: { label: "Description", text: "  Wire save  " } },
      { screenshot: "condition" },
      { click: "Save" },
      { data: { domain: "boards", card: "Ship modal", column: "Backlog", description: "Wire save" } },
      { restartAppNormally: true },
      { key: "CTRL_3" },
      { click: "Ship modal" },
      { key: "o" },
      { expect: { texts: ["Ship modal", "Wire save"] } },
      { data: { domain: "boards", card: "Ship modal", column: "Backlog", description: "Wire save" } },
      { screenshot: "outcome" },
      { key: "ESCAPE" }
    ],
    journey: ["Add card with title '  Ship modal  ' and description '  Wire save  '", "Restart and open card details"],
    expected: {
      savedCard: { title: "Ship modal", description: "Wire save" },
      restoredCard: { title: "Ship modal", description: "Wire save" }
    }
  },
  {
    name: "addCard allows empty description after trimming",
    caseId: "board-empty-description",
    seedBoards: [
      {
        title: "Launch board",
        current: true,
        columns: [
          { title: "Backlog", cards: [] },
          { title: "Ready", cards: [] }
        ]
      }
    ],
    steps: [
      { key: "CTRL_3" },
      { click: "Add card" },
      { fill: { label: "Title", text: "Card" } },
      { fill: { label: "Description", text: "   " } },
      { screenshot: "condition" },
      { click: "Save" },
      { data: { domain: "boards", card: "Card", description: "" } },
      { restartAppNormally: true },
      { key: "CTRL_3" },
      { click: "Card" },
      { key: "o" },
      { expect: { text: "Backlog | Card" } },
      { data: { domain: "boards", card: "Card", description: "" } },
      { screenshot: "outcome" },
      { key: "ESCAPE" }
    ],
    journey: ["Add Card with a whitespace description", "Open card details after restart"],
    expected: { savedCard: { title: "Card", description: "" }, restoredCard: { title: "Card", description: "" } }
  },
  {
    name: "addCard reports missing current board without closing the caller flow as success",
    caseId: "board-no-current",
    seedBoards: [],
    steps: [
      { key: "CTRL_3" },
      { remember: ["boards"] },
      { click: "Add card" },
      { fill: { label: "Title", text: "Card" } },
      { fill: { label: "Description", text: "Details" } },
      { screenshot: "condition" },
      { click: "Save" },
      { expect: { invalid: true, texts: ["Description", "Cancel"] } },
      { unchanged: ["boards"] },
      { screenshot: "outcome" },
      { click: "Cancel" },
      { expect: { empty: true } },
      { key: "CTRL_1" },
      { expect: { text: "Add task" } }
    ],
    fixture: "no-boards",
    journey: [
      "Open Board with no boards",
      "Attempt Add card through available controls",
      "Inspect the empty state and persisted store"
    ],
    expected: { cardCreationBlocked: true, cardCreated: false, boardCreatedImplicitly: false, applicationUsable: true }
  },
  {
    name: "addCard converts model failures into safe user-facing errors",
    caseId: "board-add-card-write-failure",
    steps: [
      { key: "CTRL_3" },
      { remember: ["boards"] },
      { click: "Add card" },
      { fill: { label: "Title", text: "Card" } },
      { fill: { label: "Description", text: "Details" } },
      { storageFault: { domain: "boards", kind: "deny-write" } },
      { screenshot: "condition" },
      { click: "Save" },
      {
        expect: {
          error: true,
          texts: ["Description", "Cancel"],
          absentPattern: "EACCES|CANARY_SECRET|node_modules|stack trace"
        }
      },
      { storageFault: { domain: "boards", kind: "restore" } },
      { unchanged: ["boards"] },
      { screenshot: "outcome" },
      { click: "Cancel" },
      { key: "CTRL_1" },
      { expect: { text: "Add task" } }
    ],
    fixture: "block-target-after-start",
    journey: ["Open Add card with valid Card and Details", "Block the real boards file target", "Try Save"],
    expected: { saveRejected: true, cardsUnchanged: true, leakedPrivateDetails: false, applicationUsable: true }
  },
  {
    name: "card and column actions fail closed when model operations are missing",
    caseId: "board-card-column-storage-unavailable",
    steps: [
      { key: "CTRL_3" },
      { screenshot: "condition" },
      ...[
        {
          id: "add-card",
          steps: [{ click: "Add card" }, { fill: { label: "Title", text: "Blocked card" } }, { click: "Save" }]
        },
        {
          id: "edit-card",
          steps: [
            { click: "Card" },
            { key: "o" },
            { click: "Edit", area: "overlay" },
            { fill: { label: "Title", text: "Blocked edit" } },
            { click: "Save" }
          ]
        },
        { id: "move-card", steps: [{ click: "Card" }, { key: "RIGHT" }] },
        { id: "prioritize-card", steps: [{ click: "Second card" }, { key: "SHIFT_UP" }] },
        {
          id: "remove-card",
          steps: [
            { click: "Card" },
            { key: "o" },
            { click: "Remove", area: "overlay" },
            { click: "Delete card", area: "overlay", occurrence: -1 }
          ]
        },
        {
          id: "add-column",
          steps: [{ click: "Add column" }, { fill: { label: "Add column", text: "Blocked column" } }, { click: "Save" }]
        },
        {
          id: "rename-column",
          steps: [
            { click: "Ready" },
            { key: "o" },
            { click: "Rename", area: "overlay" },
            { fill: { label: "Rename column", text: "Blocked rename" } },
            { click: "Save" }
          ]
        },
        { id: "move-column-left", steps: [{ click: "Ready" }, { key: "LEFT" }] },
        { id: "move-column-right", steps: [{ click: "Backlog" }, { key: "RIGHT" }] },
        {
          id: "remove-column",
          steps: [
            { click: "Ready" },
            { key: "o" },
            { click: "Remove column" },
            { click: "Delete column", area: "overlay", occurrence: -1 }
          ]
        },
        {
          id: "set-wip",
          steps: [
            { click: "Ready" },
            { key: "o" },
            { click: "WIP", area: "overlay" },
            { fill: { label: "Set WIP limit", text: "2" } },
            { click: "Save" }
          ]
        },
        { id: "set-default", steps: [{ click: "Ready" }, { key: "o" }, { click: "Default", area: "overlay" }] }
      ].flatMap((attempt, index) => [
        ...(index === 0 ? [] : [{ restartAppNormally: true }, { key: "CTRL_3" }]),
        { remember: ["boards"] },
        { storageFault: { domain: "boards", kind: "deny-write" } },
        ...attempt.steps,
        { expect: { error: true, absentPattern: "EACCES|CANARY_SECRET|node_modules|stack trace|\\.ilu/" } },
        { storageFault: { domain: "boards", kind: "restore" } },
        { unchanged: ["boards"] },
        { screenshot: `rejected-${attempt.id}` },
        { key: "ESCAPE" }
      ]),
      { data: { domain: "boards", columnTitles: ["Backlog", "Ready"] } },
      { data: { domain: "boards", column: "Backlog", cardTitles: ["Card", "Second card"] } },
      { screenshot: "outcome" }
    ],
    fixture: "block-target-after-start",
    journey: [
      "Use independent restored fixture state for each attempted operation",
      "Block boards storage without replacing model methods",
      "Attempt card add, edit, move, priority, removal",
      "Attempt column add, rename, move left, move right, removal, WIP and default changes"
    ],
    expected: {
      rejectedOperations: [
        "add-card",
        "edit-card",
        "move-card",
        "prioritize-card",
        "remove-card",
        "add-column",
        "rename-column",
        "move-column-left",
        "move-column-right",
        "remove-column",
        "set-wip",
        "set-default"
      ],
      boardsUnchanged: true,
      leakedPrivateDetails: false
    }
  },
  {
    name: "card and column actions call existing model APIs with safe payloads",
    caseId: "board-card-column-crud",
    steps: [
      { key: "CTRL_3" },
      { screenshot: "condition" },
      { click: "Second card" },
      { key: "o" },
      { click: "Edit", area: "overlay" },
      { fill: { label: "Title", text: "  New  " } },
      { fill: { label: "Description", text: "  Desc  " } },
      { click: "Save" },
      { data: { domain: "boards", card: "New", description: "Desc", column: "Backlog" } },
      { click: "New" },
      { key: "RIGHT" },
      { data: { domain: "boards", card: "New", column: "Ready" } },
      { key: "LEFT" },
      { key: "SHIFT_UP" },
      { data: { domain: "boards", column: "Backlog", cardTitles: ["New", "Card"] } },
      { key: "o" },
      { click: "Remove", area: "overlay" },
      { click: "Delete card", area: "overlay", occurrence: -1 },
      { data: { domain: "boards", absentCard: "New" } },
      { click: "Add column" },
      { fill: { label: "Add column", text: "  Review  " } },
      { click: "Save" },
      { data: { domain: "boards", columnTitles: ["Backlog", "Ready", "Review"] } },
      { click: "Ready" },
      { key: "o" },
      { click: "Rename", area: "overlay" },
      { fill: { label: "Rename column", text: "  Doing  " } },
      { click: "Save" },
      { data: { domain: "boards", columnTitles: ["Backlog", "Doing", "Review"] } },
      { click: "Doing" },
      { key: "LEFT" },
      { data: { domain: "boards", columnTitles: ["Doing", "Backlog", "Review"] } },
      { key: "RIGHT" },
      { data: { domain: "boards", columnTitles: ["Backlog", "Doing", "Review"] } },
      { key: "o" },
      { click: "Remove column" },
      { click: "Delete column", area: "overlay", occurrence: -1 },
      { data: { domain: "boards", absentColumn: "Doing" } },
      { restartAppNormally: true },
      { key: "CTRL_3" },
      { data: { domain: "boards", columnTitles: ["Backlog", "Review"] } },
      { data: { domain: "boards", column: "Backlog", cardTitles: ["Card"] } },
      { expect: { texts: ["Card", "Review"], absent: "New" } },
      { screenshot: "outcome" }
    ],
    journey: [
      "Edit second Backlog card with '  New  ' and '  Desc  '",
      "Move it to second column",
      "Prioritize it to first in Backlog",
      "Remove it",
      "Add column '  Review  '",
      "Rename second column '  Doing  '",
      "Move Doing left then right",
      "Remove empty Doing",
      "Restart"
    ],
    expected: {
      editedCard: { title: "New", description: "Desc" },
      movedCardColumn: 2,
      prioritizedCardPosition: 1,
      removedCardPresent: false,
      addedColumnTitle: "Review",
      renamedColumnTitle: "Doing",
      reorderedColumnPositions: [1, 2],
      removedColumnPresent: false,
      persistedAfterRestart: true
    }
  },
  {
    name: "actions reject invalid selections before calling the model",
    caseId: "board-invalid-selections",
    seedBoards: [
      {
        title: "Launch board",
        current: true,
        columns: [
          { title: "Backlog", cards: [] },
          { title: "Ready", cards: [] }
        ]
      }
    ],
    steps: [
      { key: "CTRL_3" },
      { remember: ["boards"] },
      { screenshot: "condition" },
      { click: "Backlog" },
      { key: "o" },
      {
        expect: {
          overlayTexts: ["Rename", "WIP", "Remove column"],
          overlayAbsent: ["Edit", "Move", "Priority", "Delete card"]
        }
      },
      { key: "ESCAPE" },
      { unchanged: ["boards"] },
      { click: "Add column" },
      { fill: { label: "Add column", text: "   " } },
      { click: "Save" },
      { expect: { invalid: true } },
      { unchanged: ["boards"] },
      { click: "Cancel" },
      { click: "Backlog" },
      { key: "o" },
      { click: "Rename", area: "overlay" },
      { fill: { label: "Rename column", text: "   " } },
      { click: "Save" },
      { expect: { invalid: true } },
      { unchanged: ["boards"] },
      { click: "Cancel" },
      { click: "Backlog" },
      { key: "LEFT" },
      { unchanged: ["boards"] },
      { data: { domain: "boards", columnTitles: ["Backlog", "Ready"] } },
      { screenshot: "outcome" }
    ],
    journey: [
      "Open an empty board and try card edit, move, priority and removal without a selected card",
      "Submit whitespace title in Add column and Rename column",
      "Try moving the first column left"
    ],
    expected: { invalidOperationsChangedData: false, blankColumnSaved: false, firstColumnMovedLeft: false }
  },
  {
    name: "useBoard rejects missing ids before calling the model",
    caseId: "board-empty-selector",
    seedBoards: [],
    steps: [
      { key: "CTRL_3" },
      { remember: ["boards"] },
      { expect: { empty: true } },
      { screenshot: "condition" },
      { click: "No board yet" },
      { expect: { error: true, absent: "Description" } },
      { unchanged: ["boards"] },
      { screenshot: "outcome" },
      { key: "ESCAPE" },
      { key: "CTRL_1" },
      { expect: { text: "Add task" } }
    ],
    fixture: "no-boards",
    journey: [
      "Open board selector with no boards",
      "Try activating its empty selection",
      "Inspect data and application state"
    ],
    expected: { boardCreatedImplicitly: false, nonexistentBoardOpened: false, applicationUsable: true }
  },
  {
    name: "useBoard converts model failures into safe user-facing errors",
    caseId: "board-selection-write-failure",
    env: { ILU_CAPTURE_EMPTY_HOME: "1" },
    seedBoards: [
      { title: "Launch board", current: true, columns: [{ title: "Backlog", cards: [{ title: "Card" }] }] },
      { title: "Ops board", current: false, columns: [{ title: "Queue", cards: [{ title: "Ops card" }] }] }
    ],
    steps: [
      { key: "CTRL_3" },
      { remember: ["boards"] },
      { storageFault: { domain: "boards", kind: "deny-write" } },
      { screenshot: "condition" },
      { click: "Ops board" },
      { expect: { error: true, absentPattern: "EACCES|CANARY_SECRET|node_modules|stack trace" } },
      { storageFault: { domain: "boards", kind: "restore" } },
      { unchanged: ["boards"] },
      { data: { domain: "boards", currentTitle: "Launch board" } },
      { screenshot: "outcome" },
      { key: "ESCAPE" },
      { expect: { text: "Card", absent: "Ops card" } }
    ],
    fixture: "block-target-after-start",
    journey: ["Block boards storage after startup", "Select Ops board", "Observe failure without internal details"],
    expected: {
      switchRejected: true,
      currentBoardTitle: "Launch board",
      boardsUnchanged: true,
      leakedPrivateDetails: false
    }
  },
  {
    name: "useBoard forwards numeric iludb ids without string coercion",
    caseId: "board-numeric-id-selection",
    env: { ILU_CAPTURE_EMPTY_HOME: "1" },
    seedBoards: [
      { title: "Launch board", current: true, columns: [{ title: "Backlog", cards: [{ title: "Card" }] }] },
      { title: "Ops board", current: false, columns: [{ title: "Queue", cards: [{ title: "Ops card" }] }] }
    ],
    steps: [
      { key: "CTRL_3" },
      { screenshot: "condition" },
      { click: "Ops board" },
      { expect: { text: "Ops card" } },
      { data: { domain: "boards", currentId: 2, currentTitle: "Ops board" } },
      { restartAppNormally: true },
      { key: "CTRL_3" },
      { expect: { text: "Ops card" } },
      { data: { domain: "boards", currentId: 2, currentTitle: "Ops board" } },
      { screenshot: "outcome" }
    ],
    fixture: "numeric-ids",
    journey: ["Select Ops board with actual numeric iludb id 2", "Inspect Queue and Ops card", "Restart"],
    expected: {
      currentBoardId: 2,
      currentBoardTitle: "Ops board",
      restoredBoardId: 2,
      selectedCardTitles: ["Ops card"]
    }
  },
  {
    name: "board management and column parity actions reject invalid values before model calls",
    caseId: "board-management-invalid-values",
    seedBoards: [
      {
        title: "Launch board",
        current: true,
        columns: [
          { title: "Backlog", cards: [] },
          { title: "Ready", cards: [] }
        ]
      }
    ],
    steps: [
      { key: "CTRL_3" },
      { remember: ["boards"] },
      { screenshot: "condition" },
      { click: "Add board" },
      { fill: { label: "Title", text: "   " } },
      { click: "Save" },
      { expect: { invalid: true } },
      { unchanged: ["boards"] },
      { click: "Cancel" },
      { doubleClick: "Launch board" },
      { click: "Rename", area: "overlay" },
      { remember: ["boards"] },
      { fill: { label: "Title", text: "   " } },
      { click: "Save" },
      { expect: { invalid: true } },
      { unchanged: ["boards"] },
      { click: "Cancel" },
      { click: "Ready" },
      { key: "o" },
      { click: "WIP", area: "overlay" },
      { fill: { label: "Set WIP limit", text: "-1" } },
      { click: "Save" },
      { expect: { invalid: true } },
      { unchanged: ["boards"] },
      { fill: { label: "Set WIP limit", text: "abc" } },
      { click: "Save" },
      { expect: { invalid: true } },
      { unchanged: ["boards"] },
      { click: "Cancel" },
      { externalListChange: { domain: "boards", list: "Launch board", remove: true } },
      { restartAppNormally: true },
      { key: "CTRL_3" },
      { remember: ["boards"] },
      { doubleClick: "No board yet" },
      { expect: { error: true, overlayAbsent: ["Rename", "Delete board", "Default"] } },
      { unchanged: ["boards"] },
      { key: "ESCAPE" },
      { click: "Reset to default layout" },
      { click: "Reset to default layout", area: "overlay" },
      { expect: { invalid: true } },
      { unchanged: ["boards"] },
      { key: "ESCAPE" },
      { expect: { empty: true } },
      { screenshot: "outcome" }
    ],
    journey: [
      "Try Add board and Rename board with whitespace titles",
      "Try rename and remove with an empty selector in a separate empty fixture",
      "Try resetting columns without a board",
      "Submit WIP -1 and abc",
      "Attempt default-column selection with no column"
    ],
    expected: {
      rejectedInputs: [
        "blank-board-title",
        "missing-rename-selection",
        "blank-renamed-title",
        "missing-remove-selection",
        "reset-without-board",
        "negative-wip",
        "nonnumeric-wip",
        "missing-default-column"
      ],
      boardsUnchanged: true
    }
  },
  {
    name: "board management actions call existing model APIs with trimmed safe payloads",
    caseId: "board-management-crud",
    seedBoards: [
      {
        title: "Launch board",
        description: "Old",
        current: true,
        columns: [{ title: "Backlog", cards: [{ title: "Card" }] }]
      },
      {
        title: "Ops board",
        description: "",
        current: false,
        columns: [{ title: "Queue", cards: [{ title: "Ops card" }] }]
      }
    ],
    steps: [
      { key: "CTRL_3" },
      { screenshot: "condition" },
      { click: "Add board" },
      { fill: { label: "Title", text: "  Product  " } },
      { fill: { label: "Description", text: "  Work  " } },
      { click: "Save" },
      { data: { domain: "boards", board: "Product", description: "Work" } },
      { doubleClick: "Launch board" },
      { click: "Rename", area: "overlay" },
      { fill: { label: "Title", text: "  Launch v2  " } },
      { fill: { label: "Description", text: "  Done  " } },
      { click: "Save" },
      { data: { domain: "boards", board: "Launch v2", description: "Done" } },
      { click: "Launch v2" },
      { doubleClick: "Launch v2" },
      { click: "Delete board", area: "overlay", occurrence: -1 },
      { click: "Delete board", area: "overlay", occurrence: -1 },
      { data: { domain: "boards", absentBoard: "Launch v2" } },
      { data: { domain: "boards", currentTitle: "Ops board" } },
      { restartAppNormally: true },
      { key: "CTRL_3" },
      { expect: { text: "Ops card", absent: "Launch v2" } },
      { data: { domain: "boards", currentTitle: "Ops board" } },
      { data: { domain: "boards", board: "Product", description: "Work" } },
      { screenshot: "outcome" }
    ],
    journey: [
      "Add '  Product  ' with '  Work  '",
      "Rename Launch board to '  Launch v2  ' with '  Done  '",
      "Select Launch v2 and remove it",
      "Inspect fallback and restart"
    ],
    expected: {
      addedBoard: { title: "Product", description: "Work" },
      renamedBoardBeforeRemoval: { title: "Launch v2", description: "Done" },
      removedBoardPresent: false,
      currentBoardTitle: "Ops board",
      restoredBoardTitle: "Ops board"
    }
  },
  {
    name: "column parity actions enforce reset constraints and forward WIP/default operations",
    caseId: "board-column-settings",
    seedBoards: [
      {
        title: "Launch board",
        current: true,
        columns: [
          { title: "Backlog", cards: [] },
          { title: "Doing", cards: [] }
        ]
      }
    ],
    steps: [
      { key: "CTRL_3" },
      { screenshot: "condition" },
      { click: "Reset to default layout" },
      { click: "Reset to default layout", area: "overlay" },
      { data: { domain: "boards", columnTitles: ["Backlog", "Ready", "In Progress", "Done"] } },
      { click: "Backlog" },
      { key: "o" },
      { click: "WIP", area: "overlay" },
      { fill: { label: "Set WIP limit", text: "0" } },
      { click: "Save" },
      { data: { domain: "boards", column: "Backlog", noWipLimit: true } },
      { click: "Ready" },
      { key: "o" },
      { click: "WIP", area: "overlay" },
      { fill: { label: "Set WIP limit", text: " 4 " } },
      { click: "Save" },
      { data: { domain: "boards", column: "Ready", wipLimit: 4 } },
      { click: "Ready" },
      { key: "o" },
      { click: "Default", area: "overlay" },
      { data: { domain: "boards", defaultColumn: "Ready" } },
      { click: "Add card" },
      { fill: { label: "Title", text: "Default destination" } },
      { click: "Save" },
      { data: { domain: "boards", card: "Default destination", columnIndex: 2 } },
      { restartAppNormally: true },
      { key: "CTRL_3" },
      { data: { domain: "boards", defaultColumn: "Ready", column: "Ready", wipLimit: 4 } },
      { data: { domain: "boards", card: "Default destination", columnIndex: 2 } },
      { screenshot: "outcome" }
    ],
    fixture: "empty-boards",
    journey: [
      "Reset empty board to default columns",
      "Set first column WIP to 0",
      "Set second column WIP to ' 4 '",
      "Set second as default",
      "Add a card with no explicit column",
      "Restart"
    ],
    expected: {
      resetColumnTitles: ["Backlog", "Ready", "In Progress", "Done"],
      firstColumnWip: null,
      secondColumnWip: 4,
      defaultColumnIndex: 2,
      addedCardColumnIndex: 2,
      restoredDefaultColumnIndex: 2
    }
  },
  {
    name: "resetDefaultColumns blocks non-empty boards before calling the model",
    caseId: "board-reset-nonempty",
    steps: [
      { key: "CTRL_3" },
      { remember: ["boards"] },
      { screenshot: "condition" },
      { click: "Reset to default layout" },
      { expect: { error: true } },
      { unchanged: ["boards"] },
      { data: { domain: "boards", column: "Backlog", cardTitles: ["Card", "Second card"] } },
      { screenshot: "outcome" },
      { key: "ESCAPE" },
      { expect: { texts: ["Card", "Second card"] } }
    ],
    journey: [
      "Open a board containing Card",
      "Attempt reset to default columns",
      "Inspect the card and original columns after rejection"
    ],
    expected: { resetRejected: true, boardsUnchanged: true, retainedCardTitles: ["Card", "Second card"] }
  },
  {
    name: "board and column parity actions convert model failures into safe user-facing errors",
    caseId: "board-management-write-failures",
    seedBoards: [
      {
        title: "Launch board",
        current: true,
        columns: [
          { title: "Backlog", cards: [] },
          { title: "Ready", cards: [] }
        ]
      }
    ],
    steps: [
      { key: "CTRL_3" },
      { screenshot: "condition" },
      ...[
        {
          id: "add-board",
          steps: [{ click: "Add board" }, { fill: { label: "Title", text: "Blocked board" } }, { click: "Save" }]
        },
        {
          id: "rename-board",
          prepare: [{ doubleClick: "Launch board" }, { click: "Rename", area: "overlay" }],
          steps: [{ fill: { label: "Title", text: "Blocked rename" } }, { click: "Save" }]
        },
        {
          id: "set-wip",
          steps: [
            { click: "Ready" },
            { key: "o" },
            { click: "WIP", area: "overlay" },
            { fill: { label: "Set WIP limit", text: "2" } },
            { click: "Save" }
          ]
        },
        { id: "set-default", steps: [{ click: "Ready" }, { key: "o" }, { click: "Default", area: "overlay" }] },
        {
          id: "reset-columns",
          steps: [{ click: "Reset to default layout" }, { click: "Reset to default layout", area: "overlay" }]
        }
      ].flatMap((attempt, index) => [
        ...(index === 0 ? [] : [{ restartAppNormally: true }, { key: "CTRL_3" }]),
        ...(attempt.prepare ?? []),
        { remember: ["boards"] },
        { storageFault: { domain: "boards", kind: "deny-write" } },
        ...attempt.steps,
        { expect: { error: true, absentPattern: "EACCES|CANARY_SECRET|node_modules|stack trace|\\.ilu/" } },
        { storageFault: { domain: "boards", kind: "restore" } },
        { unchanged: ["boards"] },
        { screenshot: `rejected-${attempt.id}` },
        { key: "ESCAPE" }
      ]),
      { data: { domain: "boards", currentTitle: "Launch board", columnTitles: ["Backlog", "Ready"] } },
      { screenshot: "outcome" },
      { key: "CTRL_1" },
      { expect: { text: "Add task" } }
    ],
    fixture: "block-target-after-start",
    journey: [
      "From separate valid fixtures block boards target after startup",
      "Try board add, board rename, WIP change, default change and empty-column reset",
      "Observe each failure without exposing private paths"
    ],
    expected: {
      rejectedOperations: ["add-board", "rename-board", "set-wip", "set-default", "reset-columns"],
      boardsUnchanged: true,
      leakedPrivateDetails: false,
      applicationUsable: true
    }
  }
];

for (const entry of cases) {
  test(entry.name, async (context) => {
    if (Object.hasOwn(entry, "steps")) {
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "tuiInteraction",
        command: captureCommand,
        env: entry.env ?? {},
        viewport: { cols: 120, rows: 40 },
        input: {
          seed: {
            boards: Object.hasOwn(entry, "seedBoards")
              ? entry.seedBoards
              : [
                  {
                    title: "Launch board",
                    current: true,
                    columns: [
                      {
                        title: "Backlog",
                        cards: [{ title: "Card", description: "Details" }, { title: "Second card" }]
                      },
                      { title: "Ready", cards: [] }
                    ]
                  }
                ]
          },
          steps: entry.steps,
          externalIsolation: "deny-unmatched",
          finish: "normal-exit"
        }
      });
      assert.equal(result.exitCode, 0);
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: ["condition", "outcome"],
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
    const result = await captureIluScenario({
      testName: context.name,
      scenario: "adapterBehavior",
      command: ["node", "bin/cli.js", "ui"],
      input: {
        area: "board",
        caseId: entry.caseId,
        fixture: {
          kind: entry.fixture ?? "numeric-ids",
          boards: [
            {
              id: 1,
              title: "Launch board",
              description: "Old",
              current: true,
              columns: [
                {
                  title: "Backlog",
                  cards: [
                    { title: "Card", description: "Details" },
                    { title: "Second card", description: "" }
                  ]
                },
                { title: "Ready", cards: [] }
              ]
            },
            {
              id: 2,
              title: "Ops board",
              description: "",
              current: false,
              columns: [{ title: "Queue", cards: [{ title: "Ops card", description: "" }] }]
            }
          ]
        },
        journey: entry.journey
      },
      viewport: { cols: 120, rows: 40 }
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
