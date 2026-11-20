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
    name: "iludb migrates a legacy snapshot without revision and preserves its domain data",
    kind: "legacy",
    domain: "todos"
  },
  { name: "iludb rejects invalid snapshots without overwriting them", kind: "invalid", domain: "notes" },
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
  { name: "sync retry enable and recovery share one backend queue", kind: "queue", domain: "boards" },
  ...["selection", "deletion"].map((operation) => ({
    name: `CLI board ${operation} rolls back earlier changes when a later board fails validation`,
    kind: `invalid-board-${operation}`,
    domain: "boards"
  })),
  ...["todos", "notes", "boards"].map((domain) => ({
    name: `CLI ${domain} commits selection and bulk deletion with fallback and contiguous numbering`,
    kind: "transaction-success",
    domain
  })),
  ...["todos", "notes", "boards"].flatMap((domain) =>
    ["selection", "deletion"].map((operation) => ({
      name: `CLI ${domain} ${operation} preserves the complete external snapshot on conflict`,
      kind: `conflict-${operation}`,
      domain
    }))
  )
];

// The worker must perform these changes against real sandbox files and local
// Git repos. Gates belong to the external Git process boundary, never to mocked
// model/recovery methods. Screenshots always show the actual CLI/TUI window.
for (const entry of cases) {
  test(entry.name, { concurrency: false }, async (context) => {
    if (entry.kind === "transaction-success") {
      await withTempHome(async (home) => {
        const domain = entry.domain;
        const collection = loadDb(domain).getCollection(domain);
        for (const [offset, title] of ["First", "Second", "Third", "Fourth"].entries()) {
          collection.add({
            title,
            description: `${title} details`,
            index: offset + 1,
            current: offset === 0,
            labels: [],
            ...(domain === "boards"
              ? { defaultColumnId: "backlog", columns: [{ id: "backlog", title: "Backlog", index: 1, wipLimit: null, cards: [] }] }
              : { [domain === "todos" ? "tasks" : "notes"]: [] })
          });
        }
        const file = path.join(home, ".ilu", `${domain}.json`);
        const noun = domain === "boards" ? "board" : "list";
        const command = domain === "todos" ? "todo" : domain === "notes" ? "note" : "board";
        const result = await captureIluScenario({
          testName: context.name,
          scenario: "cliScript",
          command: [
            "env", `HOME=${home}`, "sh", "-c",
            'node "$1" "$2" "$3" && node "$1" "$2" "$4" && node "$1" "$2" "$4" && node "$1" "$2" "$4"',
            "ilu-transactions", path.resolve(import.meta.dirname, "..", "bin/cli.js"), command,
            `--use-${noun}`, `--remove-${noun}`
          ],
          viewport: { cols: 120, rows: 40 },
          input: { steps: [
            { waitFor: `Select the ${noun} to use` },
            { press: "DOWN" }, { press: "DOWN" }, { press: "ENTER" },
            { waitFor: "○ 3 Third (current)" },
            { checkpoint: "selection", files: [file] },
            { press: "SPACE" }, { press: "DOWN" }, { press: "DOWN" }, { press: "SPACE" }, { press: "ENTER" },
            { waitFor: "○ 1 Second.*\\n○ 2 Fourth", flags: "" },
            { checkpoint: "bulk-deletion", files: [file] },
            { press: "DOWN" }, { press: "SPACE" }, { press: "ENTER" },
            { waitFor: "○ 1 Second.*\\n\\s+Done", flags: "" },
            { checkpoint: "noncurrent-deletion", files: [file] },
            { press: "SPACE" }, { press: "ENTER" }
          ] }
        });
        // The existing CLI reports an empty collection with exit 1 after the last deletion.
        assert.equal(result.exitCode, 1);
        const selected = JSON.parse(result.fileSnapshots.selection[file]).collections[domain].data;
        const afterBulk = JSON.parse(result.fileSnapshots["bulk-deletion"][file]).collections[domain].data;
        const afterNoncurrent = JSON.parse(result.fileSnapshots["noncurrent-deletion"][file]).collections[domain].data;
        assert.deepEqual(selected.filter((list) => list.current).map((list) => list.title), ["Third"]);
        assert.deepEqual(
          afterBulk.map(({ title, current, index, description }) => ({ title, current, index, description })),
          [
            { title: "Second", current: true, index: 1, description: "Second details" },
            { title: "Fourth", current: false, index: 2, description: "Fourth details" }
          ]
        );
        assert.deepEqual(
          afterNoncurrent.map(({ title, current, index }) => ({ title, current, index })),
          [{ title: "Second", current: true, index: 1 }]
        );
        assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).collections[domain].data.length, 0);
        assertCaptureArtifacts({
          result,
          testName: context.name,
          checkpoints: ["selection", "bulk-deletion", "noncurrent-deletion", "cli-result"],
          diagnostic: (message) => context.diagnostic(message)
        });
      }, { prefix: "ilu-transaction-success-", testName: context.name });
      return;
    }
    if (entry.kind.startsWith("invalid-board-")) {
      await withTempHome(async (home) => {
        const collection = loadDb("boards").getCollection("boards");
        for (const [offset, title] of ["First", "Second", "Invalid"].entries()) {
          collection.add({
            title,
            description: "Preserve all boards",
            index: offset + 1,
            current: offset === 0,
            defaultColumnId: offset === 2 ? "missing" : "backlog",
            columns: [{ id: "backlog", title: "Backlog", index: 1, wipLimit: null, cards: [] }]
          });
        }
        const file = path.join(home, ".ilu", "boards.json");
        const before = fs.readFileSync(file, "utf8");
        const selection = entry.kind.endsWith("selection");
        const result = await captureIluScenario({
          testName: context.name,
          scenario: "cliScript",
          command: ["env", `HOME=${home}`, "node", path.resolve(import.meta.dirname, "..", "bin/cli.js"), "board", selection ? "--use-board" : "--remove-board"],
          viewport: { cols: 120, rows: 40 },
          input: { steps: [
            { waitFor: selection ? "Select the board to use" : "Select the boards to remove" },
            ...(selection ? [{ press: "DOWN" }, { press: "DOWN" }] : [{ press: "SPACE" }]),
            { checkpoint: "before-rejection", files: [file] },
            { press: "ENTER" }
          ] }
        });
        assert.equal(result.exitCode, 1);
        const boards = JSON.parse(fs.readFileSync(file, "utf8")).collections.boards.data;
        assert.deepEqual(boards.map(({title, current, index}) => ({title, current, index})), JSON.parse(before).collections.boards.data.map(({title, current, index}) => ({title, current, index})), "A later domain validation failure must not publish deselection, deletion or renumbering");
        assertCaptureArtifacts({ result, testName: context.name, checkpoints: ["before-rejection", "cli-result"], diagnostic: (message) => context.diagnostic(message) });
      }, { prefix: "ilu-transaction-validation-", testName: context.name });
      return;
    }
    if (entry.kind.startsWith("conflict-")) {
      await withTempHome(async (home) => {
        const domain = entry.domain;
        const collection = loadDb(domain).getCollection(domain);
        for (const [offset, title] of ["First", "Second", "Third"].entries()) {
          collection.add({
            title,
            description: "Preserved details",
            index: offset + 1,
            current: offset === 0,
            labels: [],
            ...(domain === "boards"
              ? { defaultColumnId: "backlog", columns: [{ id: "backlog", title: "Backlog", index: 1, wipLimit: null, cards: [] }] }
              : { [domain === "todos" ? "tasks" : "notes"]: [] })
          });
        }
        const file = path.join(home, ".ilu", `${domain}.json`);
        const external = JSON.parse(fs.readFileSync(file, "utf8"));
        external.revision += 1;
        external.collections[domain].data[2].description = "External edit must survive";
        const externalBytes = JSON.stringify(external);
        const selection = entry.kind === "conflict-selection";
        const noun = domain === "boards" ? "board" : "list";
        const result = await captureIluScenario({
          testName: context.name,
          scenario: "cliScript",
          command: ["env", `HOME=${home}`, "node", path.resolve(import.meta.dirname, "..", "bin/cli.js"), domain === "todos" ? "todo" : domain === "notes" ? "note" : "board", `--${selection ? "use" : "remove"}-${noun}`],
          viewport: { cols: 120, rows: 40 },
          input: {
            steps: [
              { waitFor: selection ? `Select the ${noun} to use` : `Select the ${noun}s to remove` },
              { press: "DOWN" },
              ...(selection ? [] : [{ press: "SPACE" }]),
              { checkpoint: "before-external", files: [file] },
              { writeFile: { path: file, content: externalBytes } },
              { press: "ENTER" }
            ]
          }
        });
        assert.equal(result.exitCode, 0);
        assert.equal(fs.readFileSync(file, "utf8"), externalBytes, "Rejected selection/deletion must preserve all external data, selection and numbering");
        assert.match(result.currentScreen, /repeat|retry|reload|changed|conflict/i);
        assertCaptureArtifacts({ result, testName: context.name, checkpoints: ["before-external", "cli-result"], diagnostic: (message) => context.diagnostic(message) });
      }, { prefix: "ilu-operation-conflict-", testName: context.name });
      return;
    }
    if (entry.kind === "queue") {
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "syncWorkflow",
        command: ["sh"],
        viewport: { cols: 120, rows: 40 },
        input: {
          fixture: {
            remote: "empty",
            initialize: true,
            local: { todos: "Inbox", boards: "Legacy" },
            config: { autoPull: true },
            transport: { gate: "fetch", arm: "after-open" }
          },
          steps: [
            { action: "open", view: "Board" },
            { action: "ui", operation: "add-card", title: "Trigger automatic sync" },
            {
              action: "external-writer",
              domain: "boards",
              readLocalFirst: true,
              values: { description: "External" },
              publish: true,
              name: "external-file"
            },
            { action: "wait-debounce" },
            { action: "wait-transport", operation: "fetch", gated: true },
            { action: "ui", operation: "add-card", title: "Unsaved local item", expectRecovery: true },
            { action: "observe", name: "queued-recovery" },
            { action: "ui", operation: "dismiss-notice" },
            { action: "ui", operation: "sync-retry" },
            { action: "observe", name: "retry-during-recovery" },
            { action: "release-transport", operation: "fetch" },
            { action: "settle-sync", name: "retry-result" },
            { action: "ui", operation: "sync-enable" },
            { action: "settle-sync", name: "enabled-result" },
            { action: "exit" }
          ]
        }
      });
      assert.equal(result.exitCode, 0);
      const active = result.at["retry-during-recovery"].transport.filter((event) => event.finishedAt === null);
      assert.equal(active.length, 1, "Public retry and queued recovery must not overlap backend work");
      const recovered = result.at["enabled-result"];
      assert.equal(JSON.parse(recovered.files["boards.json"]).collections.boards.data[0].description, "External");
      assert.doesNotMatch(recovered.files["boards.json"], /Unsaved local item/);
      assert.equal(recovered.files["boards.json"], recovered.remoteFiles["boards.json"]);
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: ["external-file", "queued-recovery", "retry-during-recovery", "retry-result", "enabled-result"],
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
    if (entry.kind === "newer") {
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "syncWorkflow",
        command: ["sh"],
        viewport: { cols: 120, rows: 40 },
        input: {
          fixture: {
            remote: "empty",
            initialize: true,
            local: { todos: "Legacy", notes: "Notes" },
            config: { autoPull: true },
            transport: { gate: "fetch", arm: "after-open" }
          },
          steps: [
            { action: "open", view: "Todo" },
            { action: "ui", operation: "add-task", title: "Trigger automatic sync" },
            {
              action: "external-writer",
              domain: "todos",
              readLocalFirst: true,
              values: { description: "Revision B" },
              publish: true,
              name: "revision-b"
            },
            { action: "wait-debounce" },
            { action: "wait-transport", operation: "fetch", gated: true },
            {
              action: "external-writer",
              domain: "todos",
              values: { description: "Revision C" },
              publish: true,
              copyToLocal: false,
              name: "revision-c-remote"
            },
            { action: "ui", operation: "add-task", title: "Unsaved local item" },
            { action: "observe", name: "queued-recovery" },
            { action: "release-transport", operation: "fetch" },
            { action: "wait-recovery", domain: "todos", name: "recovery-result" },
            { action: "exit" }
          ]
        }
      });
      assert.equal(result.exitCode, 0);
      const queued = result.at["queued-recovery"];
      assert.equal(JSON.parse(queued.files["todos.json"]).collections.todos.data[0].description, "Revision B");
      assert.equal(JSON.parse(queued.remoteFiles["todos.json"]).collections.todos.data[0].description, "Revision C");
      assert.ok(
        queued.transport.some(
          (event) => event.operation === "fetch" && event.gated === true && event.finishedAt === null
        )
      );
      const recovered = result.at["recovery-result"];
      const saved = JSON.parse(recovered.files["todos.json"]);
      assert.equal(saved.collections.todos.data[0].description, "Revision C");
      assert.equal(saved.revision, JSON.parse(queued.remoteFiles["todos.json"]).revision);
      assert.ok(saved.collections.todos.data[0].tasks.some((task) => task.title === "Trigger automatic sync"));
      assert.doesNotMatch(recovered.files["todos.json"], /Unsaved local item/);
      assert.equal(recovered.files["todos.json"], recovered.remoteFiles["todos.json"]);
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: ["revision-b", "revision-c-remote", "queued-recovery", "recovery-result"],
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
    if (entry.kind === "reload-failure") {
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "syncWorkflow",
        command: ["sh"],
        viewport: { cols: 120, rows: 40 },
        input: {
          fixture: {
            remote: "empty",
            initialize: true,
            local: { todos: "Legacy", notes: "Notes" },
            config: { autoPull: true },
            transport: { gate: "push", arm: "after-open" }
          },
          steps: [
            { action: "open", view: "Todo" },
            { action: "observe", name: "before-external" },
            {
              action: "external-writer",
              domain: "todos",
              values: { description: "External" },
              publish: false,
              name: "external-file"
            },
            { action: "ui", operation: "add-task", title: "Unsaved local item" },
            { action: "wait-transport", operation: "push", gated: true },
            { action: "write-domain", domain: "todos", content: '{"invalid":', name: "corrupted-during-recovery" },
            { action: "release-transport", operation: "push" },
            { action: "wait-recovery-blocked", name: "recovery-result" },
            { action: "exit" }
          ]
        }
      });
      assert.equal(result.exitCode, 0);
      const recovered = result.at["recovery-result"];
      assert.equal(recovered.files["todos.json"], '{"invalid":');
      assert.equal(JSON.parse(recovered.remoteFiles["todos.json"]).collections.todos.data[0].description, "External");
      assert.doesNotMatch(recovered.remoteFiles["todos.json"], /Unsaved local item/);
      assert.doesNotMatch(recovered.screen, /\/home\/|\bat \S+\s*\(|stack trace/i);
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: ["before-external", "external-file", "corrupted-during-recovery", "recovery-result"],
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
    if (["stale", "failed-save", "ui-copy", "terminal-ui", "rollback"].includes(entry.kind)) {
      const failedSave = entry.kind === "failed-save";
      const rollback = entry.kind === "rollback";
      const terminal = entry.kind === "terminal-ui" || rollback;
      const terminalStatus = rollback ? "conflict" : "degraded_auth";
      const domain = entry.domain;
      const result = await captureIluScenario({
        testName: context.name,
        scenario: "syncWorkflow",
        command: ["sh"],
        viewport: { cols: 120, rows: 40 },
        input: {
          fixture: {
            remote: "empty",
            initialize: true,
            local: failedSave
              ? { todos: "Legacy", notes: "Notes" }
              : entry.kind === "ui-copy" || rollback
                ? { todos: "Inbox", notes: "Legacy" }
                : { todos: "Inbox", boards: "Legacy" },
            config: { autoPull: true }
          },
          steps: [
            { action: "open", view: domain === "todos" ? "Todo" : domain === "notes" ? "Notes" : "Board" },
            { action: "observe", name: "before-external" },
            {
              action: "external-writer",
              domain,
              values: { description: "External" },
              publish: !rollback,
              name: "external-file"
            },
            ...(rollback
              ? [
                  {
                    action: "external-writer",
                    domain,
                    values: { description: "Remote conflicting edit" },
                    publish: true,
                    copyToLocal: false,
                    name: "divergent-remote"
                  }
                ]
              : []),
            ...(terminal && !rollback ? [{ action: "transport", mode: "auth-failure" }] : []),
            {
              action: "ui",
              operation: domain === "todos" ? "add-task" : domain === "notes" ? "add-note" : "add-card",
              title: "Unsaved local item",
              expectRecovery: true
            },
            ...(terminal
              ? [{ action: "wait-status", status: terminalStatus, name: "recovery-result" }]
              : [{ action: "wait-recovery", domain, name: "recovery-result" }]),
            ...(failedSave
              ? [
                  { action: "ui", operation: "dismiss-notice" },
                  { action: "wait-debounce" },
                  { action: "observe", name: "after-failed-save" }
                ]
              : []),
            { action: "exit" }
          ]
        }
      });
      assert.equal(result.exitCode, 0);
      const recovered = result.at["recovery-result"];
      const file = `${domain}.json`;
      const before = JSON.parse(result.at["before-external"].files[file]);
      const external = JSON.parse(result.at["external-file"].files[file]);
      const saved = JSON.parse(recovered.files[file]);
      assert.equal(saved.collections[domain].data[0].description, "External");
      assert.ok(saved.revision >= external.revision && external.revision > before.revision);
      assert.doesNotMatch(recovered.files[file], /Unsaved local item/);
      assert.match(
        recovered.screen,
        terminal ? /preserv|blocked|could not|failed/i : /repeat|retry|changed|conflict|reload/i
      );
      assert.equal(JSON.parse(recovered.files[".sync-core/state.json"]).status, terminal ? terminalStatus : "healthy");
      if (terminal) {
        assert.doesNotMatch(recovered.screen, /\/home\/|\bat \S+\s*\(|stack trace|DataRecoveryError/i);
        assert.equal(
          recovered.files[file],
          result.at["external-file"].files[file],
          "Terminal recovery must preserve the file byte for byte"
        );
      } else {
        assert.equal(recovered.files[".config/sync-pending.json"], null);
      }
      assert.match(recovered.remoteFiles[file], rollback ? /Remote conflicting edit/ : /External/);
      assert.doesNotMatch(recovered.remoteFiles[file], /Unsaved local item/);
      if (entry.kind === "ui-copy") {
        assert.doesNotMatch(recovered.screen, /\/home\/|\bat \S+\s*\(|stack trace/i);
      }
      if (failedSave) {
        const settled = result.at["after-failed-save"];
        assert.equal(
          settled.transport.length,
          recovered.transport.length,
          "A rejected model save must not schedule another automatic transport after recovery"
        );
        assert.doesNotMatch(settled.screen, /Unsaved local item/);
        assert.equal(settled.files[file], recovered.files[file]);
        assert.equal(settled.remoteFiles[file], recovered.remoteFiles[file]);
      }
      assertCaptureArtifacts({
        result,
        testName: context.name,
        checkpoints: [
          "before-external",
          "external-file",
          ...(rollback ? ["divergent-remote"] : []),
          "recovery-result",
          ...(failedSave ? ["after-failed-save"] : [])
        ],
        diagnostic: (message) => context.diagnostic(message)
      });
      return;
    }
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
