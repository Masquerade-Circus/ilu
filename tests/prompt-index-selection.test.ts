import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withTempHome } from "../support/home-sandbox.ts";
import loadDb from "../utils/load-db.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

test(
  "selectOne uses a searchable prompt, filters choices by name, and returns the selected index",
  { concurrency: false },
  async (context) => {
    await withTempHome(
      async (home) => {
        const file = path.join(home, ".ilu", "notes.json");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const notes = ["Write docs", "Fix Login", "Ship release"].map((title, index) => ({
          title,
          content: `Distinct content ${index + 1}`,
          labels: [],
          done: false
        }));
        loadDb("notes")
          .getCollection("notes")
          .add({ index: 1, current: true, title: "Research", description: "", labels: [], notes });
        const before = fs.readFileSync(file, "utf8");
        const result = await captureIluScenario({
          testName: context.name,
          command: [
            "env",
            `HOME=${home}`,
            "node",
            path.resolve(import.meta.dirname, "..", "bin/cli.js"),
            "note",
            "--details"
          ],
          scenario: "cliScript",
          viewport: { cols: 110, rows: 32 },
          input: {
            steps: [
              { waitFor: "Select a note" },
              { type: "Fix Login" },
              { checkpoint: "filtered-selection" },
              { press: "ENTER" }
            ]
          }
        });
        assert.equal(result.exitCode, 0);
        assert.match(result.frames["filtered-selection"], /Fix Login/);
        assert.doesNotMatch(result.frames["filtered-selection"], /Write docs|Ship release/);
        assert.match(result.currentScreen, /Distinct content 2/);
        assert.doesNotMatch(result.currentScreen, /Distinct content [13]/);
        assert.equal(fs.readFileSync(file, "utf8"), before);
        assertCaptureArtifacts({
          result,
          checkpoints: ["filtered-selection", "cli-result"],
          testName: context.name,
          diagnostic: (message) => context.diagnostic(message)
        });
      },
      { prefix: "ilu-selection-physical-", testName: context.name }
    );
  }
);
