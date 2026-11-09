import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts, captureCommand } from "./test-helpers/terminal-capture-scenarios.ts";

// Fixtures are persisted before mounting the real application. A fixture may
// describe legacy file data, never an injected read-model or rendered snapshot.
const cases = [
  {
    name: "buildReadSnapshot lee datos actuales de todo, notes, board y clocks sin mutar",
    caseId: "read-all-domains",
    fixture: "current-data",
    journey: [
      "Visit Todo, Notes, Board and Clocks without invoking mutations",
      "Read every seeded item, task completion and board card",
      "Compare original data files after visiting all panels"
    ],
    expected: {
      todoTitles: ["Ship read view", "Review output", "Keep scope small", "Leave forms alone"],
      completedTodoTitles: ["Review output"],
      noteTitles: ["Threat model", "CLI notes"],
      boardColumns: ["Backlog", "Done"],
      boardCardTitles: ["Write tests", "Wire UI", "Smoke"],
      clockNames: ["Mexico City", "UTC"],
      domainFilesUnchanged: true
    }
  },
  {
    name: "buildReadSnapshot formatea clocks como HH:MM:SS deterministico sin AM/PM",
    caseId: "read-clock-format",
    fixture: "utc-clock-en-us-locale",
    journey: [
      "Launch the real application with LC_ALL and LANG en_US.UTF-8",
      "Open Clocks",
      "Observe UTC clock across a second boundary and capture both values"
    ],
    expected: { clockNames: ["UTC"], clockTimezone: "Etc/UTC", utcClockTracksWallTime: true }
  },
  {
    name: "buildReadSnapshot usa primera lista o board cuando no hay actual",
    caseId: "read-fallback-current",
    fixture: "no-current-records",
    journey: [
      "Open Todo, Notes and Board with no current flag in any file",
      "Inspect first-list fallback in each panel",
      "Verify viewing does not rewrite current flags"
    ],
    expected: {
      todoListTitle: "Inbox",
      todoTitles: ["Fallback task"],
      noteListTitle: "Scratch",
      noteTitles: ["Fallback note"],
      boardTitle: "First board",
      boardCardTitles: ["Queued card"],
      domainFilesUnchanged: true
    }
  },
  {
    name: "buildReadSnapshot normaliza datos ausentes a estados vacios seguros",
    caseId: "read-empty-domains",
    fixture: "empty-domains",
    journey: ["Visit all four empty panels", "Check usable empty states and available create actions", "Exit normally"],
    expected: {
      todoTitles: [],
      noteTitles: [],
      boardColumns: [],
      clockNames: [],
      emptyPanelsUsable: ["Todo", "Notes", "Board", "Clocks"],
      recordsCreatedByViewing: false
    }
  },
  {
    name: "buildReadSnapshot reporta errores por panel sin romper toda la pantalla",
    caseId: "read-panel-failure-isolation",
    fixture: "invalid-clock-zone-with-healthy-lists",
    journey: [
      "Read a healthy Todo list without an injected throwing model",
      "Open Notes and inspect Research",
      "Open Clocks with Broken clock and Invalid/Zone",
      "Verify failure stays local and no stack is exposed"
    ],
    expected: {
      todoUsable: true,
      noteListTitle: "Research",
      brokenClockVisible: true,
      brokenClockHasUnavailableTime: true,
      leakedPrivateDetails: false,
      applicationUsable: true
    }
  },
  {
    name: "buildReadSnapshot exposes board column indexes and card positions for click selection",
    caseId: "read-board-hit-selection",
    fixture: "current-data",
    journey: [
      "Click Write tests in Backlog and open details",
      "Close and click Wire UI in Backlog",
      "Close and click Smoke in Done",
      "Inspect details for the actual selected card at each position"
    ],
    expected: {
      openedCardTitles: ["Write tests", "Wire UI", "Smoke"],
      openedCardDescriptions: ["", "", ""],
      domainFilesUnchanged: true
    }
  },
  {
    name: "buildReadSnapshot exposes board WIP limits for Board headers",
    caseId: "read-board-wip",
    fixture: "board-backlog-wip-3-done-unlimited",
    journey: [
      "Open Board",
      "Inspect Backlog occupancy and WIP 3",
      "Inspect unlimited Done header",
      "Open column details to confirm each displayed limit"
    ],
    expected: {
      backlogVisibleWip: 3,
      doneVisibleWip: null,
      backlogVisibleCardTitles: ["Write tests"],
      doneVisibleCardTitles: ["Smoke"],
      domainFilesUnchanged: true
    }
  },
  {
    name: "buildReadSnapshot expone todas las columnas y cards del board visual sin marcadores restantes",
    caseId: "read-board-all-items",
    fixture: "six-columns-six-first-column-cards",
    journey: [
      "Open Release board",
      "Navigate horizontally through all six columns",
      "Navigate through all six cards in Column 1",
      "Collect visible card titles over the actual scrolled screens"
    ],
    expected: {
      visitedColumnTitles: ["Column 1", "Column 2", "Column 3", "Column 4", "Column 5", "Column 6"],
      visitedFirstColumnCardTitles: ["Card 1", "Card 2", "Card 3", "Card 4", "Card 5", "Card 6"],
      hiddenByArtificialLimit: false,
      domainFilesUnchanged: true
    }
  },
  {
    name: "buildReadSnapshot conserva ids numericos reales de boards de iludb",
    caseId: "read-board-numeric-ids",
    fixture: "two-numeric-id-boards",
    journey: [
      "Open board selector",
      "Choose Ops board with actual numeric id 2",
      "Choose Launch board with numeric id 1",
      "Restart and verify selected record"
    ],
    expected: { selectedBoardIds: [2, 1], selectedBoardTitles: ["Ops board", "Launch board"], restoredBoardId: 1 }
  },
  {
    name: "buildReadSnapshot preserves real note content and object label titles",
    caseId: "read-content-labels",
    fixture: "mixed-legacy-labels",
    journey: [
      "Open Threat model details and inspect Actual note body",
      "Inspect sec, audit and raw labels",
      "Open Tagged task details and inspect urgent, ui and loose labels",
      "Compare files without saving"
    ],
    expected: {
      noteContent: "Actual note body",
      noteLabels: ["sec", "audit", "raw"],
      taskLabels: ["urgent", "ui", "loose"],
      blankOrNullLabelRendered: false,
      domainFilesUnchanged: true
    }
  },
  {
    name: "buildReadSnapshot exposes all todo and note items instead of truncating at default limit",
    caseId: "read-all-list-items",
    fixture: "six-todos-six-notes",
    journey: [
      "Navigate all six Todo rows",
      "Navigate all six Notes rows and inspect the last note content",
      "Collect items from actual visible scrolled frames"
    ],
    expected: {
      todoTitles: ["Task 1", "Task 2", "Task 3", "Task 4", "Task 5", "Task 6"],
      noteTitles: ["Note 1", "Note 2", "Note 3", "Note 4", "Note 5", "Note 6"],
      lastNoteContent: "Body 6",
      hiddenByArtificialLimit: false,
      domainFilesUnchanged: true
    }
  },
  {
    name: "buildReadSnapshot exposes board descriptions and default column metadata for Board management UI",
    caseId: "read-board-management-metadata",
    fixture: "launch-default-doing",
    journey: [
      "Open Manage boards and inspect Launch board Ship flow and Ops board Ops flow",
      "Inspect Backlog and Doing default state and Doing WIP 2",
      "Add a card without selecting an explicit destination"
    ],
    expected: {
      boardDescriptions: ["Ship flow", "Ops flow"],
      backlogIsDefault: false,
      doingIsDefault: true,
      doingWip: 2,
      addedCardColumnTitle: "Doing"
    }
  },
  {
    name: "buildReadSnapshot exposes all clocks for Clocks page management without footer truncation markers",
    caseId: "read-all-clocks",
    fixture: "six-utc-clocks",
    journey: [
      "Open Clocks",
      "Navigate all six named clocks",
      "Open details for Clock 6",
      "Verify the sixth clock can be managed without modifying data"
    ],
    expected: {
      clockNames: ["Clock 1", "Clock 2", "Clock 3", "Clock 4", "Clock 5", "Clock 6"],
      lastOpenedClock: "Clock 6",
      hiddenByArtificialLimit: false,
      domainFilesUnchanged: true
    }
  }
];

const physicalReads = {
  "read-panel-failure-isolation": {
    seed: {
      todos: [{ title: "Inbox", current: true, tasks: [{ title: "Healthy task" }] }],
      notes: [
        { title: "Research", current: true, notes: [{ title: "Healthy note", content: "Read after clock failure" }] }
      ],
      boards: [],
      clocks: [{ name: "Broken clock", timezone: "Invalid/Zone" }]
    },
    steps: [
      { key: "CTRL_4" },
      {
        expect: {
          texts: ["Broken clock", "unavailable"],
          absent: ["RangeError", "TypeError", "node_modules", "at Intl"]
        }
      },
      { screenshot: "condition" },
      { key: "CTRL_2" },
      { expect: { texts: ["Research", "Healthy note"] } },
      { click: "Healthy note", area: "content" },
      { key: "ENTER" },
      { expect: { overlayTexts: ["Read after clock failure"] } },
      { key: "ESCAPE" },
      { key: "CTRL_1" },
      { expect: { texts: ["Inbox", "Healthy task", "Add task"] } }
    ]
  },
  "read-clock-format": {
    seed: { todos: [], notes: [], boards: [], clocks: [{ name: "UTC", timezone: "Etc/UTC" }] },
    env: { LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
    steps: [
      { key: "CTRL_4" },
      { expect: { text: "Etc/UTC" } },
      { observeUtcClock: { as: "first" } },
      { screenshot: "condition" },
      { observeUtcClock: { as: "second", differentFrom: "first" } }
    ]
  },
  "read-board-management-metadata": {
    seed: {
      todos: [],
      notes: [],
      clocks: [],
      boards: [
        {
          title: "Launch board",
          description: "Ship flow",
          current: true,
          defaultColumnId: "doing",
          columns: [
            { id: "backlog", title: "Backlog", cards: [] },
            { id: "doing", title: "Doing", wipLimit: 2, cards: [] }
          ]
        },
        { title: "Ops board", description: "Ops flow", current: false, columns: [{ title: "Queue", cards: [] }] }
      ]
    },
    preserveDomains: ["todos", "notes", "clocks"],
    steps: [
      { key: "CTRL_3" },
      { click: "Add card", area: "actions" },
      { type: "Default destination card" },
      { click: "Save", area: "overlay" },
      { data: { domain: "boards", board: "Launch board", card: "Default destination card", column: "Doing" } },
      { doubleClick: "Launch board" },
      { expect: { overlayTexts: ["Ship flow", "Rename"] } },
      { screenshot: "condition" },
      { key: "ESCAPE" },
      { doubleClick: "Ops board" },
      { expect: { overlayTexts: ["Ops flow", "Rename"] } },
      { key: "ESCAPE" },
      { click: "Launch board", area: "content" },
      { doubleClick: "Backlog" },
      { expect: { overlayTexts: ["Backlog", "Default"], overlayAbsent: "Current" } },
      { key: "ESCAPE" },
      { doubleClick: "Doing" },
      { expect: { overlayTexts: ["Doing", "Current"] } },
      { click: "WIP", area: "overlay" },
      { expect: { textPattern: "(?:^|\\n)[ │]*2[ │]*(?:\\n|$)" } }
    ]
  },
  "read-board-numeric-ids": {
    seed: {
      todos: [],
      notes: [],
      clocks: [],
      boards: [
        { title: "Launch board", current: true, columns: [{ title: "Backlog", cards: [] }] },
        { title: "Ops board", current: false, columns: [{ title: "Queue", cards: [] }] }
      ]
    },
    preserveDomains: ["todos", "notes", "clocks"],
    steps: [
      { key: "CTRL_3" },
      { click: "Ops board", area: "content" },
      { data: { domain: "boards", currentTitle: "Ops board", currentId: 2 } },
      { expect: { text: "Queue" } },
      { screenshot: "condition" },
      { click: "Launch board", area: "content" },
      { data: { domain: "boards", currentTitle: "Launch board", currentId: 1 } },
      { restartAppNormally: true },
      { key: "CTRL_3" },
      { expect: { text: "Backlog", absent: "Queue" } },
      { data: { domain: "boards", currentTitle: "Launch board", currentId: 1 } }
    ]
  },
  "read-board-all-items": {
    seed: {
      todos: [],
      notes: [],
      clocks: [],
      boards: [
        {
          title: "Release board",
          current: true,
          columns: Array.from({ length: 6 }, (_, index) => ({
            title: `Column ${index + 1}`,
            cards: index === 0 ? Array.from({ length: 6 }, (_, cardIndex) => ({ title: `Card ${cardIndex + 1}` })) : []
          }))
        }
      ]
    },
    steps: [
      { key: "CTRL_3" },
      {
        expect: {
          texts: [
            "Column 1",
            "Column 2",
            "Column 3",
            "Column 4",
            "Column 5",
            "Column 6",
            "Card 1",
            "Card 2",
            "Card 3",
            "Card 4",
            "Card 5",
            "Card 6"
          ]
        }
      },
      { screenshot: "condition" },
      ...Array.from({ length: 6 }, (_, index) => [
        { doubleClick: `Column ${index + 1}` },
        { expect: { overlayTexts: [`Column ${index + 1}`, "WIP"] } },
        { key: "ESCAPE" }
      ]).flat(),
      { doubleClick: "Card 6" },
      { expect: { overlayTexts: ["Column 1", "Card 6", "Edit"] } }
    ]
  },
  "read-all-clocks": {
    seed: {
      todos: [],
      notes: [],
      boards: [],
      clocks: Array.from({ length: 6 }, (_, index) => ({ name: `Clock ${index + 1}`, timezone: "Etc/UTC" }))
    },
    steps: [
      { key: "CTRL_4" },
      { expect: { texts: ["Clock 1", "Clock 2", "Clock 3", "Clock 4", "Clock 5", "Clock 6"] } },
      { screenshot: "condition" },
      { click: "Clock 6", area: "content" },
      { expect: { overlayTexts: ["Clock 6", "Etc/UTC", "Move up", "Remove", "Close"] } }
    ]
  },
  "read-content-labels": {
    seed: {
      todos: [
        {
          title: "Inbox",
          current: true,
          tasks: [
            {
              title: "Tagged task",
              labels: [{ title: "urgent", color: "red" }, { title: " ui " }, "loose", { title: "" }, null]
            }
          ]
        }
      ],
      notes: [
        {
          title: "Research",
          current: true,
          notes: [
            {
              title: "Threat model",
              content: "Actual note body",
              labels: [{ title: "sec", color: "blue" }, { title: " audit " }, "raw", "", null]
            }
          ]
        }
      ],
      boards: [],
      clocks: []
    },
    steps: [
      { click: "Tagged task", area: "content" },
      { key: "o" },
      { expect: { texts: ["urgent", "ui", "loose"], absent: ["[object Object]", "null", "undefined", " ui "] } },
      { screenshot: "condition" },
      { key: "ESCAPE" },
      { key: "CTRL_2" },
      { click: "Threat model", area: "content" },
      { key: "ENTER" },
      {
        expect: {
          texts: ["Actual note body", "sec", "audit", "raw"],
          absent: ["[object Object]", "null", "undefined", " audit "]
        }
      }
    ]
  },
  "read-all-list-items": {
    seed: {
      todos: [
        {
          title: "Inbox",
          current: true,
          tasks: Array.from({ length: 6 }, (_, index) => ({ title: `Task ${index + 1}`, done: false }))
        }
      ],
      notes: [
        {
          title: "Research",
          current: true,
          notes: Array.from({ length: 6 }, (_, index) => ({ title: `Note ${index + 1}`, content: `Body ${index + 1}` }))
        }
      ],
      boards: [],
      clocks: []
    },
    steps: [
      { expect: { texts: ["Task 1", "Task 2", "Task 3", "Task 4", "Task 5", "Task 6"] } },
      { click: "Task 6", area: "content" },
      { key: "o" },
      { expect: { text: "Task 6" } },
      { screenshot: "condition" },
      { key: "ESCAPE" },
      { key: "CTRL_2" },
      { expect: { texts: ["Note 1", "Note 2", "Note 3", "Note 4", "Note 5", "Note 6"] } },
      { click: "Note 6", area: "content" },
      { key: "ENTER" },
      { expect: { texts: ["Note 6", "Body 6"] } }
    ]
  },
  "read-board-wip": {
    seed: {
      todos: [],
      notes: [],
      clocks: [],
      boards: [
        {
          title: "Launch board",
          current: true,
          columns: [
            { title: "Backlog", wipLimit: 3, cards: [{ title: "Write tests" }] },
            { title: "Done", wipLimit: null, cards: [{ title: "Smoke" }] }
          ]
        }
      ]
    },
    steps: [
      { key: "CTRL_3" },
      { expect: { sameRowOrdered: ["Backlog", "(1/3)"], texts: ["Write tests", "Smoke"] } },
      { expect: { sameRowOrdered: ["Done", "(1)"] } },
      { doubleClick: "Backlog" },
      { click: "WIP", area: "overlay" },
      { expect: { textPattern: "(?:^|\\n)[ │]*3[ │]*(?:\\n|$)" } },
      { screenshot: "condition" },
      { key: "ESCAPE" },
      { doubleClick: "Done" },
      { click: "WIP", area: "overlay" },
      { expect: { textPattern: "(?:^|\\n)[ │]*0[ │]*(?:\\n|$)" } }
    ]
  },
  "read-all-domains": {
    seed: {
      todos: [
        {
          title: "Inbox",
          current: true,
          tasks: [
            { title: "Ship read view", done: false },
            { title: "Review output", done: true },
            { title: "Keep scope small", done: false },
            { title: "Leave forms alone", done: false }
          ]
        }
      ],
      notes: [
        {
          title: "Research",
          current: true,
          notes: [
            { title: "Threat model", content: "Read only" },
            { title: "CLI notes", content: "Keep local data" }
          ]
        }
      ],
      boards: [
        {
          title: "Launch board",
          current: true,
          columns: [
            { title: "Backlog", cards: [{ title: "Write tests" }, { title: "Wire UI" }] },
            { title: "Done", cards: [{ title: "Smoke" }] }
          ]
        }
      ],
      clocks: [
        { name: "Mexico City", timezone: "America/Mexico_City" },
        { name: "UTC", timezone: "Etc/UTC" }
      ]
    },
    steps: [
      { expect: { texts: ["Ship read view", "Review output", "Keep scope small", "Leave forms alone"] } },
      { click: "Review output", area: "content" },
      { key: "o" },
      { expect: { texts: ["Review output", "Reopen task"] } },
      { key: "ESCAPE" },
      { screenshot: "condition" },
      { key: "CTRL_2" },
      { expect: { texts: ["Threat model", "CLI notes"] } },
      { key: "CTRL_3" },
      { expect: { texts: ["Backlog", "Done", "Write tests", "Wire UI", "Smoke"] } },
      { key: "CTRL_4" },
      { expect: { texts: ["Mexico City", "UTC", "America/Mexico_City", "Etc/UTC"] } }
    ]
  },
  "read-empty-domains": {
    seed: { todos: [], notes: [], boards: [], clocks: [] },
    steps: [
      { expect: { text: "Add task" } },
      { screenshot: "condition" },
      { key: "CTRL_2" },
      { expect: { text: "Add note" } },
      { key: "CTRL_3" },
      { expect: { text: "Add board" } },
      { key: "CTRL_4" },
      { expect: { text: "Add clock" } }
    ]
  },
  "read-fallback-current": {
    seed: {
      todos: [{ title: "Inbox", current: false, tasks: [{ title: "Fallback task", done: false }] }],
      notes: [{ title: "Scratch", current: false, notes: [{ title: "Fallback note", content: "Fallback content" }] }],
      boards: [
        { title: "First board", current: false, columns: [{ title: "Backlog", cards: [{ title: "Queued card" }] }] }
      ],
      clocks: []
    },
    steps: [
      { expect: { texts: ["Inbox", "Fallback task"] } },
      { screenshot: "condition" },
      { key: "CTRL_2" },
      { expect: { texts: ["Scratch", "Fallback note"] } },
      { key: "CTRL_3" },
      { expect: { texts: ["First board", "Queued card"] } }
    ]
  }
};
physicalReads["read-board-hit-selection"] = {
  seed: physicalReads["read-all-domains"].seed,
  steps: [
    { key: "CTRL_3" },
    { doubleClick: "Write tests" },
    { expect: { text: "Backlog | Write tests" } },
    { screenshot: "condition" },
    { key: "ESCAPE" },
    { doubleClick: "Wire UI" },
    { expect: { text: "Backlog | Wire UI" } },
    { key: "ESCAPE" },
    { doubleClick: "Smoke" },
    { expect: { text: "Done | Smoke" } }
  ]
};

for (const entry of cases) {
  test(entry.name, async (context) => {
    const physical = physicalReads[entry.caseId];
    if (typeof physical === "object") {
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "tuiInteraction",
        command: captureCommand,
        env: { ILU_CAPTURE_EMPTY_HOME: "1", ...(physical.env ?? {}) },
        viewport: { cols: 120, rows: 40 },
        input: {
          seed: physical.seed,
          steps: [
            { remember: physical.preserveDomains ?? ["todos", "notes", "boards", "clocks"] },
            ...physical.steps,
            { unchanged: physical.preserveDomains ?? ["todos", "notes", "boards", "clocks"] },
            { screenshot: "outcome" }
          ],
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
      input: { area: "read-model", caseId: entry.caseId, fixture: entry.fixture, journey: entry.journey },
      viewport: { cols: 120, rows: 40 }
    });
    assert.equal(result.exitCode, 0);
    for (const [key, expected] of Object.entries(entry.expected)) {
      assert.deepEqual(result.observed[key], expected, `${entry.caseId}: ${key}`);
    }
    if (entry.caseId === "read-clock-format") {
      assert.ok(result.observed.clockTimes.length >= 2);
      for (const time of result.observed.clockTimes) {
        assert.match(time, /^\d{2}:\d{2}:\d{2}$/);
        assert.doesNotMatch(time, /AM|PM/i);
      }
      assert.notEqual(result.observed.clockTimes[0], result.observed.clockTimes.at(-1));
    }
    assertCaptureArtifacts({
      result,
      testName: context.name,
      checkpoints: ["condition", "outcome"],
      diagnostic: (message) => context.diagnostic(message)
    });
  });
}
