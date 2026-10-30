import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withTempHome } from "../support/home-sandbox.ts";
import loadDb from "../utils/load-db.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

// Constructor arguments are incidental. Their observable intent is a real
// readable table containing headings, WIP occupancy and every card's content.
const cases = [
  { name: "board renderer delegates to cli-table when the dependency is available", cols: 55, mode: "standard" },
  { name: "board renderer infers cli-table widths from process stdout columns", cols: 55, mode: "standard" },
  { name: "board renderer keeps a minimum cli-table width per column on narrow terminals", cols: 17, mode: "narrow" },
  { name: "board renderer weights cli-table widths by visible column content", cols: 55, mode: "weighted" },
  {
    name: "board renderer wraps card content within cli-table column width instead of truncating it",
    cols: 14,
    mode: "wrap"
  },
  { name: "board renderer uses the installed cli-table dependency output", cols: 55, mode: "standard" }
];

for (const entry of cases) {
  test(entry.name, { concurrency: false }, async (context) => {
    await withTempHome(
      async (home) => {
        const file = path.join(home, ".ilu", "boards.json");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const definitions =
          entry.mode === "weighted"
            ? [
                { title: "Todo", cards: ["Tiny"] },
                { title: "Implementation", cards: ["A much longer card title"] },
                { title: "Done", cards: [] }
              ]
            : entry.mode === "wrap"
              ? [{ title: "Ready", cards: ["Review copy"] }]
              : entry.mode === "narrow"
                ? [
                    { title: "A", cards: ["One"] },
                    { title: "B", cards: ["Two"] }
                  ]
                : [
                    { title: "Backlog", cards: ["Spec API"] },
                    { title: "Ready", cards: ["Review copy"] },
                    { title: "Done", cards: [] }
                  ];
        const columns = definitions.map((column, index) => ({
          id: `column-${index}`,
          index: index + 1,
          title: column.title,
          wipLimit: column.title === "Ready" && entry.mode === "standard" ? 2 : null,
          cards: column.cards.map((title, position) => ({ title, description: "", position: position + 1 }))
        }));
        loadDb("boards")
          .getCollection("boards")
          .add({ index: 1, current: true, title: "Product", description: "", defaultColumnId: columns[0].id, columns });
        const before = fs.readFileSync(file, "utf8");
        const result = await captureIluScenario({
          testName: context.name,
          command: ["env", `HOME=${home}`, "node", path.resolve(import.meta.dirname, "..", "bin/cli.js"), "board"],
          scenario: "cliExit",
          viewport: { cols: entry.cols, rows: 50 }
        });
        assert.equal(result.exitCode, 0);
        assert.equal(fs.readFileSync(file, "utf8"), before, "rendering must not change cards or columns");
        const frame = result.currentScreen;
        assert.match(frame, /Product/);
        assert.ok(frame.includes("│"), "installed table output must have distinct cells");
        for (const column of definitions) {
          assert.ok(frame.includes(column.title));
        }
        // Wrapping may insert cell borders and line breaks between words, but
        // must preserve the words, unlike the previous fake table's call counts.
        for (const title of definitions.flatMap((column) => column.cards)) {
          for (const word of title.split(" ")) {
            assert.ok(frame.includes(word), `missing card word ${word}`);
          }
        }
        if (entry.mode === "standard") {
          assert.match(frame, /Ready\s*\(1\/2\)/);
        }
        if (entry.mode === "wrap") {
          const lines = frame.split("\n");
          assert.notEqual(
            lines.findIndex((line) => line.includes("Review")),
            lines.findIndex((line) => line.includes("copy"))
          );
        }
        if (entry.mode === "weighted") {
          const heading = frame.split("\n").find((line) => line.includes("Implementation"));
          assert.equal(typeof heading, "string");
          const boundaries = [...heading.matchAll(/│/g)].map((match) => match.index);
          assert.equal(boundaries.length, 4);
          assert.ok(
            boundaries[2] - boundaries[1] > boundaries[1] - boundaries[0],
            "longer content must receive more space"
          );
        }
        assertCaptureArtifacts({
          result,
          checkpoints: ["cli-result"],
          testName: context.name,
          diagnostic: (message) => context.diagnostic(message)
        });
      },
      { prefix: "ilu-renderer-physical-", testName: context.name }
    );
  });
}

// A broken local installation makes cli-table genuinely unresolvable. Its
// empty exports map prevents accidental resolution from the checkout ancestor.
// This proves fail-closed startup, not the old synthetic MODULE_NOT_FOUND code.
test("board renderer requires cli-table instead of falling back to a manual table renderer", async (context) => {
  await withTempHome(
    async (home) => {
      const root = path.resolve(import.meta.dirname, "..");
      const installed = path.join(home, "installed");
      fs.mkdirSync(installed);
      for (const entry of [
        "bin",
        "clocks",
        "notes",
        "scrumban",
        "sync",
        "todos",
        "translate",
        "tts",
        "ui",
        "utils",
        "support",
        "cli.ts",
        "package.json",
        "tsconfig.json"
      ]) {
        fs.cpSync(path.join(root, entry), path.join(installed, entry), { recursive: true });
      }
      const dependency = path.join(installed, "node_modules", "cli-table");
      fs.mkdirSync(dependency, { recursive: true });
      fs.writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "cli-table", exports: {} }));
      loadDb("boards")
        .getCollection("boards")
        .add({
          index: 1,
          current: true,
          title: "No fallback",
          description: "",
          defaultColumnId: "backlog",
          columns: [{ id: "backlog", title: "Backlog", wipLimit: null, index: 1, cards: [] }]
        });
      const file = path.join(home, ".ilu", "boards.json");
      const before = fs.readFileSync(file, "utf8");
      const result = await captureIluScenario({
        testName: context.name,
        command: ["env", `HOME=${home}`, "node", path.join(installed, "bin/cli.js"), "board"],
        scenario: "cliExit",
        viewport: { cols: 140, rows: 40 }
      });
      assert.notEqual(result.exitCode, 0);
      assert.match(result.currentScreen, /cli-table/);
      assert.match(result.currentScreen, /ERR_PACKAGE_PATH_NOT_EXPORTED|exports|Cannot find/i);
      assert.doesNotMatch(result.currentScreen, /│.*Backlog.*│/);
      assert.equal(fs.readFileSync(file, "utf8"), before);
      assertCaptureArtifacts({
        result,
        checkpoints: ["cli-result"],
        testName: context.name,
        diagnostic: (message) => context.diagnostic(message)
      });
    },
    { prefix: "ilu-renderer-missing-dependency-", testName: context.name }
  );
});
