import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

// Fixtures are persisted before mounting the real application. A fixture may
// describe legacy file data, never an injected read-model or rendered snapshot.
const cases = [
  {
    name: "buildReadSnapshot lee datos actuales de todo, notes, board y clocks sin mutar",
    caseId: "read-all-domains",
    fixture: "current-data",
    journey: ["Visit Todo, Notes, Board and Clocks without invoking mutations", "Read every seeded item, task completion and board card", "Compare original data files after visiting all panels"],
    expected: { todoTitles: ["Ship read view", "Review output", "Keep scope small", "Leave forms alone"], completedTodoTitles: ["Review output"], noteTitles: ["Threat model", "CLI notes"], boardColumns: ["Backlog", "Done"], boardCardTitles: ["Write tests", "Wire UI", "Smoke"], clockNames: ["Mexico City", "UTC"], domainFilesUnchanged: true }
  },
  {
    name: "buildReadSnapshot formatea clocks como HH:MM:SS deterministico sin AM/PM",
    caseId: "read-clock-format",
    fixture: "utc-clock-en-us-locale",
    journey: ["Launch the real application with LC_ALL and LANG en_US.UTF-8", "Open Clocks", "Observe UTC clock across a second boundary and capture both values"],
    expected: { clockNames: ["UTC"], clockTimezone: "Etc/UTC", utcClockTracksWallTime: true }
  },
  {
    name: "buildReadSnapshot usa primera lista o board cuando no hay actual",
    caseId: "read-fallback-current",
    fixture: "no-current-records",
    journey: ["Open Todo, Notes and Board with no current flag in any file", "Inspect first-list fallback in each panel", "Verify viewing does not rewrite current flags"],
    expected: { todoListTitle: "Inbox", todoTitles: ["Fallback task"], noteListTitle: "Scratch", noteTitles: ["Fallback note"], boardTitle: "First board", boardCardTitles: ["Queued card"], domainFilesUnchanged: true }
  },
  {
    name: "buildReadSnapshot normaliza datos ausentes a estados vacios seguros",
    caseId: "read-empty-domains",
    fixture: "empty-domains",
    journey: ["Visit all four empty panels", "Check usable empty states and available create actions", "Exit normally"],
    expected: { todoTitles: [], noteTitles: [], boardColumns: [], clockNames: [], emptyPanelsUsable: ["Todo", "Notes", "Board", "Clocks"], recordsCreatedByViewing: false }
  },
  {
    name: "buildReadSnapshot reporta errores por panel sin romper toda la pantalla",
    caseId: "read-panel-failure-isolation",
    fixture: "unreadable-todos-and-invalid-clock-zone",
    journey: ["Cause real Todo read failure after startup and refresh its panel", "Open Notes and inspect Research", "Open Clocks with Broken clock and Invalid/Zone", "Verify failure stays local and no stack is exposed"],
    expected: { todoUnavailable: true, noteListTitle: "Research", brokenClockVisible: true, brokenClockHasUnavailableTime: true, leakedPrivateDetails: false, applicationUsable: true }
  },
  {
    name: "buildReadSnapshot exposes board column indexes and card positions for click selection",
    caseId: "read-board-hit-selection",
    fixture: "current-data",
    journey: ["Click Write tests in Backlog and open details", "Close and click Wire UI in Backlog", "Close and click Smoke in Done", "Inspect details for the actual selected card at each position"],
    expected: { openedCardTitles: ["Write tests", "Wire UI", "Smoke"], openedCardDescriptions: ["", "", ""], domainFilesUnchanged: true }
  },
  {
    name: "buildReadSnapshot exposes board WIP limits for Board headers",
    caseId: "read-board-wip",
    fixture: "board-backlog-wip-3-done-unlimited",
    journey: ["Open Board", "Inspect Backlog occupancy and WIP 3", "Inspect unlimited Done header", "Open column details to confirm each displayed limit"],
    expected: { backlogVisibleWip: 3, doneVisibleWip: null, backlogVisibleCardTitles: ["Write tests"], doneVisibleCardTitles: ["Smoke"], domainFilesUnchanged: true }
  },
  {
    name: "buildReadSnapshot expone todas las columnas y cards del board visual sin marcadores restantes",
    caseId: "read-board-all-items",
    fixture: "six-columns-six-first-column-cards",
    journey: ["Open Release board", "Navigate horizontally through all six columns", "Navigate through all six cards in Column 1", "Collect visible card titles over the actual scrolled screens"],
    expected: { visitedColumnTitles: ["Column 1", "Column 2", "Column 3", "Column 4", "Column 5", "Column 6"], visitedFirstColumnCardTitles: ["Card 1", "Card 2", "Card 3", "Card 4", "Card 5", "Card 6"], hiddenByArtificialLimit: false, domainFilesUnchanged: true }
  },
  {
    name: "buildReadSnapshot conserva ids numericos reales de boards de iludb",
    caseId: "read-board-numeric-ids",
    fixture: "two-numeric-id-boards",
    journey: ["Open board selector", "Choose Ops board with actual numeric id 2", "Choose Launch board with numeric id 1", "Restart and verify selected record"],
    expected: { selectedBoardIds: [2, 1], selectedBoardTitles: ["Ops board", "Launch board"], restoredBoardId: 1 }
  },
  {
    name: "buildReadSnapshot preserves real note content and object label titles",
    caseId: "read-content-labels",
    fixture: "mixed-legacy-labels",
    journey: ["Open Threat model details and inspect Actual note body", "Inspect sec, audit and raw labels", "Open Tagged task details and inspect urgent, ui and loose labels", "Compare files without saving"],
    expected: { noteContent: "Actual note body", noteLabels: ["sec", "audit", "raw"], taskLabels: ["urgent", "ui", "loose"], blankOrNullLabelRendered: false, domainFilesUnchanged: true }
  },
  {
    name: "buildReadSnapshot exposes all todo and note items instead of truncating at default limit",
    caseId: "read-all-list-items",
    fixture: "six-todos-six-notes",
    journey: ["Navigate all six Todo rows", "Navigate all six Notes rows and inspect the last note content", "Collect items from actual visible scrolled frames"],
    expected: { todoTitles: ["Task 1", "Task 2", "Task 3", "Task 4", "Task 5", "Task 6"], noteTitles: ["Note 1", "Note 2", "Note 3", "Note 4", "Note 5", "Note 6"], lastNoteContent: "Body 6", hiddenByArtificialLimit: false, domainFilesUnchanged: true }
  },
  {
    name: "buildReadSnapshot exposes board descriptions and default column metadata for Board management UI",
    caseId: "read-board-management-metadata",
    fixture: "launch-default-doing",
    journey: ["Open Manage boards and inspect Launch board Ship flow and Ops board Ops flow", "Inspect Backlog and Doing default state and Doing WIP 2", "Add a card without selecting an explicit destination"],
    expected: { boardDescriptions: ["Ship flow", "Ops flow"], backlogIsDefault: false, doingIsDefault: true, doingWip: 2, addedCardColumnTitle: "Doing" }
  },
  {
    name: "buildReadSnapshot preserves null current ids when source records have no stable ids",
    caseId: "read-legacy-missing-ids",
    fixture: "legacy-records-without-stable-ids",
    journey: ["Read Imported todos, Imported notes and Imported board", "Inspect Recovered task, Recovered note and Recovered card", "Try selecting missing-id records without permitting accidental writes or a fabricated replacement id"],
    expected: { todoListTitle: "Imported todos", noteListTitle: "Imported notes", boardTitle: "Imported board", todoTitles: ["Recovered task"], noteTitles: ["Recovered note"], boardCardTitles: ["Recovered card"], fabricatedIdWritten: false, domainFilesUnchanged: true }
  },
  {
    name: "buildReadSnapshot exposes all clocks for Clocks page management without footer truncation markers",
    caseId: "read-all-clocks",
    fixture: "six-utc-clocks",
    journey: ["Open Clocks", "Navigate all six named clocks", "Open details for Clock 6", "Verify the sixth clock can be managed without modifying data"],
    expected: { clockNames: ["Clock 1", "Clock 2", "Clock 3", "Clock 4", "Clock 5", "Clock 6"], lastOpenedClock: "Clock 6", hiddenByArtificialLimit: false, domainFilesUnchanged: true }
  }
];

for (const entry of cases) {
  test(entry.name, async context => {
    const result = await captureIluScenario({ testName: context.name, scenario: "adapterBehavior", command: ["node", "bin/cli.js", "ui"], input: { area: "read-model", caseId: entry.caseId, fixture: entry.fixture, journey: entry.journey }, viewport: { cols: 120, rows: 40 } });
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
    assertCaptureArtifacts({ result, testName: context.name, checkpoints: ["condition", "outcome"], diagnostic: message => context.diagnostic(message) });
  });
}
