import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const local = { todos: [{ title: "Local list", current: true, tasks: [{ title: "Available offline" }] }] };
const remote = { todos: [{ title: "Remote list", current: true, tasks: [{ title: "Pulled before first frame" }] }] };
const cases = [
  {
    name: "TUI bloquea la sesión y evita el snapshot inicial cuando startup sync detecta conflicto",
    fixture: {
      base: local,
      local: { todos: [{ title: "Local divergence", current: true, tasks: [{ title: "Preserved local task" }] }] },
      remote
    },
    blocked: true,
    marker: "Preserved local task"
  },
  {
    name: "TUI continúa local y muestra estado degradado cuando startup sync falla por red",
    fixture: { base: local, transportFailure: { stderr: "network is unreachable", exitCode: 1 } },
    marker: "Available offline",
    degraded: true
  },
  {
    name: "TUI completa startup sync una vez antes de construir su snapshot inicial",
    fixture: { base: local, remote },
    marker: "Pulled before first frame",
    pulled: true
  },
  {
    name: "TUI omite startup sync cuando la recepción remota está desactivada",
    fixture: { base: local, remote, config: { autoPull: false } },
    marker: "Available offline",
    pullDisabled: true
  }
];

for (const entry of cases) {
  test(entry.name, async (context) => {
    const result = await captureIluScenario({
      testName: context.name,
      scenario: "cliSequence",
      command: ["sh"],
      viewport: { cols: 80, rows: 24 },
      input: {
        cli: path.resolve(import.meta.dirname, "..", "bin", "cli.js"),
        seed: {},
        files: {},
        env: {},
        external: { denyUnmatched: true },
        syncFixture: {
          ...entry.fixture,
          config: { enabled: true, autoSync: true, autoPull: true, ...entry.fixture.config }
        },
        watchedFiles: [".ilu/todos.json", ".ilu/.sync-core/state.json"],
        commands: [
          {
            args: ["ui"],
            steps: entry.blocked
              ? []
              : [{ waitFor: { text: entry.marker, timeoutMs: 30000 } }, { capture: "workspace" }, { key: "CTRL_C" }]
          }
        ]
      }
    });
    const observed = result.observations[0];
    const output = fs.readFileSync(result.outputPath, "utf8");
    assert.equal(observed.exitCode, entry.blocked ? 1 : 0);
    const state = JSON.parse(observed.files[".ilu/.sync-core/state.json"]);
    if (entry.blocked) {
      assert.match(output, /conflict/i);
      assert.doesNotMatch(output, /Add task|Preserved local task/);
      assert.equal(state.status, "conflict");
    } else {
      assert.match(result.frames.workspace, new RegExp(entry.marker));
    }
    if (!entry.pulled) {
      assert.equal(observed.files[".ilu/todos.json"], result.initialFiles[".ilu/todos.json"]);
    }
    if (entry.pulled) {
      assert.doesNotMatch(output, /Available offline/);
      assert.match(observed.files[".ilu/todos.json"], /Pulled before first frame/);
      assert.equal(state.status, "healthy");
    }
    if (entry.degraded) {
      assert.equal(state.status, "degraded_network");
      assert.equal(state.hasPendingRemote, true);
      assert.match(result.frames.workspace, /failed|unavailable/i);
    }
    const fetches = result.externalRequests.filter(
      (request) => request.service === "git" && request.operation === "fetch"
    );
    if (entry.pulled) {
      assert.equal(fetches.length, 1);
    }
    if (entry.pullDisabled) {
      assert.equal(fetches.length, 0);
      assert.doesNotMatch(output, /Pulled before first frame/);
    }
    assert.equal(result.exitCode, 0);
    assertCaptureArtifacts({
      result,
      testName: context.name,
      checkpoints: entry.blocked ? ["cli-1"] : ["workspace", "cli-1"],
      diagnostic: (message) => context.diagnostic(message)
    });
  });
}
