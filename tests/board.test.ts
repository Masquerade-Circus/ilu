import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withTempHome } from "../support/home-sandbox.ts";
import loadDb from "../utils/load-db.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

// Every original name stays independently registered and owns its own media.
// Calls to stubs become persisted domain results or current physical frames.
const cases = [
  { name: "board --add creates a card in the default column", action: "add" },
  {
    name: "board --move uses multi-select for one card and destination column search",
    action: "move",
    cards: [["Write docs"], [], [], []],
    selected: [0],
    target: 2,
    expected: [[], [], ["Write docs"], []]
  },
  {
    name: "board --move can move several selected cards to the destination column",
    action: "move",
    cards: [["One"], ["Two"], [], []],
    selected: [0, 1],
    target: 2,
    expected: [[], [], ["One", "Two"], []]
  },
  {
    name: "board --move sends several cards from the same column in visual order",
    action: "move",
    cards: [["One", "Two", "Three"], [], [], []],
    selected: [0, 2],
    target: 1,
    expected: [["Two"], ["One", "Three"], [], []]
  },
  {
    name: "board --move delegates one batch move when individual moves would auto-pull unselected cards",
    action: "move",
    cards: [["A", "B", "C"], [], [], []],
    selected: [0, 2],
    target: 2,
    expected: [["B"], [], ["A", "C"], []]
  },
  {
    name: "board --move does not move any selected cards when destination WIP cannot fit all incoming cards",
    action: "move",
    cards: [["One", "Two"], ["Existing"], [], []],
    selected: [0, 1],
    target: 1,
    limit: 2,
    rejected: true
  },
  {
    name: "board --move prevalidates WIP and shows a clear message when destination column already reached its WIP limit",
    action: "move",
    cards: [["Write docs"], ["Review"], [], []],
    selected: [0],
    target: 1,
    limit: 1,
    rejected: true
  },
  {
    name: "board --details uses a searchable card selector",
    action: "details",
    cards: [["Write docs"], ["Fix Login"], [], []],
    search: "Fix Login"
  },
  {
    name: "board --priority selecciona columna primero y reordena dentro de esa misma columna usando prompt custom",
    action: "priority",
    cards: [["One", "Two", "Three"], [], [], []]
  },
  {
    name: "board --priority no abre reorder cuando la columna elegida tiene menos de dos cards",
    action: "priority",
    cards: [["Only"], [], [], []],
    rejected: true
  },
  {
    name: "board --columns empieza seleccionando columna y acciones globales especiales",
    action: "columns",
    columnAction: "menu"
  },
  {
    name: "board --columns allows updating a column WIP limit after selecting a column first",
    action: "columns",
    columnAction: "set-wip",
    value: "3"
  },
  {
    name: "board --columns usa prompt numérico nativo para set-wip",
    action: "columns",
    columnAction: "set-wip",
    value: "5"
  },
  {
    name: "board --columns rechaza WIP decimal desde la validación del prompt",
    action: "columns",
    columnAction: "set-wip",
    value: "1.5",
    invalid: true
  },
  {
    name: "board --columns limpia el WIP cuando set-wip recibe cero",
    action: "columns",
    columnAction: "set-wip",
    value: "0"
  },
  {
    name: "board --columns oculta make default para la columna que ya es default",
    action: "columns",
    columnAction: "default-menu",
    column: 0
  },
  {
    name: "board --columns allows setting a non-default column as default from its action menu",
    action: "columns",
    columnAction: "make-default",
    column: 2
  },
  {
    name: "board --columns allows renaming a column from its action menu",
    action: "columns",
    columnAction: "rename-column",
    value: "Next Up"
  },
  {
    name: "board --columns adds a column from the initial selector special action",
    action: "columns",
    columnAction: "add-column",
    value: "Review"
  },
  {
    name: "board --columns moves a middle column left from its action menu",
    action: "columns",
    columnAction: "move-left",
    column: 2
  },
  {
    name: "board --columns oculta move left para la primera columna y move right para la última",
    action: "columns",
    columnAction: "edge-menus"
  },
  {
    name: "board --columns removes an empty non-default column from its action menu",
    action: "columns",
    columnAction: "remove-column",
    column: 2
  },
  {
    name: "board --columns oculta remove cuando la columna es default o tiene cards",
    action: "columns",
    columnAction: "protected-menus",
    cards: [[], ["Two"], [], []]
  },
  {
    name: "board --columns resets to simple default from the initial selector special action when the board has no cards",
    action: "columns",
    columnAction: "reset-simple-default",
    custom: true
  },
  {
    name: "board --columns no resetea a simple default cuando el board sí tiene cards",
    action: "columns",
    columnAction: "reset-simple-default",
    cards: [["One"], [], [], []],
    rejected: true
  },
  { name: "board --columns cancel returns without changing columns", action: "columns", columnAction: "cancel" },
  {
    name: "board --details usa selección interactiva de card y muestra su contenido",
    action: "details",
    cards: [["Write docs"], [], [], []],
    search: "Write docs"
  },
  {
    name: "board --edit usa selección interactiva de card y guarda cambios",
    action: "edit",
    cards: [["Write docs"], [], [], []]
  },
  {
    name: "board --remove usa selección interactiva múltiple de cards",
    action: "remove",
    cards: [["One", "Two"], ["Three"], [], []],
    selected: [1, 2]
  },
  {
    name: "board --show no limpia la terminal antes de renderizar el board renderer y no pide acciones posteriores",
    action: "show"
  },
  { name: "board actions enruta gestión de boards a BoardLists con las nuevas flags públicas", action: "management" }
];

for (const entry of cases) {
  test(entry.name, { concurrency: false }, async (context) => {
    await withTempHome(
      async (home) => {
        const file = path.join(home, ".ilu", "boards.json");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const titles = entry.custom ? ["Triage", "Ready", "Ship"] : ["Backlog", "Ready", "In Progress", "Done"];
        const columns = titles.map((title, index) => ({
          id: title.toLowerCase().replaceAll(" ", "-"),
          title,
          index: index + 1,
          wipLimit: index === 1 ? (entry.limit ?? 2) : null,
          cards: (entry.cards?.[index] ?? []).map((card, position) => ({
            title: card,
            description: `Details ${card}`,
            position: position + 1
          }))
        }));
        const board = {
          $id: 1,
          index: 1,
          current: true,
          title: "Product",
          description: "Delivery flow",
          defaultColumnId: entry.action === "add" || entry.custom ? "ready" : "backlog",
          columns
        };
        loadDb("boards").getCollection("boards").add(board);
        const before = fs.readFileSync(file, "utf8");
        const steps: Record<string, string>[] = [];
        const args = ["board", ...(entry.action === "show" ? [] : [`--${entry.action}`])];
        let command = ["env", `HOME=${home}`, "node", path.resolve(import.meta.dirname, "..", "bin/cli.js"), ...args];
        let noWrite = false;

        if (entry.action === "add") {
          steps.push(
            { waitFor: "Title of the card" },
            { type: "Write docs" },
            { press: "ENTER" },
            { waitFor: "Description of the card" },
            { type: "v1" },
            { checkpoint: "card-draft" },
            { press: "ENTER" }
          );
        }
        if (entry.action === "move" || entry.action === "remove") {
          steps.push({ waitFor: entry.action === "move" ? "Select cards to move" : "Select cards to remove" });
          const count = columns.reduce((sum, column) => sum + column.cards.length, 0);
          for (let index = 0; index < count; index++) {
            if (entry.selected.includes(index)) {
              steps.push({ press: "SPACE" });
            }
            if (index + 1 < count) {
              steps.push({ press: "DOWN" });
            }
          }
          steps.push({ checkpoint: "selected-cards" }, { press: "ENTER" });
          if (entry.action === "move") {
            steps.push(
              { waitFor: "Select the destination column" },
              { type: titles[entry.target] },
              { checkpoint: "destination" },
              { press: "ENTER" }
            );
          }
          noWrite = entry.rejected === true;
        }
        if (entry.action === "details" || entry.action === "edit") {
          steps.push(
            { waitFor: "Select a card" },
            { type: entry.search ?? "Write docs" },
            { checkpoint: "filtered-cards" },
            { press: "ENTER" }
          );
          if (entry.action === "edit") {
            steps.push(
              { waitFor: "Title of the card" },
              { press: "CTRL_A" },
              { type: "Review docs" },
              { press: "ENTER" },
              { waitFor: "Description of the card" },
              { press: "CTRL_A" },
              { type: "v2" },
              { checkpoint: "edited-card" },
              { press: "ENTER" }
            );
          } else {
            noWrite = true;
          }
        }
        if (entry.action === "priority") {
          steps.push({ waitFor: "Select the column to reorder" }, { type: "Backlog" }, { press: "ENTER" });
          if (!entry.rejected) {
            steps.push(
              { waitFor: "Select the card to move" },
              { type: "One" },
              { press: "ENTER" },
              { waitFor: "to position" },
              { press: "CTRL_A" },
              { type: "2" },
              { checkpoint: "priority" },
              { press: "ENTER" }
            );
          } else {
            noWrite = true;
          }
        }
        if (entry.action === "columns") {
          const kind = entry.columnAction;
          if (kind === "menu" || kind === "cancel" || kind === "add-column" || kind === "reset-simple-default") {
            steps.push(
              { waitFor: "Select a column to manage" },
              { checkpoint: "column-menu" },
              {
                type:
                  kind === "add-column"
                    ? "Add column"
                    : kind === "reset-simple-default"
                      ? "Reset to simple default"
                      : "Cancel"
              },
              { press: "ENTER" }
            );
            if (kind === "add-column") {
              steps.push({ waitFor: "Column title" }, { type: entry.value }, { press: "ENTER" });
            }
            noWrite = kind === "menu" || kind === "cancel" || entry.rejected === true;
          } else {
            const targets =
              kind === "edge-menus"
                ? [0, columns.length - 1]
                : kind === "protected-menus"
                  ? [0, 1]
                  : [entry.column ?? 1];
            // Two independent CLI invocations share this test's physical terminal
            // and recording. Each menu is observed before selecting Cancel.
            if (targets.length === 2) {
              command = [
                "env",
                `HOME=${home}`,
                "sh",
                "-c",
                'node "$1" board --columns && node "$1" board --columns',
                "ilu-capture",
                path.resolve(import.meta.dirname, "..", "bin/cli.js")
              ];
            }
            for (const target of targets) {
              steps.push(
                { waitFor: "Select a column to manage" },
                { type: titles[target] },
                { press: "ENTER" },
                { waitFor: "What do you want to do" },
                { checkpoint: `actions-${target}` }
              );
              const actions = ["rename-column", "set-wip"];
              if (columns[target].id !== board.defaultColumnId) {
                actions.push("make-default");
              }
              if (target > 0) {
                actions.push("move-left");
              }
              if (target + 1 < columns.length) {
                actions.push("move-right");
              }
              if (columns[target].cards.length === 0 && columns[target].id !== board.defaultColumnId) {
                actions.push("remove-column");
              }
              actions.push("cancel");
              const selected = ["default-menu", "edge-menus", "protected-menus"].includes(kind) ? "cancel" : kind;
              for (let index = 0; index < actions.indexOf(selected); index++) {
                steps.push({ press: "DOWN" });
              }
              steps.push({ press: "ENTER" });
              if (kind === "set-wip" || kind === "rename-column") {
                steps.push(
                  { waitFor: kind === "set-wip" ? "WIP limit" : "Column title" },
                  { press: "CTRL_A" },
                  { type: entry.value },
                  { press: "ENTER" }
                );
                if (entry.invalid) {
                  steps.push(
                    { waitFor: "whole|integer", flags: "i" },
                    { checkpoint: "invalid-wip" },
                    { press: "ESCAPE" }
                  );
                }
              }
            }
            noWrite = ["default-menu", "edge-menus", "protected-menus"].includes(kind) || entry.invalid === true;
          }
        }
        if (entry.action === "show") {
          command = [
            "env",
            `HOME=${home}`,
            "sh",
            "-c",
            'printf "Preexisting terminal content\\n"; exec node "$1" board',
            "ilu-capture",
            path.resolve(import.meta.dirname, "..", "bin/cli.js")
          ];
          noWrite = true;
        }
        if (entry.action === "management") {
          command = [
            "env",
            `HOME=${home}`,
            "sh",
            "-c",
            'node "$1" board --list-boards && node "$1" board --add-board && node "$1" board --use-board && node "$1" board --edit-board && node "$1" board --remove-board',
            "ilu-capture",
            path.resolve(import.meta.dirname, "..", "bin/cli.js")
          ];
          steps.push(
            { waitFor: "Title of the board" },
            { type: "Ops" },
            { press: "ENTER" },
            { waitFor: "Description of the board" },
            { type: "Operations" },
            { press: "ENTER" },
            { waitFor: "Initial columns" },
            { press: "ENTER" },
            { waitFor: "Default column" },
            { press: "ENTER" },
            { waitFor: "Select the board to use" },
            { type: "Product" },
            { checkpoint: "management-use" },
            { press: "ENTER" },
            { waitFor: "Select the board to edit" },
            { type: "Ops" },
            { press: "ENTER" },
            { waitFor: "Title of the board" },
            { press: "CTRL_A" },
            { type: "Ops updated" },
            { press: "ENTER" },
            { waitFor: "Description of the board" },
            { press: "ENTER" },
            { waitFor: "Select the boards to remove" },
            { press: "DOWN" },
            { press: "SPACE" },
            { checkpoint: "management-remove" },
            { press: "ENTER" }
          );
        }

        const result = await captureIluScenario({
          testName: context.name,
          command,
          scenario: "cliScript",
          input: { steps },
          viewport: { cols: 120, rows: 42 }
        });
        assert.equal(result.exitCode, entry.invalid ? 1 : 0);
        const savedBoards = JSON.parse(fs.readFileSync(file, "utf8")).collections.boards.data;
        const saved = savedBoards.find((item) => item.title === "Product");
        assert.ok(saved);
        if (noWrite) {
          assert.equal(
            fs.readFileSync(file, "utf8"),
            before,
            "a read, cancelled menu or rejected operation must not write"
          );
        }
        if (entry.action === "add") {
          assert.deepEqual(
            saved.columns.map((column) => column.cards.map((card) => card.title)),
            [[], ["Write docs"], [], []]
          );
          assert.equal(saved.columns[1].cards[0].description, "v1");
        }
        if (entry.action === "move" && !entry.rejected) {
          assert.deepEqual(
            saved.columns.map((column) => column.cards.map((card) => card.title)),
            entry.expected
          );
          for (const card of saved.columns.flatMap((column) => column.cards)) {
            assert.equal(card.description, `Details ${card.title}`);
          }
        }
        if (entry.rejected && entry.action === "move") {
          assert.match(result.currentScreen, /WIP|cannot move/i);
        }
        if (entry.action === "details") {
          assert.match(result.currentScreen, new RegExp(`Details ${entry.search}`));
          assert.match(result.frames["filtered-cards"], new RegExp(entry.search));
        }
        if (entry.action === "edit") {
          assert.equal(saved.columns[0].cards[0].title, "Review docs");
          assert.equal(saved.columns[0].cards[0].description, "v2");
        }
        if (entry.action === "remove") {
          assert.deepEqual(
            saved.columns.map((column) => column.cards.map((card) => card.title)),
            [["One"], [], [], []]
          );
        }
        if (entry.action === "priority" && !entry.rejected) {
          assert.deepEqual(
            saved.columns[0].cards.map((card) => card.title),
            ["Two", "One", "Three"]
          );
          assert.ok(saved.columns.slice(1).every((column) => column.cards.length === 0));
        }
        if (entry.action === "priority" && entry.rejected) {
          assert.match(result.currentScreen, /fewer than two|nothing to change/i);
        }
        if (entry.action === "columns") {
          const kind = entry.columnAction;
          if (kind === "menu") {
            for (const label of [...titles, "Add column", "Reset to simple default", "Cancel"]) {
              assert.ok(result.frames["column-menu"].includes(label));
            }
          }
          if (kind === "set-wip" && !entry.invalid) {
            assert.equal(saved.columns[1].wipLimit, entry.value === "0" ? null : Number(entry.value));
          }
          if (kind === "make-default") {
            assert.equal(saved.defaultColumnId, columns[entry.column].id);
          }
          if (kind === "rename-column") {
            assert.equal(saved.columns[1].title, "Next Up");
            assert.equal(saved.columns[1].id, columns[1].id);
            assert.equal(saved.defaultColumnId, board.defaultColumnId);
          }
          if (kind === "add-column") {
            assert.deepEqual(
              saved.columns.map((column) => column.title),
              [...titles, "Review"]
            );
          }
          if (kind === "move-left") {
            assert.deepEqual(
              saved.columns.map((column) => column.id),
              ["backlog", "in-progress", "ready", "done"]
            );
            assert.equal(saved.defaultColumnId, board.defaultColumnId);
          }
          if (kind === "remove-column") {
            assert.deepEqual(
              saved.columns.map((column) => column.id),
              ["backlog", "ready", "done"]
            );
          }
          if (kind === "default-menu") {
            assert.doesNotMatch(result.frames["actions-0"], /Make default/);
          }
          if (kind === "edge-menus") {
            assert.doesNotMatch(result.frames["actions-0"], /Move left/);
            assert.doesNotMatch(result.frames["actions-3"], /Move right/);
          }
          if (kind === "protected-menus") {
            assert.doesNotMatch(result.frames["actions-0"], /Remove/);
            assert.doesNotMatch(result.frames["actions-1"], /Remove/);
          }
          if (kind === "reset-simple-default" && !entry.rejected) {
            assert.deepEqual(
              saved.columns.map((column) => column.title),
              ["Backlog", "Ready", "In Progress", "Done"]
            );
            assert.equal(saved.defaultColumnId, "backlog");
            assert.ok(saved.columns.every((column) => column.cards.length === 0 && column.wipLimit === null));
          }
          if (kind === "reset-simple-default" && entry.rejected) {
            assert.match(result.currentScreen, /cannot reset/i);
          }
        }
        if (entry.action === "show") {
          assert.match(result.currentScreen, /Preexisting terminal content/);
          for (const title of ["Product", ...titles]) {
            assert.ok(result.currentScreen.includes(title));
          }
          assert.doesNotMatch(result.currentScreen, /Select a card|What do you want/);
        }
        if (entry.action === "management") {
          assert.equal(savedBoards.length, 1);
          assert.equal(saved.current, true);
          assert.match(result.frames["management-remove"], /Ops updated/);
          assert.match(result.frames["management-use"], /Product/);
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
      { prefix: "ilu-board-physical-", testName: context.name }
    );
  });
}
