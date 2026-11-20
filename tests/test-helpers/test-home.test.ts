import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { TEST_TMP_ROOT, assertRepoTempHome, setTestHome, withTempHome } from "../../support/home-sandbox.ts";
import { captureIluScenario } from "./terminal-capture.ts";
import { assertCaptureArtifacts } from "./terminal-capture-scenarios.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

function startGuardedCli(entrypoint: string) {
  const script = `
    import fs from 'node:fs';
    import path from 'node:path';
    import { assertRepoTempHome } from './support/home-sandbox.ts';
    const home = assertRepoTempHome(process.env.HOME);
    const sentinel = path.join(home, 'guard-integration-sentinel');
    const stale = fs.existsSync(sentinel);
    fs.writeFileSync(sentinel, process.argv[1]);
    process.send({ home, stale });
    for await (const chunk of process.stdin) {
      throw new Error('Expected EOF, not fixture input');
    }
    process.argv.splice(1, 1, './bin/cli.js', '--version');
    await import('./bin/cli.js');
  `;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--import", "./support/test-home-guard.ts", "--input-type=module", "--eval", script, entrypoint],
    { cwd: repoRoot, env: { HOME: "", PATH: process.env.PATH ?? "" }, stdio: ["pipe", "pipe", "pipe", "ipc"] }
  );
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (output += chunk));
  const closed = once(child, "close").then(([code, signal]) => ({ code, signal, output }));
  const ready = Promise.race([
    once(child, "message").then(([message]) => ({
      kind: "ready" as const,
      ...(message as { home: string; stale: boolean })
    })),
    closed.then((result) => ({ kind: "closed" as const, ...result }))
  ]);
  return { finish: () => child.stdin.end(), closed, ready };
}

// The preload prepares synthetic persistence before invoking the real CLI.
// It validates HOME before any model import. It never renders a test report.
async function captureHomeTodo({ context, home, title, useGuard = false }) {
  const audit = path.join(assertRepoTempHome(home), "captured-home.json");
  const sandboxModule = pathToFileURL(path.join(repoRoot, "support", "home-sandbox.ts")).href;
  const guardModule = pathToFileURL(path.join(repoRoot, "support", "test-home-guard.ts")).href;
  const modelModule = pathToFileURL(path.join(repoRoot, "utils", "create-list-model.ts")).href;
  const preload = `
    import fs from 'node:fs';
    const {assertRepoTempHome, setTestHome} = await import(${JSON.stringify(sandboxModule)});
    ${
      useGuard
        ? `process.env.HOME = ${JSON.stringify(os.userInfo().homedir)}; await import(${JSON.stringify(guardModule)});`
        : `setTestHome(${JSON.stringify(home)});`
    }
    const activeHome = assertRepoTempHome(process.env.HOME);
    ${useGuard ? `if (fs.existsSync(activeHome + '/.ilu')) { throw new Error('Guard reused stale application data'); }` : ""}
    fs.writeFileSync(${JSON.stringify(audit)}, JSON.stringify({home: activeHome}));
    const {default: createListModel} = await import(${JSON.stringify(modelModule)});
    const todos = createListModel({dbName: 'todos', collectionName: 'todos', itemKey: 'tasks', itemHasCheck: true});
    todos.add({title: 'Isolation tasks', description: ''});
    todos.tasks.add({title: ${JSON.stringify(title)}, description: 'Synthetic isolation fixture', done: false});
  `;
  const result = await captureIluScenario({
    testName: context.name,
    command: [
      "node",
      "--import",
      "tsx",
      "--import",
      `data:text/javascript,${encodeURIComponent(preload)}`,
      path.join(repoRoot, "bin", "cli.js"),
      "todo"
    ],
    scenario: "cliExit",
    viewport: { cols: 100, rows: 30 }
  });
  assert.equal(result.exitCode, 0);
  assert.ok(result.currentScreen.includes(title), "the real CLI must read the fixture from the selected sandbox");
  const observedHome = JSON.parse(fs.readFileSync(audit, "utf8")).home;
  assertRepoTempHome(observedHome, "CLI HOME");
  assert.ok(fs.existsSync(path.join(observedHome, ".ilu", "todos.json")));
  assertCaptureArtifacts({
    result,
    checkpoints: ["cli-result"],
    testName: context.name,
    diagnostic: (message) => context.diagnostic(message)
  });
  return observedHome;
}

test("setTestHome rechaza usar el HOME real", async (context) => {
  await withTempHome(
    async (home) => {
      const before = process.env.HOME;
      assert.throws(() => setTestHome(os.userInfo().homedir), /real home/i);
      assert.equal(process.env.HOME, before, "rejected HOME must not change subsequent CLI storage");
      assert.equal(await captureHomeTodo({ context, home, title: "Rejected real home stays isolated" }), home);
    },
    { testName: context.name }
  );
});

test("assertRepoTempHome rechaza paths fuera de tmp del repo", async (context) => {
  await withTempHome(
    async (home) => {
      // A fictitious sibling of tmp is sufficient. No system directory is read.
      const outside = path.join(repoRoot, "not-a-test-home");
      assert.throws(() => assertRepoTempHome(outside, "Helper HOME"), /must live under/);
      assert.equal(process.env.HOME, home);
      assert.equal(await captureHomeTodo({ context, home, title: "Rejected outside path preserves sandbox" }), home);
    },
    { testName: context.name }
  );
});

test("assertRepoTempHome acepta paths bajo tmp del repo", async (context) => {
  await withTempHome(
    async (home) => {
      assert.equal(assertRepoTempHome(home, "Helper HOME"), home);
      assert.equal(path.relative(TEST_TMP_ROOT, home).startsWith(".."), false);
      assert.equal(await captureHomeTodo({ context, home, title: "Accepted private home is readable" }), home);
    },
    { testName: context.name }
  );
});

test("test-home-guard reemplaza HOME real por un sandbox bajo tmp del repo", async (context) => {
  const home = assertRepoTempHome(process.env.HOME);
  let firstHome = null;
  let firstEntries = null;
  for (let iteration = 1; iteration <= 2; iteration += 1) {
    const observedHome = await captureHomeTodo({
      context,
      home,
      title: `Guarded private home task ${iteration}`,
      useGuard: true
    });
    assert.notEqual(observedHome, os.userInfo().homedir);
    assert.notEqual(observedHome, home, "guard must replace the child real HOME, not inherit the test parent HOME");
    assertRepoTempHome(observedHome, "Guarded HOME");
    assert.equal(process.env.HOME, home, "child guard must not replace the parent HOME");
    const entries = fs.readdirSync(TEST_TMP_ROOT).sort();
    if (iteration === 1) {
      firstHome = observedHome;
      firstEntries = entries;
    } else {
      assert.equal(observedHome, firstHome, "the same CLI entrypoint must reuse its guarded HOME");
      assert.deepEqual(entries, firstEntries, "guarded CLI executions must not accumulate random HOME directories");
    }
    context.diagnostic(`Guard iteration ${iteration}: HOME=${observedHome}`);
  }
});

test("test-home-guard protege un HOME activo y deja avanzar otro entrypoint", async () => {
  const entrypoint = "tests/test-helpers/guard-isolation-owner.fixture";
  const owner = startGuardedCli(entrypoint);
  try {
    const held = await owner.ready;
    assert.equal(held.kind, "ready", JSON.stringify(held));
    if (held.kind !== "ready") {
      return;
    }
    const contender = startGuardedCli(entrypoint);
    const independent = startGuardedCli("tests/test-helpers/guard-isolation-independent.fixture");
    try {
      const observed = await Promise.race([
        Promise.all([contender.ready, independent.ready]),
        delay(10_000, null, { ref: false })
      ]);
      assert.ok(observed, "contention must resolve and a different entrypoint must start while the owner is live");
      const [collision, other] = observed;
      assert.equal(collision.kind, "closed", "the contender must not enter the active HOME");
      if (collision.kind === "closed") {
        assert.equal(collision.signal, null, collision.output);
        assert.notEqual(collision.code, 0, collision.output);
      }
      assert.equal(other.kind, "ready", JSON.stringify(other));
      if (other.kind === "ready") {
        assert.notEqual(other.home, held.home, "independent entrypoints must have distinct HOMEs");
      }
      assert.equal(fs.readFileSync(path.join(held.home, "guard-integration-sentinel"), "utf8"), entrypoint);
      independent.finish();
      const result = await independent.closed;
      assert.equal(result.code, 0, result.output);
    } finally {
      contender.finish();
      independent.finish();
      owner.finish();
      await Promise.all([contender.closed, independent.closed]);
    }
  } finally {
    owner.finish();
    await owner.closed;
  }
  const result = await owner.closed;
  assert.equal(result.code, 0, result.output);
});

test("test-home-guard recupera la misma ruta con un marcador legado abandonado", async () => {
  const entrypoint = "tests/test-helpers/guard-isolation-recovery.fixture";
  const first = startGuardedCli(entrypoint);
  first.finish();
  const original = await first.ready;
  const initialResult = await first.closed;
  assert.equal(initialResult.code, 0, initialResult.output);
  assert.equal(original.kind, "ready", JSON.stringify(original));
  if (original.kind !== "ready") {
    return;
  }
  // Reproduce the files left by the previous guard without signaling a process.
  const legacyMarker = path.join(original.home, ".active");
  const sentinel = path.join(original.home, "guard-integration-sentinel");
  fs.writeFileSync(sentinel, "synthetic abandoned data");
  fs.writeFileSync(legacyMarker, "active", { flag: "wx", mode: 0o600 });
  try {
    const next = startGuardedCli(entrypoint);
    next.finish();
    const recovered = await next.ready;
    const result = await next.closed;
    assert.equal(result.code, 0, `the abandoned HOME must be usable again: ${result.output}`);
    assert.deepEqual(recovered, { kind: "ready", home: original.home, stale: false });
  } finally {
    fs.rmSync(legacyMarker, { force: true });
  }
});

test("withTempHome usa HOME aislado y lo restaura al finalizar", async (context) => {
  const originalHome = process.env.HOME;
  const realHome = os.userInfo().homedir;
  let firstHome = null;
  let firstEntries = null;
  for (let iteration = 1; iteration <= 2; iteration++) {
    await withTempHome(
      async (home) => {
        if (iteration === 1) {
          firstHome = home;
          firstEntries = fs.readdirSync(TEST_TMP_ROOT).sort();
        } else {
          assert.equal(home, firstHome, "the same test must reuse its fixture HOME path");
          assert.deepEqual(
            fs.readdirSync(TEST_TMP_ROOT).sort(),
            firstEntries,
            "fixture HOMEs must not accumulate random directories"
          );
          assert.equal(fs.existsSync(path.join(home, "sentinel.txt")), false, "the previous fixture must be cleaned");
        }
        assert.notEqual(home, realHome);
        assert.equal(process.env.HOME, home);
        assert.equal(fs.existsSync(home), true);
        assert.equal(await captureHomeTodo({ context, home, title: `Stable home task ${iteration}` }), home);
        fs.writeFileSync(path.join(home, "sentinel.txt"), "Synthetic stale fixture");
      },
      { testName: context.name }
    );
    assert.equal(process.env.HOME, originalHome);
    assert.equal(fs.existsSync(firstHome), false, "fixture cleanup must finish before a repeated CLI run");
  }
});

test("withTempHome limpia el directorio temporal al terminar", async (context) => {
  let tempHomePath = "";
  await withTempHome(
    async (home) => {
      tempHomePath = home;
      fs.writeFileSync(path.join(home, "sentinel.txt"), "ok", "utf8");
      assert.equal(await captureHomeTodo({ context, home, title: "Temporary task before cleanup" }), home);
    },
    { testName: context.name }
  );
  assert.ok(tempHomePath.length > 0);
  assert.equal(fs.existsSync(tempHomePath), false, "cleanup must remove both sentinel and real CLI persistence");
});

test("setTestHome permite reinstalar el mismo HOME temporal sin confundirlo con el HOME real", async (context) => {
  await withTempHome(
    async (home) => {
      const restoreHome = setTestHome(home);
      try {
        assert.equal(process.env.HOME, home);
        assert.equal(await captureHomeTodo({ context, home, title: "Reinstalled temporary home task" }), home);
      } finally {
        restoreHome();
      }
      assert.equal(process.env.HOME, home);
    },
    { testName: context.name }
  );
});
