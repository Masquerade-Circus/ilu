import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withTempHome } from "../support/home-sandbox.ts";
import loadDb from "../utils/load-db.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

test("note --add usa prompt inline para contenido como vía principal", { concurrency: false }, async (context) => {
  await withTempHome(
    async (home) => {
      const file = path.join(home, ".ilu", "notes.json");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      loadDb("notes")
        .getCollection("notes")
        .add({ index: 1, current: true, title: "Ideas", description: "", notes: [], labels: [] });
      const result = await captureIluScenario({
        testName: context.name,
        command: [
          "env",
          `HOME=${home}`,
          "node",
          path.resolve(import.meta.dirname, "..", "bin/cli.js"),
          "note",
          "--add"
        ],
        scenario: "cliScript",
        viewport: { cols: 110, rows: 32 },
        input: {
          steps: [
            { waitFor: "Title of the note" },
            { type: "Idea rápida" },
            { press: "ENTER" },
            { waitFor: "Content of the note" },
            { type: "Linea 1" },
            { press: "CTRL_N" },
            { type: "Linea 2" },
            { checkpoint: "note-content" },
            { press: "ENTER" }
          ]
        }
      });
      assert.equal(result.exitCode, 0);
      const notes = JSON.parse(fs.readFileSync(file, "utf8")).collections.notes.data[0].notes;
      assert.equal(notes.length, 1);
      assert.equal(notes[0].title, "Idea rápida");
      assert.equal(notes[0].content, "Linea 1\nLinea 2");
      assert.deepEqual(notes[0].labels, []);
      assert.match(result.currentScreen, /Idea rápida/);
      assertCaptureArtifacts({
        result,
        checkpoints: ["note-content", "cli-result"],
        testName: context.name,
        diagnostic: (message) => context.diagnostic(message)
      });
    },
    { prefix: "ilu-note-add-physical-", testName: context.name }
  );
});
