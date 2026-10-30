import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import loadDb from "../utils/load-db.ts";
import { withTempHome } from "../support/home-sandbox.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const cases = [
  {
    name: "iludb 2 migrates a legacy snapshot without revision and preserves its domain data",
    kind: "legacy",
    domain: "todos"
  },
  { name: "iludb 2 rejects invalid snapshots without overwriting them", kind: "invalid", domain: "notes" },
  {
    name: "a stale writer fails closed, reconciles through sync and reloads the external snapshot",
    kind: "stale",
    domain: "boards"
  },
  {
    name: "a failed model save does not notify sync and reload discards its unsaved in-memory mutation",
    kind: "failed-save",
    domain: "todos"
  },
  {
    name: "recovery is deduplicated by file and every stale instance receives the same typed conflict",
    kind: "two-windows",
    domain: "notes"
  },
  {
    name: "enabled recovery uses the configured TUI authority and rejects terminal sync status",
    kind: "terminal-ui",
    domain: "boards"
  },
  { name: "reload failure rejects recovery with a typed safe error", kind: "reload-failure", domain: "todos" },
  {
    name: "TUI action boundary maps a data conflict to safe recovery copy without a stack",
    kind: "ui-copy",
    domain: "notes"
  },
  {
    name: "queued recovery keeps a newer revision integrated by the active sync instead of restoring its old capture",
    kind: "newer",
    domain: "todos"
  },
  {
    name: "terminal recovery restores the file that existed when its serialized turn began",
    kind: "rollback",
    domain: "notes"
  },
  { name: "sync retry enable and recovery share one backend queue", kind: "queue", domain: "boards" }
];

// The worker must perform these changes against real sandbox files and local
// Git repos. Gates belong to the external Git process boundary, never to mocked
// model/recovery methods. Screenshots always show the actual CLI/TUI window.
for (const entry of cases) {
  test(entry.name, { concurrency: false }, async (context) => {
    await withTempHome(
      async (home) => {
        const bin = path.resolve(import.meta.dirname, "..", "bin/cli.js");
        const files: Record<string, string> = {};
        for (const domain of ["todos", "notes", "boards"]) {
          const document = {
            index: 1,
            current: true,
            title: "Legacy",
            description: "Initial",
            labels: [],
            ...(domain === "boards"
              ? {
                  defaultColumnId: "backlog",
                  columns: [{ id: "backlog", title: "Backlog", index: 1, wipLimit: null, cards: [] }]
                }
              : {
                  [domain === "todos" ? "tasks" : "notes"]: [
                    {
                      title: "Preserve me",
                      description: "Preserved details",
                      content: "Legacy content",
                      done: false,
                      labels: []
                    }
                  ]
                })
          };
          loadDb(domain).getCollection(domain).add(document);
          files[domain] = path.join(home, ".ilu", `${domain}.json`);
        }
        const file = files[entry.domain];
        const initial = fs.readFileSync(file, "utf8");
        const external = JSON.parse(initial);
        external.revision += 1;
        external.collections[entry.domain].data[0].description = "External";
        const externalBytes = JSON.stringify(external);
        const newer = JSON.parse(externalBytes);
        newer.revision += 1;
        newer.collections[entry.domain].data[0].description = "Revision C";
        const steps: Array<Record<string, unknown>> = [];
        const ui = ["terminal-ui", "ui-copy", "newer", "queue"].includes(entry.kind);
        let command = [
          "env",
          `HOME=${home}`,
          "node",
          bin,
          ...(ui ? ["ui"] : [entry.domain === "todos" ? "todo" : entry.domain === "notes" ? "note" : "board", "--add"])
        ];
        let expectedExit = 0;
        const sync = ["stale", "failed-save", "terminal-ui", "reload-failure", "newer", "rollback", "queue"].includes(
          entry.kind
        );
        const syncFixture = sync
          ? {
              home,
              files: [`${entry.domain}.json`],
              mode: "local-git-observed",
              ...(["terminal-ui", "rollback"].includes(entry.kind)
                ? { divergence: { file, local: externalBytes, remoteDescription: "Remote conflicting edit" } }
                : {}),
              ...(["reload-failure", "newer", "queue"].includes(entry.kind)
                ? { gate: "fetch", armAfterStartup: true }
                : {}),
              ...(entry.kind === "newer" ? { remoteSnapshot: { file, content: JSON.stringify(newer) } } : {})
            }
          : null;

        if (entry.kind === "legacy") {
          // Remove revision from genuine persisted fixtures, retaining the
          // timestamps and all domain data required by the installed plugin.
          for (const domain of ["todos", "notes", "boards"]) {
            const data = JSON.parse(fs.readFileSync(files[domain], "utf8"));
            delete data.revision;
            fs.writeFileSync(files[domain], JSON.stringify(data));
          }
          command = [
            "env",
            `HOME=${home}`,
            "sh",
            "-c",
            'node "$1" todo --edit-list && node "$1" note --edit-list && node "$1" board --edit-board',
            "ilu-capture",
            bin
          ];
          for (const domain of ["todos", "notes", "boards"]) {
            steps.push(
              { waitFor: domain === "boards" ? "Select the board to edit" : "Select the list to edit" },
              { press: "ENTER" },
              { waitFor: domain === "boards" ? "Title of the board" : "Title of the list" },
              { press: "ENTER" },
              { waitFor: domain === "boards" ? "Description of the board" : "Description of the list" },
              { press: "CTRL_A" },
              { type: "Migrated" },
              { checkpoint: `legacy-${domain}` },
              { press: "ENTER" }
            );
          }
        } else if (entry.kind === "invalid") {
          fs.writeFileSync(file, '{"collections":');
          command = ["env", `HOME=${home}`, "node", bin, "note"];
          expectedExit = 1;
        } else {
          if (ui) {
            if (entry.kind === "newer" || entry.kind === "queue") {
              steps.push(
                { clickText: "Sync" },
                { clickText: "Retry sync" },
                { waitForSyncGate: "fetch" },
                { checkpoint: "active-sync" }
              );
            }
            steps.push(
              { clickText: entry.domain === "todos" ? "Todo" : entry.domain === "notes" ? "Notes" : "Board" },
              { clickText: entry.domain === "todos" ? "Add task" : entry.domain === "notes" ? "Add note" : "Add card" },
              { type: "Unsaved local item" },
              {
                clickText:
                  entry.domain === "todos" ? "Task details" : entry.domain === "notes" ? "Note content" : "Description",
                rowOffset: 1
              },
              { type: "Unsaved content" }
            );
          } else {
            steps.push(
              {
                waitFor:
                  entry.domain === "todos"
                    ? "Title of the task"
                    : entry.domain === "notes"
                      ? "Title of the note"
                      : "Title of the card"
              },
              { type: "Unsaved local item" },
              { press: "ENTER" },
              {
                waitFor:
                  entry.domain === "notes"
                    ? "Content of the note"
                    : entry.domain === "todos"
                      ? "Description of the task"
                      : "Description of the card"
              },
              { type: "Unsaved content" }
            );
          }
          if (entry.kind === "two-windows") {
            steps.push({
              peerOpen: {
                name: "second-writer",
                command,
                steps: [
                  { waitFor: "Title of the note" },
                  { type: "Second unsaved item" },
                  { press: "ENTER" },
                  { waitFor: "Content of the note" },
                  { type: "Second unsaved content" }
                ]
              }
            });
          }
          steps.push(
            { checkpoint: "before-external", files: [file], observeSync: sync },
            { writeFile: { path: file, content: externalBytes } },
            { checkpoint: "external-file", files: [file] },
            ui ? { clickText: "Save" } : { press: "ENTER" }
          );
          if (entry.kind === "two-windows") {
            steps.push({ peerSteps: { name: "second-writer", steps: [{ press: "ENTER" }], waitForExit: true } });
          }
          if (entry.kind === "reload-failure") {
            // Hold the real reconciliation fetch before its reload, then let a
            // second file writer corrupt the snapshot. No microtask timing hook.
            steps.push(
              { waitForSyncGate: "fetch" },
              { writeFile: { path: file, content: '{"invalid":' } },
              { checkpoint: "corrupted-during-recovery", files: [file] },
              { releaseSyncGate: "fetch" }
            );
            expectedExit = 1;
          }
          if (entry.kind === "newer" || entry.kind === "queue") {
            // Recovery is queued behind the gated fetch. Its final message can
            // only appear after release, so waiting for it here would deadlock.
            steps.push({ checkpoint: "queued-recovery" });
            if (entry.kind === "queue") {
              steps.push({ press: "ESCAPE" }, { clickText: "Sync" }, { clickText: "Enable sync" });
            }
            steps.push({ releaseSyncGate: "fetch" }, { waitForSyncIdle: true });
            if (entry.kind === "queue") {
              steps.push({ clickText: "Enable sync" }, { waitForSyncIdle: true });
            }
          }
          if (entry.kind === "rollback") {
            expectedExit = 1;
          }
          if (ui) {
            steps.push(
              {
                waitFor:
                  entry.kind === "terminal-ui"
                    ? "recover|preserv|blocked|could not"
                    : "recover|reload|Repeat|synchron|enabled",
                flags: "i"
              },
              { checkpoint: "recovery-result" },
              { press: "ESCAPE" },
              { clickText: "Todo" },
              { press: "CTRL_C" }
            );
          }
        }
        const result = await captureIluScenario({
          testName: context.name,
          command,
          scenario: "cliScript",
          input: { steps, ...(syncFixture === null ? {} : { syncFixture }) },
          viewport: { cols: 140, rows: 46 }
        });
        assert.equal(result.exitCode, expectedExit);
        if (entry.kind === "legacy") {
          for (const domain of ["todos", "notes", "boards"]) {
            const saved = JSON.parse(fs.readFileSync(files[domain], "utf8"));
            assert.ok(saved.revision >= 1);
            assert.equal(saved.collections[domain].data[0].title, "Legacy");
            assert.equal(saved.collections[domain].data[0].description, "Migrated");
            if (domain === "boards") {
              assert.equal(saved.collections.boards.data[0].columns[0].title, "Backlog");
            } else {
              const item = saved.collections[domain].data[0][domain === "todos" ? "tasks" : "notes"][0];
              assert.equal(item.title, "Preserve me");
              if (domain === "notes") {
                assert.equal(item.content, "Legacy content");
              }
            }
          }
        } else if (entry.kind === "invalid" || entry.kind === "reload-failure") {
          assert.equal(fs.readFileSync(file, "utf8"), entry.kind === "invalid" ? '{"collections":' : '{"invalid":');
          assert.match(
            result.currentScreen,
            entry.kind === "invalid" ? /JSON|invalid|unexpected|SyntaxError/i : /recovery.*safely|preserved/i
          );
        } else {
          const saved = JSON.parse(fs.readFileSync(file, "utf8"));
          const current = saved.collections[entry.domain].data[0];
          assert.equal(current.description, entry.kind === "newer" ? "Revision C" : "External");
          assert.ok(!JSON.stringify(current).includes("Unsaved local item"));
          assert.ok(!JSON.stringify(current).includes("Second unsaved item"));
          assert.ok(saved.revision >= external.revision);
          if (entry.kind === "rollback" || entry.kind === "terminal-ui") {
            assert.equal(
              fs.readFileSync(file, "utf8"),
              externalBytes,
              "terminal recovery must preserve its turn-start file byte for byte"
            );
          }
          if (entry.kind === "stale") {
            assert.match(result.currentScreen, /reloaded|Repeat the action/i);
          }
          if (entry.kind === "two-windows") {
            // Error/promise identity is private to one runtime. Two real windows
            // instead demonstrate consistent safe recovery of the shared file.
            assert.equal(result.peers["second-writer"].exitCode, 0);
            assert.match(result.peers["second-writer"].currentScreen, /reloaded|Repeat the action/i);
            assert.match(result.currentScreen, /reloaded|Repeat the action/i);
          }
          if (entry.kind === "ui-copy") {
            assert.match(result.frames["recovery-result"], /recover|reload|Repeat/i);
            assert.doesNotMatch(result.frames["recovery-result"], /\/home\/|\bat \S+\s*\(|stack trace/i);
          }
          if (entry.kind === "failed-save" || entry.kind === "queue" || entry.kind === "newer") {
            assert.ok(!result.syncObservation.remoteFiles[`${entry.domain}.json`].includes("Unsaved local item"));
          }
          if (entry.kind === "newer") {
            assert.equal(saved.revision, newer.revision);
            assert.equal(
              JSON.parse(result.syncObservation.remoteFiles[`${entry.domain}.json`]).collections.todos.data[0]
                .description,
              "Revision C"
            );
          }
          if (entry.kind === "queue") {
            assert.equal(result.syncObservation.maximumActive, 1);
            assert.ok(
              result.syncObservation.completed >= 2,
              "the observation must include real sync/retry/enable/recovery work, not an unused backend"
            );
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
      { prefix: "ilu-conflict-physical-", testName: context.name }
    );
  });
}
