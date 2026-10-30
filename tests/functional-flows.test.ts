import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { assertRepoTempHome, withTempHome } from "../support/home-sandbox.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";
const repoRoot = path.resolve(import.meta.dirname, "..");

test("runner funcional rechaza HOME real antes de escribir datos", async (context) => {
  // The same guard used by the old runner rejects before any launch. Never
  // start a child with real HOME just to film a harness exception.
  assert.throws(
    () => assertRepoTempHome(os.userInfo().homedir, "Functional flow HOME"),
    /must not point to the real home directory/
  );
  await withTempHome(
    async (home) => {
      assert.equal(assertRepoTempHome(home), home);
      const result = await captureIluScenario({
        testName: context.name,
        command: ["env", `HOME=${home}`, "node", path.join(repoRoot, "bin/cli.js"), "todo", "--add-list"],
        scenario: "cliScript",
        input: {
          steps: [
            { waitFor: "Title of the list" },
            { type: "Isolated flow" },
            { press: "ENTER" },
            { waitFor: "Description of the list" },
            { checkpoint: "safe-home" },
            { press: "ENTER" }
          ]
        },
        viewport: { cols: 110, rows: 32 }
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.currentScreen, /Isolated flow/);
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(home, ".ilu", "todos.json"), "utf8")).collections.todos.data[0].title,
        "Isolated flow"
      );
      assertCaptureArtifacts({
        result,
        checkpoints: ["safe-home", "cli-result"],
        testName: context.name,
        diagnostic: (message) => context.diagnostic(message)
      });
    },
    { prefix: "ilu-functional-home-physical-", testName: context.name }
  );
});

const flows = [
  { name: "flujo funcional base de todo agrega lista y tarea en HOME temporal", domain: "todo" },
  { name: "flujo funcional base de note agrega lista y nota en HOME temporal", domain: "note" },
  { name: "flujo funcional base de clock agrega, muestra y elimina relojes en HOME temporal", domain: "clock" },
  { name: "flujo funcional base de board usa columnas custom y agrega la card en la columna default", domain: "board" }
];

for (const flow of flows) {
  test(flow.name, { concurrency: false }, async (context) => {
    await withTempHome(
      async (home) => {
        const steps: Record<string, string>[] = [];
        let script = "";
        if (flow.domain === "todo" || flow.domain === "note") {
          script = `node "$1" ${flow.domain} --add-list && node "$1" ${flow.domain} --add && node "$1" ${flow.domain}`;
          steps.push(
            { waitFor: "Title of the list" },
            { type: "Personal" },
            { press: "ENTER" },
            { waitFor: "Description of the list" },
            { press: "ENTER" },
            { waitFor: flow.domain === "todo" ? "Title of the task" : "Title of the note" },
            { type: flow.domain === "todo" ? "Comprar pan" : "Idea rápida" },
            { press: "ENTER" },
            { waitFor: flow.domain === "todo" ? "Description of the task" : "Content of the note" },
            { type: flow.domain === "todo" ? "Breakfast" : "Texto funcional" },
            { checkpoint: "item-draft" },
            { press: "ENTER" }
          );
        }
        if (flow.domain === "clock") {
          script = 'node "$1" clock --add && node "$1" clock && node "$1" clock --remove';
          steps.push(
            { waitFor: "Search and select a timezone" },
            { type: "America/Mexico_City" },
            { press: "ENTER" },
            { waitFor: "Name of the clock" },
            { type: "CDMX" },
            { press: "ENTER" },
            { waitFor: "Select clocks to remove" },
            { checkpoint: "saved-clock" },
            { press: "SPACE" },
            { press: "ENTER" }
          );
        }
        if (flow.domain === "board") {
          script = 'node "$1" board --add-board && node "$1" board --add && node "$1" board';
          steps.push(
            { waitFor: "Title of the board" },
            { type: "Product" },
            { press: "ENTER" },
            { waitFor: "Description of the board" },
            { press: "ENTER" },
            { waitFor: "Initial columns" },
            { press: "CTRL_A" },
            { type: "Ideas, Ready, Ship" },
            { press: "ENTER" },
            { waitFor: "Default column for new cards" },
            { type: "Ready" },
            { press: "ENTER" },
            { waitFor: "Title of the card" },
            { type: "Write docs" },
            { press: "ENTER" },
            { waitFor: "Description of the card" },
            { type: "v1" },
            { checkpoint: "card-draft" },
            { press: "ENTER" }
          );
        }
        const result = await captureIluScenario({
          testName: context.name,
          command: ["env", `HOME=${home}`, "sh", "-c", script, "ilu-capture", path.join(repoRoot, "bin/cli.js")],
          scenario: "cliScript",
          input: { steps },
          viewport: { cols: 120, rows: 40 }
        });
        assert.equal(result.exitCode, 0);
        const db =
          flow.domain === "todo"
            ? "todos"
            : flow.domain === "note"
              ? "notes"
              : flow.domain === "board"
                ? "boards"
                : "clocks";
        const file = path.join(home, ".ilu", `${db}.json`);
        assert.ok(fs.statSync(file).isFile());
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        if (flow.domain === "clock") {
          assert.deepEqual(data, []);
          assert.match(result.frames["saved-clock"], /CDMX/);
          assert.match(result.frames["saved-clock"], /America\/Mexico_City/);
          assert.match(result.currentScreen, /removed/i);
        } else {
          const lists = data.collections[db].data;
          assert.equal(lists.length, 1);
          assert.equal(lists[0].current, true);
          if (flow.domain === "todo") {
            assert.deepEqual(
              lists[0].tasks.map((task) => task.title),
              ["Comprar pan"]
            );
            assert.match(result.currentScreen, /1 Comprar pan/);
          }
          if (flow.domain === "note") {
            assert.deepEqual(
              lists[0].notes.map((note) => note.title),
              ["Idea rápida"]
            );
            assert.equal(lists[0].notes[0].content, "Texto funcional");
            assert.match(result.currentScreen, /1 Idea rápida/);
          }
          if (flow.domain === "board") {
            assert.equal(lists[0].title, "Product");
            assert.equal(lists[0].defaultColumnId, "ready");
            assert.deepEqual(
              lists[0].columns.map((column) => column.title),
              ["Ideas", "Ready", "Ship"]
            );
            assert.deepEqual(
              lists[0].columns.map((column) => column.cards.map((card) => card.title)),
              [[], ["Write docs"], []]
            );
            assert.match(result.currentScreen, /Write docs/);
          }
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
      { prefix: "ilu-functional-physical-", testName: context.name }
    );
  });
}
