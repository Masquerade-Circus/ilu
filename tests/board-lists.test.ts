import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withTempHome } from "../support/home-sandbox.ts";
import loadDb from "../utils/load-db.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const cases = [
  {
    name: "board-list --add crea un board con set simple default aceptado rápidamente",
    args: ["--add-board"],
    steps: [
      { waitFor: "Title of the board" },
      { type: "Product" },
      { press: "ENTER" },
      { waitFor: "Description of the board" },
      { type: "Delivery flow" },
      { press: "ENTER" },
      { waitFor: "Initial columns" },
      { press: "ENTER" },
      { waitFor: "Default column for new cards" },
      { checkpoint: "default-columns" },
      { press: "ENTER" }
    ],
    action: "add"
  },
  // BoardLists.details has no public CLI flag. Its user intent is inspected
  // through the real board selector and details overlay, not a private call.
  {
    name: "board-list --details usa selección interactiva como única vía",
    args: [],
    steps: [
      { clickText: "Board" },
      { waitFor: "Backlog" },
      { checkpoint: "board-columns" },
      { doubleClickText: "Product" },
      { waitFor: "Delivery" },
      { checkpoint: "board-details" },
      { press: "ESCAPE" },
      { clickText: "Todo" },
      { press: "CTRL_C" }
    ],
    action: "details"
  },
  {
    name: "board-list --edit usa selección interactiva como única vía",
    args: ["--edit-board"],
    steps: [
      { waitFor: "Select the board to edit" },
      { type: "Product" },
      { checkpoint: "board-selection" },
      { press: "ENTER" },
      { waitFor: "Title of the board" },
      { press: "CTRL_A" },
      { type: "Product 2" },
      { press: "ENTER" },
      { waitFor: "Description of the board" },
      { press: "CTRL_A" },
      { type: "Updated" },
      { press: "ENTER" }
    ],
    action: "edit"
  },
  {
    name: "board-list --use usa selección interactiva como única vía",
    args: ["--use-board"],
    steps: [
      { waitFor: "Select the board to use" },
      { type: "Product" },
      { checkpoint: "board-selection" },
      { press: "ENTER" }
    ],
    action: "use"
  },
  {
    name: "board-list --remove usa selección interactiva como única vía",
    args: ["--remove-board"],
    steps: [
      { waitFor: "Select the boards to remove" },
      { press: "SPACE" },
      { press: "DOWN" },
      { press: "DOWN" },
      { press: "SPACE" },
      { checkpoint: "board-selection" },
      { press: "ENTER" }
    ],
    action: "remove"
  }
];

for (const entry of cases) {
  test(entry.name, { concurrency: false }, async (context) => {
    await withTempHome(
      async (home) => {
        const file = path.join(home, ".ilu", "boards.json");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const columns = ["Backlog", "Ready", "In Progress", "Done"].map((title, index) => ({
          id: title.toLowerCase().replaceAll(" ", "-"),
          title,
          index: index + 1,
          cards: [],
          wipLimit: null
        }));
        const boards = ["Inbox", "Product", "Ops"].map((title, index) => ({
          $id: index + 1,
          index: index + 1,
          current: index === (entry.action === "details" ? 1 : 0),
          title,
          description: title === "Product" ? "Delivery" : "Base",
          defaultColumnId: "backlog",
          columns
        }));
        const collection = loadDb("boards").getCollection("boards");
        if (entry.action !== "add") {
          for (const board of boards) {
            collection.add(board);
          }
        }
        const result = await captureIluScenario({
          testName: context.name,
          command: [
            "env",
            `HOME=${home}`,
            "node",
            path.resolve(import.meta.dirname, "..", "bin/cli.js"),
            entry.action === "details" ? "ui" : "board",
            ...entry.args
          ],
          scenario: "cliScript",
          input: { steps: entry.steps },
          viewport: { cols: 110, rows: 36 }
        });
        assert.equal(result.exitCode, 0);
        const saved = JSON.parse(fs.readFileSync(file, "utf8")).collections.boards.data;
        if (entry.action === "add") {
          assert.equal(saved.length, 1);
          assert.equal(saved[0].title, "Product");
          assert.equal(saved[0].description, "Delivery flow");
          assert.deepEqual(
            saved[0].columns.map((column) => column.title),
            columns.map((column) => column.title)
          );
          assert.equal(saved[0].defaultColumnId, saved[0].columns[0].id);
          assert.ok(saved[0].columns.every((column) => column.cards.length === 0));
        }
        if (entry.action === "edit") {
          assert.deepEqual(
            saved.map((board) => board.title),
            ["Inbox", "Product 2", "Ops"]
          );
          assert.equal(saved[1].description, "Updated");
        }
        if (entry.action === "use") {
          assert.deepEqual(
            saved.filter((board) => board.current).map((board) => board.title),
            ["Product"]
          );
          assert.deepEqual(
            saved.map((board) => board.title),
            ["Inbox", "Product", "Ops"]
          );
        }
        if (entry.action === "remove") {
          assert.deepEqual(
            saved.map((board) => board.title),
            ["Product"]
          );
          assert.equal(saved[0].current, true);
          assert.equal(saved[0].index, 1);
        }
        if (entry.action === "details") {
          assert.deepEqual(
            saved.map((board) => ({
              title: board.title,
              description: board.description,
              current: board.current,
              columns: board.columns
            })),
            boards.map((board) => ({
              title: board.title,
              description: board.description,
              current: board.current,
              columns: board.columns
            }))
          );
          assert.match(result.frames["board-details"], /Product/);
          assert.match(result.frames["board-details"], /Delivery/);
          assert.match(result.frames["board-columns"], /Backlog/);
        }
        assertCaptureArtifacts({
          result,
          checkpoints: [
            ...entry.steps.flatMap((step) => ("checkpoint" in step ? [step.checkpoint] : [])),
            "cli-result"
          ],
          testName: context.name,
          diagnostic: (message) => context.diagnostic(message)
        });
      },
      { prefix: "ilu-board-lists-physical-", testName: context.name }
    );
  });
}
