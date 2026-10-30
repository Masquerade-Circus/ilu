import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withTempHome } from "../support/home-sandbox.ts";
import loadDb from "../utils/load-db.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const cases = [
  { name: "utils/prompts falla limpio cuando stdin no es TTY antes de abrir Valyrian", kind: "pipe" },
  { name: "utils/prompts normaliza choices para Valyrian y respeta default primero", kind: "voice-default" },
  { name: "utils/prompts deriva la selección inicial de choices checked para checkbox", kind: "checked" },
  { name: "utils/prompts deriva defaultValue nativo para checkbox desde choices checked", kind: "checked" },
  // Public checkbox defaults are a subset of the choices by construction.
  // Replace the synthetic TypeError with its reachable intent: confirmation
  // cannot apply a phantom default to another task/list. No private branch claim.
  { name: "utils/prompts rechaza defaults de checkbox que no existan entre choices", kind: "owned-selection" },
  { name: "utils/prompts normaliza número opcional sin aceptar NaN ni negativos", kind: "number" }
];

for (const entry of cases) {
  test(entry.name, { concurrency: false }, async (context) => {
    await withTempHome(
      async (home) => {
        const root = path.join(home, ".ilu");
        fs.mkdirSync(path.join(root, ".config"), { recursive: true });
        const tasks = ["done task", "pending task", "another done task"].map((title, index) => ({
          title,
          description: "",
          labels: [],
          done: index !== 1
        }));
        const lists = [
          { index: 1, current: true, title: "Today", description: "", labels: [], tasks },
          {
            index: 2,
            current: false,
            title: "Archive",
            description: "",
            labels: [],
            tasks: [{ title: "Not in choices", description: "", labels: [], done: true }]
          }
        ];
        const todoFile = path.join(root, "todos.json");
        const collection = loadDb("todos").getCollection("todos");
        for (const list of lists) {
          collection.add(list);
        }
        const configFile = path.join(root, ".config", "tts-config.json");
        fs.writeFileSync(configFile, JSON.stringify({ voice: "nova" }), { mode: 0o600 });
        const before = fs.readFileSync(todoFile, "utf8");
        const bin = path.resolve(import.meta.dirname, "..", "bin/cli.js");
        let command = ["env", `HOME=${home}`, "node", bin, "todo", "--check"];
        const steps: Record<string, string>[] = [];
        if (entry.kind === "pipe") {
          // The graphical host remains a TTY. Only the real CLI child's stdin
          // is redirected, preserving the original non-interactive condition.
          command = ["env", `HOME=${home}`, "sh", "-c", 'exec node "$1" todo --add </dev/null', "ilu-capture", bin];
        } else if (entry.kind === "voice-default") {
          command = ["env", `HOME=${home}`, "node", bin, "tts", "voice"];
          steps.push({ waitFor: "Select a default TTS voice" }, { checkpoint: "preferred-voice" }, { press: "ENTER" });
        } else if (entry.kind === "number") {
          const columns = [{ id: "backlog", title: "Backlog", index: 1, cards: [], wipLimit: null }];
          loadDb("boards").getCollection("boards").add({
            index: 1,
            current: true,
            title: "Numeric validation",
            description: "",
            defaultColumnId: "backlog",
            columns
          });
          const attempts = ["NaN", "Infinity", "-1", "abc", "0", "4"];
          const script = attempts
            .map(
              (_value, index) => `node "$1" board --columns; code=$?; [ "$code" -eq ${index < 4 ? 1 : 0} ] || exit 2`
            )
            .join("; ");
          command = ["env", `HOME=${home}`, "sh", "-c", script, "ilu-capture", bin];
          for (const [index, value] of attempts.entries()) {
            steps.push(
              { waitFor: "Select a column to manage" },
              { press: "ENTER" },
              { waitFor: "What do you want to do" },
              { press: "DOWN" },
              { press: "ENTER" },
              { waitFor: "WIP limit" },
              { press: "CTRL_A" },
              { type: value },
              { press: "ENTER" }
            );
            if (index < 4) {
              steps.push(
                { waitFor: "whole|integer|least|minimum|invalid|number", flags: "i" },
                { checkpoint: `invalid-number-${index}` },
                { press: "ESCAPE" }
              );
            }
          }
        } else {
          steps.push({ waitFor: "Check/uncheck finished tasks" }, { checkpoint: "initial-selection" });
          if (entry.kind === "owned-selection") {
            steps.push({ press: "DOWN" }, { press: "SPACE" });
          }
          steps.push({ press: "ENTER" });
        }
        const result = await captureIluScenario({
          testName: context.name,
          command,
          scenario: "cliScript",
          input: { steps },
          viewport: { cols: 110, rows: 36 }
        });
        assert.equal(result.exitCode, entry.kind === "pipe" ? 1 : 0);
        const saved = JSON.parse(fs.readFileSync(todoFile, "utf8")).collections.todos.data;
        if (entry.kind === "pipe") {
          assert.match(result.currentScreen, /interactive terminal|TTY/i);
          assert.doesNotMatch(result.currentScreen, /at .*\(|ERR_MODULE_NOT_FOUND/);
          assert.equal(fs.readFileSync(todoFile, "utf8"), before);
        }
        if (entry.kind === "voice-default") {
          assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8")).voice, "nova");
          assert.match(result.frames["preferred-voice"], /nova/);
          assert.ok(
            result.frames["preferred-voice"].indexOf("nova") < result.frames["preferred-voice"].indexOf("alloy")
          );
          assert.equal(fs.readFileSync(todoFile, "utf8"), before);
        }
        if (entry.kind === "checked" || entry.kind === "owned-selection") {
          assert.deepEqual(
            saved[0].tasks.map((task) => task.done),
            entry.kind === "checked" ? [true, false, true] : [true, true, true]
          );
          assert.deepEqual(
            saved[0].tasks.map((task) => task.title),
            tasks.map((task) => task.title)
          );
          assert.deepEqual(saved[1].tasks, lists[1].tasks);
          assert.doesNotMatch(result.frames["initial-selection"], /Not in choices/);
        }
        if (entry.kind === "number") {
          const board = JSON.parse(fs.readFileSync(path.join(root, "boards.json"), "utf8")).collections.boards.data[0];
          assert.equal(board.columns[0].wipLimit, 4);
          assert.equal(fs.readFileSync(todoFile, "utf8"), before);
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
      { prefix: "ilu-prompts-physical-", testName: context.name }
    );
  });
}
