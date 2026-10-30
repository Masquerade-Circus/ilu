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
    name: "priority prompt construye choices desde la columna completa",
    count: 3,
    source: "Three",
    destination: "3",
    expected: ["One", "Two", "Three"],
    choices: true
  },
  { name: "priority prompt rechaza columnas con menos de dos cards", count: 1, expected: ["One"], unavailable: true },
  {
    name: "priority prompt usa prompts nativos para elegir origen y destino",
    count: 3,
    source: "Three",
    destination: "1",
    expected: ["Three", "One", "Two"]
  },
  {
    name: "priority prompt rechaza destino decimal desde la validación del prompt",
    count: 2,
    source: "One",
    destination: "1.5",
    expected: ["One", "Two"],
    invalid: true
  },
  {
    name: "priority prompt devuelve null cuando origen y destino coinciden",
    count: 2,
    source: "One",
    destination: "1",
    expected: ["One", "Two"],
    noChange: true
  },
  {
    name: "priority prompt rechaza destino fuera de rango antes de devolver movimiento",
    count: 2,
    source: "One",
    destination: "9",
    expected: ["One", "Two"],
    invalid: true
  }
];

for (const entry of cases) {
  test(entry.name, { concurrency: false }, async (context) => {
    await withTempHome(
      async (home) => {
        const file = path.join(home, ".ilu", "boards.json");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const columns = [
          {
            id: "backlog",
            title: "Backlog",
            index: 1,
            wipLimit: null,
            cards: [{ title: "Unrelated", description: "", position: 1 }]
          },
          {
            id: "ready",
            title: "Ready",
            index: 2,
            wipLimit: null,
            cards: ["One", "Two", "Three"]
              .slice(0, entry.count)
              .map((title, index) => ({ title, description: `Details ${title}`, position: index + 1 }))
          }
        ];
        loadDb("boards")
          .getCollection("boards")
          .add({ index: 1, current: true, title: "Product", description: "", defaultColumnId: "backlog", columns });
        const before = fs.readFileSync(file, "utf8");
        const steps: Record<string, string>[] = [
          { waitFor: "Select the column to reorder" },
          { type: "Ready" },
          { press: "ENTER" }
        ];
        if (!entry.unavailable) {
          steps.push(
            { waitFor: "Select the card to move" },
            { checkpoint: "card-choices" },
            { type: entry.source },
            { press: "ENTER" },
            { waitFor: "to position" },
            { press: "CTRL_A" },
            { type: entry.destination },
            { press: "ENTER" }
          );
          if (entry.invalid) {
            steps.push(
              { waitFor: "whole|integer|between|valid|maximum|at most", flags: "i" },
              { checkpoint: "rejected-position" },
              { press: "CTRL_C" }
            );
          }
        }
        const result = await captureIluScenario({
          testName: context.name,
          command: [
            "env",
            `HOME=${home}`,
            "node",
            path.resolve(import.meta.dirname, "..", "bin/cli.js"),
            "board",
            "--priority"
          ],
          scenario: "cliScript",
          input: { steps },
          viewport: { cols: 110, rows: 34 }
        });
        assert.equal(result.exitCode, entry.invalid ? 1 : 0);
        const saved = JSON.parse(fs.readFileSync(file, "utf8")).collections.boards.data[0];
        assert.deepEqual(
          saved.columns[1].cards.map((card) => card.title),
          entry.expected
        );
        assert.deepEqual(
          saved.columns[0].cards.map((card) => card.title),
          ["Unrelated"]
        );
        assert.deepEqual(
          saved.columns[1].cards.map((card) => card.description),
          entry.expected.map((title) => `Details ${title}`)
        );
        if (entry.invalid || entry.unavailable || entry.noChange) {
          assert.equal(
            fs.readFileSync(file, "utf8"),
            before,
            "rejection or same-position confirmation must not persist a move"
          );
        }
        if (entry.choices) {
          for (const title of ["One", "Two", "Three"]) {
            assert.ok(result.frames["card-choices"].includes(title));
          }
        }
        if (entry.unavailable) {
          assert.match(result.currentScreen, /fewer than two|nothing to change/i);
          assert.doesNotMatch(result.currentScreen, /to position/);
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
      { prefix: "ilu-board-priority-physical-", testName: context.name }
    );
  });
}
