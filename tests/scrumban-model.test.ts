import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import loadDb from "../utils/load-db.ts";
import { withTempHome } from "../support/home-sandbox.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const cases = [
  { name: "scrumban model creates boards with default columns and current selection", kind: "create-default" },
  { name: "scrumban model creates boards with custom columns and defaultColumnId", kind: "create-custom" },
  { name: "scrumban model does not persist a board when defaultColumnId is invalid", kind: "invalid-default" },
  {
    name: "scrumban model adds cards to the board default column when no column is provided",
    kind: "add-default",
    custom: true
  },
  { name: "scrumban model renames columns without changing ids or defaultColumnId", kind: "rename" },
  { name: "scrumban model reorders columns while preserving ids", kind: "reorder-columns" },
  {
    name: "scrumban model rejects removing a column that still has cards",
    kind: "protected-nonempty",
    cards: [[], ["Write docs"], [], []]
  },
  {
    name: "scrumban model rejects removing the default column until another default is assigned",
    kind: "protected-default"
  },
  {
    name: "scrumban model resets the simple default columns with a consistent defaultColumnId",
    kind: "reset",
    custom: true
  },
  { name: "scrumban model rejects invalid WIP limits when editing columns", kind: "invalid-wip" },
  {
    name: "scrumban model rejects invalid WIP limits when creating boards with custom columns",
    kind: "invalid-create-wip",
    custom: true
  },
  { name: "scrumban model rejects invalid WIP limits when adding columns", kind: "invalid-add-wip" },
  {
    name: "scrumban model rejects invalid column positions without persisting a no-op success",
    kind: "invalid-column"
  },
  {
    name: "scrumban model rejects invalid card positions without mutating cards",
    kind: "invalid-card",
    cards: [["One"], [], [], []]
  },
  {
    name: "scrumban model moves cards forward and auto-pulls earlier columns while capacity allows",
    kind: "single-move",
    cards: [["One", "Two", "Three"], [], [], []],
    target: "In Progress",
    limit: 2,
    expected: [["Three"], ["Two"], ["One"], []]
  },
  {
    name: "scrumban model moveMany moves selected cards without auto-pulling unselected cards",
    kind: "batch",
    cards: [["A", "B", "C"], [], [], []],
    selected: [0, 2],
    target: "In Progress",
    expected: [["B"], [], ["A", "C"], []]
  },
  {
    name: "scrumban model moveMany ignores duplicate selections for the same original card",
    kind: "duplicate-selection",
    cards: [["A", "B"], [], [], []],
    target: "Ready",
    expected: [["B"], ["A"], [], []]
  },
  {
    name: "scrumban model moveMany validates destination WIP before mutating",
    kind: "batch-full",
    cards: [["A", "B"], ["Existing"], [], []],
    selected: [0, 1],
    target: "Ready",
    limit: 2
  },
  {
    name: "scrumban model moveMany rechaza selecciones inválidas sin persistir ni notificar sync",
    kind: "invalid-batch",
    cards: [["A", "B"], [], [], []]
  },
  {
    name: "scrumban model keeps auto-pull based on visual column order after reorder",
    kind: "visual-order",
    cards: [["One", "Two"], ["Three"], [], []],
    target: "Done",
    expected: [[], ["Two"], ["Three"], ["One"]]
  },
  {
    name: "scrumban model stops the auto-pull chain when an intermediate column is full",
    kind: "single-move",
    cards: [["One", "Three"], ["Two"], [], []],
    target: "In Progress",
    limit: 1,
    expected: [["Three"], ["Two"], ["One"], []]
  },
  {
    name: "scrumban model rejects moving a card into a column that is already at its WIP limit",
    kind: "single-full",
    cards: [["One"], ["Two"], [], []],
    target: "Ready",
    limit: 1
  }
];

for (const entry of cases) {
  test(entry.name, { concurrency: false }, async (context) => {
    await withTempHome(
      async (home) => {
        const bin = path.resolve(import.meta.dirname, "..", "bin/cli.js");
        const file = path.join(home, ".ilu", "boards.json");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const titles = entry.custom
          ? ["Triage", "Queued", "Ship"]
          : entry.kind === "visual-order"
            ? ["Ready", "Backlog", "In Progress", "Done"]
            : ["Backlog", "Ready", "In Progress", "Done"];
        const columns = titles.map((title, index) => ({
          id: title.toLowerCase().replaceAll(" ", "-"),
          title,
          index: index + 1,
          wipLimit: index === 1 ? (entry.limit ?? null) : null,
          cards: (entry.cards?.[index] ?? []).map((title, position) => ({
            title,
            description: `Details ${title}`,
            position: position + 1
          }))
        }));
        const board = {
          index: 1,
          current: true,
          title: "Product",
          description: "Delivery",
          defaultColumnId: entry.custom ? "queued" : "backlog",
          columns
        };
        const creating = entry.kind === "create-default" || entry.kind === "create-custom";
        if (!creating && entry.kind !== "invalid-create-wip") {
          loadDb("boards").getCollection("boards").add(board);
        }
        const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
        const steps: Array<Record<string, unknown>> = [];
        let command = ["env", `HOME=${home}`, "node", bin, "board", "--columns"];
        let expectedExit = 0;
        let unchanged = false;
        const selectColumnAction = (column: string, action: string, ids: string[]) => {
          steps.push(
            { waitFor: "Select a column to manage" },
            { type: column },
            { press: "ENTER" },
            { waitFor: "What do you want to do" },
            { checkpoint: `menu-${steps.length}` }
          );
          for (let index = 0; index < ids.indexOf(action); index++) {
            steps.push({ press: "DOWN" });
          }
          steps.push({ press: "ENTER" });
        };
        if (creating || entry.kind === "invalid-default") {
          const count = entry.kind === "create-default" ? 2 : 1;
          const create = 'node "$1" board --add-board';
          command = [
            "env",
            `HOME=${home}`,
            "sh",
            "-c",
            Array.from({ length: count }, () => create).join(" && ") +
              (entry.kind === "create-custom" ? ' && node "$1" board --columns' : ""),
            "ilu-capture",
            bin
          ];
          for (let index = 0; index < count; index++) {
            steps.push(
              { waitFor: "Title of the board" },
              { type: index === 1 ? " Ops " : " Product " },
              { press: "ENTER" },
              { waitFor: "Description of the board" },
              { type: index === 1 ? "" : " Delivery " },
              { press: "ENTER" },
              { waitFor: "Initial columns" }
            );
            if (entry.kind !== "create-default") {
              steps.push({ press: "CTRL_A" }, { type: "Triage, Queued, Ship" });
            }
            steps.push({ press: "ENTER" }, { waitFor: "Default column for new cards" });
            if (entry.kind === "invalid-default") {
              steps.push(
                { type: "Missing column 999" },
                { waitFor: "No matching", flags: "i" },
                { checkpoint: "invalid-default" },
                { press: "ESCAPE" }
              );
              expectedExit = 1;
              unchanged = true;
            } else {
              if (entry.kind === "create-custom") {
                steps.push({ type: "Queued" });
              }
              steps.push({ checkpoint: `default-${index}` }, { press: "ENTER" });
            }
          }
          if (entry.kind === "create-custom") {
            selectColumnAction("Queued", "set-wip", ["rename", "set-wip", "move-left", "move-right", "cancel"]);
            steps.push({ waitFor: "WIP limit" }, { press: "CTRL_A" }, { type: "2" }, { press: "ENTER" });
          }
        } else if (entry.kind === "add-default") {
          command = ["env", `HOME=${home}`, "node", bin, "board", "--add"];
          steps.push(
            { waitFor: "Title of the card" },
            { type: "Write docs" },
            { press: "ENTER" },
            { waitFor: "Description of the card" },
            { type: "v1" },
            { checkpoint: "default-card" },
            { press: "ENTER" }
          );
        } else if (entry.kind === "rename") {
          selectColumnAction("Ready", "rename", [
            "rename",
            "set-wip",
            "make-default",
            "move-left",
            "move-right",
            "remove",
            "cancel"
          ]);
          steps.push({ waitFor: "Column title" }, { press: "CTRL_A" }, { type: "Next Up" }, { press: "ENTER" });
        } else if (entry.kind === "reorder-columns") {
          command = [
            "env",
            `HOME=${home}`,
            "sh",
            "-c",
            'node "$1" board --columns && node "$1" board --columns',
            "ilu-capture",
            bin
          ];
          selectColumnAction("Done", "move-left", [
            "rename",
            "set-wip",
            "make-default",
            "move-left",
            "remove",
            "cancel"
          ]);
          selectColumnAction("Done", "move-left", [
            "rename",
            "set-wip",
            "make-default",
            "move-left",
            "move-right",
            "remove",
            "cancel"
          ]);
        } else if (entry.kind.startsWith("protected-")) {
          const column = entry.kind === "protected-default" ? "Backlog" : "Ready";
          const actions =
            entry.kind === "protected-default"
              ? ["rename", "set-wip", "move-right", "cancel"]
              : ["rename", "set-wip", "make-default", "move-left", "move-right", "cancel"];
          selectColumnAction(column, "cancel", actions);
          unchanged = true;
        } else if (entry.kind === "reset") {
          steps.push(
            { waitFor: "Select a column to manage" },
            { type: "Reset to simple default" },
            { checkpoint: "reset-custom" },
            { press: "ENTER" }
          );
        } else if (entry.kind.includes("wip")) {
          // CLI creation/addition does not accept WIP payloads. Configure the
          // newly created/custom column through its public WIP action instead.
          // Public 0 means unlimited, unlike the private model's invalid raw 0.
          const column = entry.kind === "invalid-add-wip" ? "Ready for QA" : entry.custom ? "Queued" : "Ready";
          const invalid = entry.kind === "invalid-wip" ? ["-1", "NaN"] : ["-1"];
          let preparation = "";
          if (entry.kind === "invalid-create-wip") {
            preparation = 'node "$1" board --add-board && ';
            steps.push(
              { waitFor: "Title of the board" },
              { type: "Product" },
              { press: "ENTER" },
              { waitFor: "Description of the board" },
              { type: "Delivery" },
              { press: "ENTER" },
              { waitFor: "Initial columns" },
              { press: "CTRL_A" },
              { type: "Triage, Queued, Ship" },
              { press: "ENTER" },
              { waitFor: "Default column for new cards" },
              { type: "Queued" },
              { press: "ENTER" }
            );
          }
          if (entry.kind === "invalid-add-wip") {
            preparation = 'node "$1" board --columns && ';
            steps.push(
              { waitFor: "Select a column to manage" },
              { type: "Add column" },
              { press: "ENTER" },
              { waitFor: "Column title" },
              { type: "Ready for QA" },
              { press: "ENTER" }
            );
          }
          command = [
            "env",
            `HOME=${home}`,
            "sh",
            "-c",
            preparation +
              invalid.map(() => 'node "$1" board --columns; code=$?; [ "$code" -eq 1 ] || exit 2').join("; "),
            "ilu-capture",
            bin
          ];
          steps.push({ waitFor: "Select a column to manage" }, { checkpoint: "wip-before-invalid", files: [file] });
          for (const value of invalid) {
            selectColumnAction(column, "set-wip", ["rename", "set-wip"]);
            steps.push(
              { waitFor: "WIP limit" },
              { press: "CTRL_A" },
              { type: value },
              { press: "ENTER" },
              { waitFor: "whole|integer|number|minimum|least", flags: "i" },
              { checkpoint: `invalid-wip-${value}` },
              { press: "ESCAPE" }
            );
          }
          unchanged = true;
        } else if (entry.kind === "invalid-column" || entry.kind === "invalid-card") {
          command = [
            "env",
            `HOME=${home}`,
            "node",
            bin,
            "board",
            entry.kind === "invalid-column" ? "--columns" : "--edit"
          ];
          steps.push(
            { waitFor: entry.kind === "invalid-column" ? "Select a column to manage" : "Select a card" },
            { type: "Absent selection 999" },
            { waitFor: "No matching", flags: "i" },
            { checkpoint: "absent-selection" },
            { press: "ESCAPE" }
          );
          expectedExit = 1;
          unchanged = true;
        } else if (
          entry.kind === "batch" ||
          entry.kind === "duplicate-selection" ||
          entry.kind === "batch-full" ||
          entry.kind === "invalid-batch"
        ) {
          command = ["env", `HOME=${home}`, "node", bin, "board", "--move"];
          steps.push(
            { waitFor: "Select cards to move" },
            { checkpoint: "before-selection", observeSync: entry.kind === "invalid-batch" }
          );
          if (entry.kind === "invalid-batch") {
            steps.push(
              { press: "ENTER" },
              { waitFor: "at least one", flags: "i" },
              { checkpoint: "invalid-selection" },
              { press: "ESCAPE" }
            );
            expectedExit = 1;
            unchanged = true;
          } else {
            if (entry.kind === "duplicate-selection") {
              // Repeated activation of the same real choice cannot clone it.
              steps.push({ press: "SPACE" }, { press: "SPACE" }, { press: "SPACE" });
            } else {
              const count = columns.reduce((sum, column) => sum + column.cards.length, 0);
              for (let index = 0; index < count; index++) {
                if (entry.selected.includes(index)) {
                  steps.push({ press: "SPACE" });
                }
                if (index + 1 < count) {
                  steps.push({ press: "DOWN" });
                }
              }
            }
            steps.push(
              { checkpoint: "selected-cards" },
              { press: "ENTER" },
              { waitFor: "Select the destination column" },
              { type: entry.target },
              { press: "ENTER" }
            );
            unchanged = entry.kind === "batch-full";
          }
        } else {
          command = ["env", `HOME=${home}`, "node", bin, "ui"];
          steps.push(
            { clickText: "Board" },
            { clickText: "One" },
            { press: "o" },
            { waitFor: "Details One" },
            { clickText: "Move" },
            { waitFor: 'Move "One" to' },
            { checkpoint: "move-destination" },
            { clickText: entry.target, occurrence: -1 },
            { checkpoint: "moved-card" },
            { press: "ESCAPE" },
            { clickText: "Todo" },
            { press: "CTRL_C" }
          );
          unchanged = entry.kind === "single-full";
        }
        const result = await captureIluScenario({
          testName: context.name,
          command,
          scenario: "cliScript",
          input: {
            steps,
            ...(entry.kind === "invalid-batch"
              ? { syncFixture: { home, files: ["boards.json"], mode: "local-git-observed" } }
              : {})
          },
          viewport: { cols: 140, rows: 46 }
        });
        assert.equal(result.exitCode, expectedExit);
        const savedBoards = JSON.parse(fs.readFileSync(file, "utf8")).collections.boards.data;
        const saved = savedBoards.find((item) => item.current);
        assert.ok(saved);
        if (unchanged) {
          const beforeRejection = entry.kind.includes("wip")
            ? result.fileSnapshots["wip-before-invalid"][file]
            : before;
          assert.equal(fs.readFileSync(file, "utf8"), beforeRejection);
        }
        if (entry.kind === "create-default") {
          assert.deepEqual(
            savedBoards.map((item) => item.title),
            ["Product", "Ops"]
          );
          assert.deepEqual(
            savedBoards.map((item) => item.current),
            [false, true]
          );
          assert.equal(savedBoards[0].description, "Delivery");
          assert.deepEqual(
            saved.columns.map((column) => column.title),
            ["Backlog", "Ready", "In Progress", "Done"]
          );
          assert.equal(saved.defaultColumnId, "backlog");
        }
        if (entry.kind === "create-custom") {
          assert.deepEqual(
            saved.columns.map((column) => column.title),
            ["Triage", "Queued", "Ship"]
          );
          assert.equal(saved.defaultColumnId, "queued");
          assert.equal(saved.columns[1].wipLimit, 2);
          assert.ok(saved.columns.every((column) => column.cards.length === 0));
        }
        if (entry.kind === "add-default") {
          assert.deepEqual(
            saved.columns.map((column) => column.cards.map((card) => card.title)),
            [[], ["Write docs"], []]
          );
          assert.equal(saved.columns[1].cards[0].description, "v1");
          assert.equal(saved.columns[1].cards[0].position, 1);
        }
        if (entry.kind === "rename") {
          assert.deepEqual(
            saved.columns.map((column) => column.id),
            columns.map((column) => column.id)
          );
          assert.equal(saved.columns[1].title, "Next Up");
          assert.equal(saved.defaultColumnId, board.defaultColumnId);
        }
        if (entry.kind === "reorder-columns") {
          assert.deepEqual(
            saved.columns.map((column) => column.id),
            ["backlog", "done", "ready", "in-progress"]
          );
          assert.deepEqual(
            saved.columns.map((column) => column.index),
            [1, 2, 3, 4]
          );
          assert.equal(saved.defaultColumnId, "backlog");
        }
        if (entry.kind.startsWith("protected-")) {
          const menu = Object.entries(result.frames).find(([name]) => name.startsWith("menu-"))[1];
          assert.doesNotMatch(menu, /Remove/);
        }
        if (entry.kind === "reset") {
          assert.deepEqual(
            saved.columns.map((column) => column.id),
            ["backlog", "ready", "in-progress", "done"]
          );
          assert.equal(saved.defaultColumnId, "backlog");
          assert.ok(saved.columns.every((column) => column.cards.length === 0 && column.wipLimit === null));
        }
        if ("expected" in entry) {
          assert.deepEqual(
            saved.columns.map((column) => column.cards.map((card) => card.title)),
            entry.expected
          );
          for (const column of saved.columns) {
            assert.deepEqual(
              column.cards.map((card) => card.position),
              column.cards.map((_card, index) => index + 1)
            );
            for (const card of column.cards) {
              assert.equal(card.description, `Details ${card.title}`);
            }
          }
        }
        if (entry.kind === "visual-order") {
          assert.deepEqual(
            saved.columns.map((column) => column.id),
            ["ready", "backlog", "in-progress", "done"]
          );
        }
        if (entry.kind === "batch-full") {
          assert.match(result.currentScreen, /WIP|cannot move/i);
        }
        if (entry.kind === "single-full") {
          assert.match(result.frames["moved-card"], /WIP|limit|could not be moved/i);
        }
        if (entry.kind === "invalid-batch") {
          assert.equal(result.remoteHead, result.remoteHeads["before-selection"]);
        }
        assertCaptureArtifacts({
          result,
          checkpoints: [
            ...steps.flatMap((step) => (typeof step.checkpoint === "string" ? [step.checkpoint] : [])),
            "cli-result"
          ],
          testName: context.name,
          diagnostic: (message) => context.diagnostic(message)
        });
      },
      { prefix: "ilu-scrumban-model-physical-", testName: context.name }
    );
  });
}
