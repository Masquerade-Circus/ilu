import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withTempHome } from "../support/home-sandbox.ts";
import loadDb from "../utils/load-db.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

// Original names provide individual correspondence. Reducer status is replaced
// by actual editing, confirmation/cancellation and persisted content through CLI.
const cases = [
  {
    name: "inline note prompt agrega texto al final y Ctrl+N inserta nueva línea",
    initial: "Base",
    steps: [{ type: "Hola" }, { press: "CTRL_N" }, { type: "mundo" }, { checkpoint: "multiline" }, { press: "ENTER" }],
    expected: "BaseHola\nmundo"
  },
  {
    name: "inline note prompt confirma con Enter y conserva contenido inicial al editar",
    initial: "Base",
    steps: [{ type: "!" }, { checkpoint: "draft" }, { press: "ENTER" }],
    expected: "Base!"
  },
  {
    name: "inline note prompt cancela con Esc",
    initial: "Base",
    steps: [{ type: "discard me" }, { checkpoint: "draft" }, { press: "ESCAPE" }],
    expected: "Base",
    unchanged: true
  },
  {
    name: "inline note prompt renderiza instrucciones y contenido actual",
    initial: "Linea 1\nLinea 2",
    steps: [{ checkpoint: "instructions" }, { press: "ESCAPE" }],
    expected: "Linea 1\nLinea 2",
    unchanged: true
  }
];

for (const entry of cases) {
  test(entry.name, { concurrency: false }, async (context) => {
    await withTempHome(
      async (home) => {
        const file = path.join(home, ".ilu", "notes.json");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const list = {
          $id: 1,
          index: 1,
          current: true,
          title: "Ideas",
          description: "",
          labels: [],
          notes: [{ title: "Capture note", content: entry.initial, labels: [], done: false }]
        };
        loadDb("notes").getCollection("notes").add(list);
        const before = fs.readFileSync(file, "utf8");
        const steps = [
          { waitFor: "Select a note" },
          { press: "ENTER" },
          { waitFor: "Title of the note" },
          { press: "ENTER" },
          { waitFor: "Content of the note" },
          ...entry.steps
        ];
        const result = await captureIluScenario({
          testName: context.name,
          command: [
            "env",
            `HOME=${home}`,
            "node",
            path.resolve(import.meta.dirname, "..", "bin/cli.js"),
            "note",
            "--edit"
          ],
          scenario: "cliScript",
          input: { steps },
          viewport: { cols: 110, rows: 32 }
        });
        assert.equal(result.exitCode, 0);
        const saved = JSON.parse(fs.readFileSync(file, "utf8")).collections.notes.data[0];
        assert.equal(saved.notes.length, 1);
        assert.equal(saved.notes[0].title, "Capture note");
        assert.equal(saved.notes[0].content, entry.expected);
        if (entry.unchanged) {
          assert.equal(fs.readFileSync(file, "utf8"), before, "cancellation must not write the note");
        }
        if (entry.initial.includes("\n")) {
          assert.match(result.frames.instructions, /Linea 1[\s\S]*Linea 2/);
          assert.match(result.frames.instructions, /Enter/);
          assert.match(result.frames.instructions, /Ctrl\+N/);
          assert.match(result.frames.instructions, /Esc/);
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
      { prefix: "ilu-inline-physical-", testName: context.name }
    );
  });
}
