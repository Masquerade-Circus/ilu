import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withTempHome } from "../support/home-sandbox.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const cases = [
  // The actual search cannot return Mars/Olympus. The observable replacement
  // proves an invalid zone cannot be selected or persisted, not a private Intl call.
  { name: "clock valida timezone con Intl antes de persistir", action: "invalid-zone" },
  { name: "clock --show no limpia la terminal antes de renderizar los relojes", action: "show-canary" },
  { name: "clock --add usa búsqueda Valyrian con todos los timezones disponibles y resuelve alias utc", action: "add" },
  { name: "clock --remove sin posición permite eliminar múltiples relojes seleccionados", action: "remove-many" },
  { name: "clock --remove por posición mantiene fast path", action: "remove-position" },
  { name: "clock --priority reordena relojes guardados y show refleja el nuevo orden", action: "priority" },
  { name: "clock priority prompt construye choices para prompts nativos", action: "choices" },
  { name: "clock priority prompt rechaza destino decimal desde la validación del prompt", action: "invalid-position" },
  { name: "clock actions enruta opts.priority antes del show por defecto", action: "priority" },
  { name: "clock --priority no intenta reordenar cuando hay menos de dos relojes", action: "single-clock" },
  { name: "clock show lista todos los relojes con hora antes del nombre y timezone", action: "show" }
];

for (const entry of cases) {
  test(entry.name, { concurrency: false }, async (context) => {
    await withTempHome(
      async (home) => {
        const file = path.join(home, ".ilu", "clocks.json");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const clocks = [
          { name: "CDMX", timezone: "America/Mexico_City" },
          { name: "Madrid", timezone: "Europe/Madrid" },
          { name: "UTC", timezone: "Etc/UTC" }
        ].slice(0, entry.action === "single-clock" ? 1 : 3);
        fs.writeFileSync(file, JSON.stringify(clocks));
        const before = fs.readFileSync(file, "utf8");
        const steps: Record<string, string>[] = [];
        let args = ["clock"];
        if (entry.action === "invalid-zone" || entry.action === "add") {
          args.push("--add");
          steps.push(
            { waitFor: "Search and select a timezone" },
            { type: entry.action === "add" ? "utc" : "Mars/Olympus" }
          );
          if (entry.action === "add") {
            steps.push(
              { checkpoint: "zone-search" },
              { press: "ENTER" },
              { waitFor: "Name of the clock" },
              { type: "Universal" },
              { checkpoint: "clock-name" },
              { press: "ENTER" }
            );
          } else {
            steps.push({ waitFor: "No matching", flags: "i" }, { checkpoint: "invalid-zone" }, { press: "CTRL_C" });
          }
        }
        if (entry.action === "priority" || entry.action === "choices" || entry.action === "invalid-position") {
          args.push("--priority");
          steps.push(
            { waitFor: "Select the clock to move" },
            { checkpoint: "clock-choices" },
            { type: "UTC" },
            { press: "ENTER" },
            { waitFor: "to position" },
            { press: "CTRL_A" },
            { type: entry.action === "invalid-position" ? "1.5" : "1" },
            { press: "ENTER" }
          );
          if (entry.action === "invalid-position") {
            steps.push(
              { waitFor: "whole|integer", flags: "i" },
              { checkpoint: "invalid-position" },
              { press: "CTRL_C" }
            );
          }
        }
        if (entry.action === "single-clock") {
          args.push("--priority");
        }
        if (entry.action === "remove-position") {
          args.push("--remove", "2");
        }
        if (entry.action === "remove-many") {
          args.push("--remove");
          steps.push(
            { waitFor: "Select clocks to remove" },
            { press: "SPACE" },
            { press: "DOWN" },
            { press: "DOWN" },
            { press: "SPACE" },
            { checkpoint: "clock-selection" },
            { press: "ENTER" }
          );
        }
        const bin = path.resolve(import.meta.dirname, "..", "bin/cli.js");
        const command =
          entry.action === "show-canary"
            ? [
                "env",
                `HOME=${home}`,
                "sh",
                "-c",
                'printf "Preexisting clock content\\n"; exec node "$1" clock',
                "ilu-capture",
                bin
              ]
            : ["env", `HOME=${home}`, "node", bin, ...args];
        const result = await captureIluScenario({
          testName: context.name,
          command,
          scenario: "cliScript",
          input: { steps },
          viewport: { cols: 120, rows: 38 }
        });
        const invalid = entry.action === "invalid-zone" || entry.action === "invalid-position";
        assert.equal(result.exitCode, invalid ? 1 : 0);
        const saved = JSON.parse(fs.readFileSync(file, "utf8"));
        if (invalid || entry.action.startsWith("show") || entry.action === "single-clock") {
          assert.equal(fs.readFileSync(file, "utf8"), before);
        }
        if (entry.action === "add") {
          assert.deepEqual(saved, [...clocks, { name: "Universal", timezone: "Etc/UTC" }]);
          assert.match(result.frames["zone-search"], /Etc\/UTC/);
          assert.match(result.currentScreen, /Universal/);
        }
        if (entry.action === "remove-many") {
          assert.deepEqual(saved, [clocks[1]]);
          assert.match(result.currentScreen, /Madrid/);
        }
        if (entry.action === "remove-position") {
          assert.deepEqual(saved, [clocks[0], clocks[2]]);
        }
        if (entry.action === "priority" || entry.action === "choices") {
          assert.deepEqual(saved, [clocks[2], clocks[0], clocks[1]]);
          assert.ok(result.currentScreen.indexOf("UTC") < result.currentScreen.indexOf("CDMX"));
          assert.ok(result.currentScreen.indexOf("CDMX") < result.currentScreen.indexOf("Madrid"));
        }
        if (entry.action === "choices") {
          for (const clock of clocks) {
            assert.ok(result.frames["clock-choices"].includes(clock.name));
            assert.ok(result.frames["clock-choices"].includes(clock.timezone));
          }
        }
        if (entry.action === "single-clock") {
          assert.match(result.currentScreen, /at least two clocks/i);
          assert.match(result.currentScreen, /CDMX/);
          assert.doesNotMatch(result.currentScreen, /to position/);
        }
        if (entry.action === "show-canary") {
          assert.match(result.currentScreen, /Preexisting clock content/);
        }
        if (entry.action.startsWith("show")) {
          for (const clock of clocks) {
            const line = result.currentScreen.split("\n").find((line) => line.includes(clock.name));
            assert.equal(typeof line, "string");
            assert.match(line, /\d{1,2}:\d{2}:\d{2}/);
            assert.ok(line.search(/\d{1,2}:\d{2}:\d{2}/) < line.indexOf(clock.name));
            assert.ok(line.indexOf(clock.name) < line.indexOf(clock.timezone));
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
      { prefix: "ilu-clocks-physical-", testName: context.name }
    );
  });
}
