import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { assertRepoTempHome } from "../../support/home-sandbox.ts";
import { createCaptureScreenReader } from "./terminal-capture-screen.ts";

export async function runConcurrentClockAdds({ context, options, clickText, expectScreen }) {
  assert.equal(options.sessions, 4);
  assert.equal(options.rounds, 8);
  assert.equal(options.timezone, "Etc/UTC");
  assert.equal(options.synchronizeBeforeSave, true);
  const home = assertRepoTempHome(context.home, "Concurrent clock writers HOME");
  const workspace = path.dirname(path.dirname(home));
  const root = path.resolve(import.meta.dirname, "..", "..");
  const { launchTerminal } = await import("@valyrianjs/terminal/testing");
  const writers = [{ app: context.app, screen: context.screen }];
  const accepted = [];
  const rounds = [];
  const clockFile = path.join(home, ".ilu", "clocks.json");
  const initial = JSON.parse(fs.readFileSync(clockFile, "utf8"));
  assert.ok(Array.isArray(initial));
  try {
    for (let index = 1; index < options.sessions; index += 1) {
      const runName = `clock-writer-${index + 1}`;
      const directory = path.join(workspace, runName);
      context.additionalCaptureDirectories.push(directory);
      const app = await launchTerminal({
        command: ["env", `HOME=${home}`, "node", path.join(root, "bin", "cli.js"), "ui"],
        cwd: root,
        backend: "kitty",
        outputDir: workspace,
        runName,
        viewport: { cols: 80, rows: 24 },
        video: "off",
        timeoutMs: 8000
      });
      const writer = { app, screen: null };
      writers.push(writer);
      const reader = createCaptureScreenReader({ directory });
      writer.screen = async () => {
        const outputFile = path.join(directory, "terminal-output.bin");
        const deadline = Date.now() + 8000;
        let previous = -1;
        while (Date.now() < deadline) {
          const length = fs.statSync(outputFile).size;
          await delay(30);
          if (length === previous && length === fs.statSync(outputFile).size) {
            return reader.read();
          }
          previous = length;
        }
        throw new Error("The concurrent writer PTY did not settle");
      };
      await expectScreen({
        screen: writer.screen,
        predicate: (text) => text.includes("Add task"),
        message: "Each peer must mount the actual workspace before navigation"
      });
      await app.press("CTRL_4");
      await expectScreen({
        screen: writer.screen,
        predicate: (text) => text.includes("Add clock"),
        message: "Each real TUI writer must open Clocks"
      });
    }
    for (let round = 1; round <= options.rounds; round += 1) {
      const names = [];
      for (const [index, writer] of writers.entries()) {
        const name = options.nameTemplate.replace("{session}", String(index + 1)).replace("{round}", String(round));
        names.push(name);
        await clickText({ ...writer, text: "Add clock", area: "actions" });
        await writer.app.type(name);
        await clickText({ ...writer, text: "Time zone", rowOffset: 1, exact: true });
        await writer.app.type("utc");
        await clickText({ ...writer, text: "Etc/UTC", occurrence: -1 });
        await expectScreen({
          screen: writer.screen,
          predicate: (text) => text.includes(name) && text.includes("Clock name"),
          message: "All writers must prepare their actual forms before any save"
        });
      }
      await Promise.all(
        writers.map((writer) => clickText({ ...writer, text: "Add clock", area: "overlay", occurrence: -1 }))
      );
      const outcomes = [];
      for (const [index, writer] of writers.entries()) {
        const text = await expectScreen({
          screen: writer.screen,
          predicate: (text) => !text.includes("Clock name") || /couldn.t|could not|failed|try again/i.test(text),
          message: "Each concurrent save must expose acceptance or a visible rejection"
        });
        const saved = !text.includes("Clock name");
        if (saved) {
          accepted.push(names[index]);
        } else {
          assert.match(text, /couldn.t|could not|failed|try again/i);
        }
        const checkpoint = `writer-${index + 1}-round-${round}`;
        const file = await writer.app.screenshot({ name: checkpoint });
        if (index > 0) {
          context.registerAdditionalScreenshot({ name: checkpoint, file });
        }
        outcomes.push({ name: names[index], accepted: saved });
        if (!saved) {
          await writer.app.press("ESCAPE");
        }
      }
      const persisted = JSON.parse(fs.readFileSync(clockFile, "utf8"));
      assert.ok(Array.isArray(persisted), "Concurrent writes must preserve the legacy JSON array");
      assert.deepEqual(
        persisted.map((clock) => clock.name).sort(),
        [...initial.map((clock) => clock.name), ...accepted].sort(),
        `Round ${round}: persisted clocks must equal exactly the accepted additions`
      );
      assert.ok(
        outcomes.some((outcome) => outcome.accepted),
        `Round ${round} must make progress`
      );
      rounds.push(outcomes);
    }
    fs.writeFileSync(
      path.join(workspace, "clock-writers.json"),
      JSON.stringify({ sessions: writers.length, rounds, accepted }),
      { mode: 0o600, flag: "wx" }
    );
  } finally {
    const cleanup = await Promise.allSettled(
      writers.slice(1).map(async ({ app }) => {
        try {
          await app.press("ESCAPE");
          await app.press("CTRL_1");
          await app.press("CTRL_C");
          assert.equal(await app.waitForExit(), 0);
        } finally {
          await app.close();
        }
      })
    );
    const failures = cleanup.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length > 0) {
      throw new AggregateError(failures, "Concurrent TUI writers did not close normally");
    }
  }
}
