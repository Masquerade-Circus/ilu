import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import * as __cjsImport55 from "../support/home-sandbox";
const { withTempHome } = __cjsImport55;
import localPaths from "../utils/local-paths";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";
const repoRoot = path.resolve(import.meta.dirname, "..");

test("utils/local-paths resuelve .ilu, bases de datos y sync bajo HOME", async (context) => {
  return withTempHome(
    async (tempHome) => {
      assert.equal(localPaths.storageDirPath(), path.join(tempHome, ".ilu"));
      assert.equal(localPaths.dbFilePath("notes"), path.join(tempHome, ".ilu", "notes.json"));
      assert.equal(localPaths.dbFilePath("clocks"), path.join(tempHome, ".ilu", "clocks.json"));
      assert.equal(localPaths.syncDirPath(), path.join(tempHome, ".ilu", ".config"));
      assert.equal(localPaths.syncConfigFilePath(), path.join(tempHome, ".ilu", ".config", "sync-config.json"));
      assert.equal(localPaths.ttsConfigFilePath(), path.join(tempHome, ".ilu", ".config", "tts-config.json"));
      assert.equal(localPaths.syncStateFilePath(), path.join(tempHome, ".ilu", ".config", "sync-state.json"));
      const result = await captureIluScenario({
        testName: context.name,
        command: ["env", `HOME=${tempHome}`, "node", path.join(repoRoot, "bin/cli.js"), "tts", "voice"],
        scenario: "cliScript",
        viewport: { cols: 110, rows: 32 },
        input: {
          steps: [
            { waitFor: "Select a default TTS voice" },
            { checkpoint: "voice-choice" },
            { press: "DOWN" },
            { press: "ENTER" }
          ]
        }
      });
      assert.equal(result.exitCode, 0);
      const config = JSON.parse(fs.readFileSync(localPaths.ttsConfigFilePath(), "utf8"));
      assert.equal(config.voice, "ash");
      assert.equal(fs.statSync(localPaths.ttsConfigFilePath()).mode & 0o777, 0o600);
      assert.equal(fs.existsSync(path.join(tempHome, "tts-config.json")), false);
      assertCaptureArtifacts({
        result,
        checkpoints: ["voice-choice", "cli-result"],
        testName: context.name,
        diagnostic: (message) => context.diagnostic(message)
      });
    },
    { prefix: "ilu-paths-", testName: context.name }
  );
});

test("puede correr con HOME temporal sin tocar datos reales", async (context) => {
  const originalHome = process.env.HOME;
  await withTempHome(
    async (tempHome) => {
      const result = await captureIluScenario({
        testName: context.name,
        command: ["env", `HOME=${tempHome}`, "node", path.join(repoRoot, "bin/cli.js"), "todo", "--add-list"],
        scenario: "cliScript",
        viewport: { cols: 110, rows: 32 },
        input: {
          steps: [
            { waitFor: "Title of the list" },
            { type: "phase2" },
            { press: "ENTER" },
            { waitFor: "Description of the list" },
            { checkpoint: "list-draft" },
            { press: "ENTER" }
          ]
        }
      });
      const expectedStorageDir = path.join(tempHome, ".ilu");
      assert.equal(result.exitCode, 0);
      assert.match(result.currentScreen, /phase2/);
      const file = path.join(expectedStorageDir, "todos.json");
      assert.ok(fs.statSync(file).isFile());
      assert.deepEqual(
        JSON.parse(fs.readFileSync(file, "utf8")).collections.todos.data.map((list) => list.title),
        ["phase2"]
      );
      assert.equal(fs.existsSync(path.join(tempHome, "todos.json")), false);
      assertCaptureArtifacts({
        result,
        checkpoints: ["list-draft", "cli-result"],
        testName: context.name,
        diagnostic: (message) => context.diagnostic(message)
      });
    },
    { prefix: "ilu-home-", testName: context.name }
  );
  assert.equal(process.env.HOME, originalHome);
});
