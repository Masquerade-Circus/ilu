import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import loadDb from "../utils/load-db.ts";
import { withTempHome } from "../support/home-sandbox.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const cases = [
  { name: "create-list-model crea listas con el itemKey configurado y conserva current", kind: "lists" },
  { name: "create-list-model agrega, edita y elimina items anidados y labels", kind: "items-labels" },
  { name: "create-list-model rechaza operaciones anidadas inválidas sin persistir cambios", kind: "invalid-item" },
  { name: "create-list-model expone check solo para colecciones que lo necesitan", kind: "check" },
  { name: "create-list-model reorders nested tasks and preserves item fields", kind: "reorder" },
  { name: "create-list-model rechaza reorder inválido sin persistir ni notificar sync", kind: "invalid-reorder" }
];

for (const entry of cases) {
  test(entry.name, { concurrency: false }, async (context) => {
    await withTempHome(
      async (home) => {
        const root = path.join(home, ".ilu");
        fs.mkdirSync(root, { recursive: true });
        const labels = [
          { title: "Importante", color: "bgRed" },
          { title: "Urgente", color: "bgBlue" }
        ];
        const tasks = ["First", "Second", "Third"].map((title, index) => ({
          title,
          description: ["A", "B", "C"][index],
          done: index === 1,
          labels: [labels[index % 2]]
        }));
        const notes = ["Alpha", "Beta", "Gamma"].map((title, index) => ({
          title,
          content: ["One", "Two", "Three"][index],
          done: false,
          labels: [labels[index % 2]]
        }));
        if (entry.kind !== "lists") {
          loadDb("todos")
            .getCollection("todos")
            .add({ index: 1, current: true, title: "Today", description: "", labels: [], tasks });
          loadDb("notes")
            .getCollection("notes")
            .add({
              index: 1,
              current: true,
              title: "Research",
              description: "",
              labels,
              notes: entry.kind === "items-labels" ? [] : notes
            });
        }
        const domain = entry.kind === "items-labels" || entry.kind === "invalid-reorder" ? "notes" : "todos";
        const file = path.join(root, `${domain}.json`);
        const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
        const bin = path.resolve(import.meta.dirname, "..", "bin/cli.js");
        let command = ["env", `HOME=${home}`, "node", bin, "ui"];
        const steps: Array<Record<string, unknown>> = [];
        if (entry.kind === "lists") {
          command = [
            "env",
            `HOME=${home}`,
            "sh",
            "-c",
            'node "$1" todo --add-list && node "$1" todo --add-list && node "$1" todo --lists',
            "ilu-capture",
            bin
          ];
          for (const title of [" First ", "Second"]) {
            steps.push(
              { waitFor: "Title of the list" },
              { type: title },
              { press: "ENTER" },
              { waitFor: "Description of the list" },
              { type: title.trim() === "First" ? " Desc " : "" },
              { checkpoint: `list-${title.trim()}` },
              { press: "ENTER" }
            );
          }
        }
        if (entry.kind === "items-labels") {
          // Public Notes exposes label assignment, not label-catalog CRUD. The
          // replacement protects assignment, edit/remove and catalog preservation.
          command = [
            "env",
            `HOME=${home}`,
            "sh",
            "-c",
            'node "$1" note --add && node "$1" note --edit && node "$1" note --remove; code=$?; [ "$code" -eq 1 ]',
            "ilu-capture",
            bin
          ];
          steps.push(
            { waitFor: "Title of the note" },
            { type: "Nota 1" },
            { press: "ENTER" },
            { waitFor: "Add labels to the note" },
            { press: "SPACE" },
            { press: "ENTER" },
            { waitFor: "Content of the note" },
            { type: "hola" },
            { press: "ENTER" }
          );
          steps.push(
            { waitFor: "Select a note" },
            { press: "ENTER" },
            { waitFor: "Title of the note" },
            { press: "CTRL_A" },
            { type: "Nota editada" },
            { press: "ENTER" },
            { waitFor: "Add labels to the note" },
            { press: "SPACE" },
            { press: "DOWN" },
            { press: "SPACE" },
            { checkpoint: "selected-label" },
            { press: "ENTER" },
            { waitFor: "Content of the note" },
            { press: "ENTER" },
            { waitFor: "Select notes to remove" },
            { checkpoint: "edited-note", files: [file] },
            { press: "SPACE" },
            { press: "ENTER" }
          );
        }
        if (entry.kind === "invalid-item") {
          // Unknown numeric positions were injected into private methods before.
          // Exercise the reachable protection: an absent task cannot be selected.
          command = ["env", `HOME=${home}`, "node", bin, "todo", "--edit"];
          steps.push(
            { waitFor: "Select a task" },
            { type: "Absent task 999" },
            { waitFor: "No matching", flags: "i" },
            { checkpoint: "invalid-task" },
            { press: "ESCAPE" }
          );
        }
        if (entry.kind === "check") {
          command = [
            "env",
            `HOME=${home}`,
            "sh",
            "-c",
            'node "$1" todo --check && node "$1" note --check; code=$?; [ "$code" -eq 1 ]',
            "ilu-capture",
            bin
          ];
          steps.push(
            { waitFor: "Check/uncheck finished tasks" },
            { press: "SPACE" },
            { checkpoint: "todo-check" },
            { press: "ENTER" }
          );
        }
        if (entry.kind === "reorder") {
          steps.push(
            { clickText: "Todo" },
            { clickText: "Second" },
            { press: "SHIFT_UP" },
            { checkpoint: "task-order" },
            { clickText: "Todo" },
            { press: "CTRL_C" }
          );
        }
        if (entry.kind === "invalid-reorder") {
          // Boundary navigation cannot manufacture a string or out-of-range
          // index. Its observable invariant is no write/publication at either end.
          steps.push(
            { clickText: "Notes" },
            { clickText: "Beta" },
            { press: "SHIFT_DOWN" },
            { checkpoint: "valid-order", files: [file], observeSync: true },
            { clickText: "Alpha" },
            { press: "SHIFT_UP" },
            { checkpoint: "upper-boundary" },
            { clickText: "Beta" },
            { press: "SHIFT_DOWN" },
            { checkpoint: "lower-boundary" },
            { clickText: "Todo" },
            { press: "CTRL_C" }
          );
        }
        const result = await captureIluScenario({
          testName: context.name,
          command,
          scenario: "cliScript",
          input: {
            steps,
            ...(entry.kind === "invalid-reorder"
              ? { syncFixture: { home, files: ["notes.json"], mode: "local-git-observed" } }
              : {})
          },
          viewport: { cols: 120, rows: 42 }
        });
        assert.equal(result.exitCode, entry.kind === "invalid-item" ? 1 : 0);
        const list = JSON.parse(fs.readFileSync(file, "utf8")).collections[domain].data;
        if (entry.kind === "lists") {
          assert.deepEqual(
            list.map((item) => item.title),
            ["First", "Second"]
          );
          assert.equal(list[0].description, "Desc");
          assert.deepEqual(
            list.map((item) => item.current),
            [false, true]
          );
          assert.ok(list.every((item) => item.tasks.length === 0 && item.labels.length === 0));
          assert.match(result.currentScreen, /Second/);
        }
        if (entry.kind === "items-labels") {
          const edited = JSON.parse(result.fileSnapshots["edited-note"][file]).collections.notes.data[0];
          assert.equal(edited.notes[0].title, "Nota editada");
          assert.equal(edited.notes[0].content, "hola");
          assert.deepEqual(edited.notes[0].labels, [labels[1]]);
          assert.deepEqual(list[0].notes, []);
          assert.deepEqual(list[0].labels, labels);
        }
        if (entry.kind === "invalid-item") {
          assert.equal(fs.readFileSync(file, "utf8"), before);
        }
        if (entry.kind === "check") {
          assert.deepEqual(
            list[0].tasks.map((task) => task.done),
            [true, true, false]
          );
          assert.match(result.currentScreen, /unknown option.*--check/i);
          assert.deepEqual(
            JSON.parse(fs.readFileSync(path.join(root, "notes.json"), "utf8")).collections.notes.data[0].notes,
            notes
          );
        }
        if (entry.kind === "reorder") {
          assert.deepEqual(
            list[0].tasks.map(({ title, description, done, labels }) => ({ title, description, done, labels })),
            [tasks[1], tasks[0], tasks[2]]
          );
        }
        if (entry.kind === "invalid-reorder") {
          assert.deepEqual(
            list[0].notes.map((note) => ({
              title: note.title,
              content: note.content,
              done: note.done,
              labels: note.labels
            })),
            [notes[0], notes[2], notes[1]]
          );
          assert.equal(fs.readFileSync(file, "utf8"), result.fileSnapshots["valid-order"][file]);
          assert.equal(
            result.remoteHead,
            result.remoteHeads["valid-order"],
            "boundary reorder must not publish another revision"
          );
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
      { prefix: "ilu-list-model-physical-", testName: context.name }
    );
  });
}
