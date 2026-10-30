import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { withTempHome } from "../support/home-sandbox.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";
const repoRoot = path.resolve(import.meta.dirname, "..");
const packageVersion = (JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string })
  .version;

test("node bin/cli.js --help arranca correctamente", async (context) => {
  const result = await captureIluScenario({
    testName: context.name,
    command: ["node", path.join(repoRoot, "bin/cli.js"), "--help"],
    scenario: "cliExit",
    viewport: { cols: 120, rows: 48 }
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.currentScreen, /\btodo\b/);
  assert.match(result.currentScreen, /\bnote\b/);
  assert.match(result.currentScreen, /\bboard\b/);
  assertCaptureArtifacts({
    result,
    checkpoints: ["cli-result"],
    testName: context.name,
    diagnostic: (message) => context.diagnostic(message)
  });
});

test("node bin/cli.js --version imprime la versión del paquete", async (context) => {
  const result = await captureIluScenario({
    testName: context.name,
    command: ["node", path.join(repoRoot, "bin/cli.js"), "--version"],
    scenario: "cliExit",
    viewport: { cols: 80, rows: 24 }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.currentScreen.trim(), packageVersion);
  assertCaptureArtifacts({
    result,
    checkpoints: ["cli-result"],
    testName: context.name,
    diagnostic: (message) => context.diagnostic(message)
  });
});

test("node bin/cli.js resuelve tsx desde un layout instalado con dependencias hoisted", async (context) => {
  await withTempHome(
    async (installRoot) => {
      const packageRoot = path.join(installRoot, "package");

      fs.mkdirSync(packageRoot);

      for (const entryName of fs.readdirSync(repoRoot)) {
        if (entryName === ".git" || entryName === "node_modules" || entryName === "tmp" || entryName === ".tmp") {
          continue;
        }

        fs.cpSync(path.join(repoRoot, entryName), path.join(packageRoot, entryName), {
          recursive: true
        });
      }

      fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(installRoot, "node_modules"), "dir");

      const result = await captureIluScenario({
        testName: context.name,
        command: ["node", path.join(packageRoot, "bin/cli.js"), "--version"],
        cwd: installRoot,
        scenario: "cliExit",
        viewport: { cols: 80, rows: 24 }
      });

      assert.equal(result.exitCode, 0);
      assert.equal(result.currentScreen.trim(), packageVersion);
      assert.equal(
        fs.existsSync(path.join(packageRoot, "node_modules")),
        false,
        "dependencies must remain hoisted, not copied into the installed package"
      );
      assertCaptureArtifacts({
        result,
        checkpoints: ["cli-result"],
        testName: context.name,
        diagnostic: (message) => context.diagnostic(message)
      });
    },
    { prefix: "ilu-cli-hoisted-", testName: context.name }
  );
});

test("node bin/cli.js rechaza flags desconocidos sin stack trace", async (context) => {
  const result = await captureIluScenario({
    testName: context.name,
    command: ["node", path.join(repoRoot, "bin/cli.js"), "--unknown-startup-flag"],
    scenario: "cliExit",
    viewport: { cols: 120, rows: 24 }
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.currentScreen, /unknown option/i);
  assert.match(result.currentScreen, /--unknown-startup-flag/);
  assert.doesNotMatch(fs.readFileSync(result.outputPath, "utf8"), /at .*\(/);
  assertCaptureArtifacts({
    result,
    checkpoints: ["cli-result"],
    testName: context.name,
    diagnostic: (message) => context.diagnostic(message)
  });
});

test("node bin/cli.js preserva cwd externo del usuario al resolver rutas relativas de tts", async (context) => {
  await withTempHome(
    async (externalCwd) => {
      const document = path.join(externalCwd, "chapter.md");
      const content = "Synthetic document. Must not be overwritten or sent to a provider.\n";
      fs.writeFileSync(document, content);
      const result = await captureIluScenario({
        testName: context.name,
        command: ["node", path.join(repoRoot, "bin/cli.js"), "tts", "chapter.md", "chapter.md"],
        cwd: externalCwd,
        scenario: "cliExit",
        viewport: { cols: 120, rows: 24 }
      });

      assert.equal(result.exitCode, 1);
      assert.match(result.currentScreen, /output file must be different from input file/i);
      assert.doesNotMatch(result.currentScreen, /Input file not found/i);
      assert.doesNotMatch(result.currentScreen, /ERR_MODULE_NOT_FOUND/i);
      assert.equal(
        fs.readFileSync(document, "utf8"),
        content,
        "rejecting the destination must preserve the source document"
      );
      assertCaptureArtifacts({
        result,
        checkpoints: ["cli-result"],
        testName: context.name,
        diagnostic: (message) => context.diagnostic(message)
      });
    },
    { prefix: "ilu-cli-cwd-", testName: context.name }
  );
});
