import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { assertRepoTempHome } from "../../support/home-sandbox.ts";
import { prepareSyncCapture } from "./terminal-capture-sync.ts";

const root = path.resolve(import.meta.dirname, "..", "..");

export function prepareCliSequence({ workspaceRoot, input }) {
  const home = assertRepoTempHome(path.join(workspaceRoot, "capture", "home"));
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  execFileSync(
    process.execPath.endsWith("bun") ? "node" : process.execPath,
    ["--import", "tsx", path.join(import.meta.dirname, "terminal-capture-home.ts")],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        ILU_CAPTURE_EMPTY_HOME: "1",
        ILU_CAPTURE_SEED_JSON: JSON.stringify(input.syncFixture?.base ?? input.seed)
      },
      stdio: "pipe"
    }
  );
  for (const [relative, contents] of Object.entries(input.files)) {
    const file = path.resolve(home, relative);
    assert.ok(
      path.relative(home, file).length > 0 && !path.relative(home, file).startsWith("..") && !path.isAbsolute(relative),
      "CLI fixtures must stay in the private HOME"
    );
    assert.equal(typeof contents, "string");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, { mode: 0o600 });
  }
  let sync = null;
  if (input.syncFixture !== null) {
    sync = prepareSyncCapture({
      workspaceRoot,
      fixture: { remote: "empty", initialize: true, config: input.syncFixture.config }
    });
    if (typeof input.syncFixture.remote === "object") {
      advanceCliRemote({ sync, data: input.syncFixture.remote, commitMessage: "Remote fixture update" });
    }
    if (typeof input.syncFixture.local === "object") {
      execFileSync("node", ["--import", "tsx", path.join(import.meta.dirname, "terminal-capture-home.ts")], {
        cwd: root,
        env: {
          ...sync.environment,
          ILU_CAPTURE_EMPTY_HOME: "1",
          ILU_CAPTURE_SEED_JSON: JSON.stringify(input.syncFixture.local)
        },
        stdio: "pipe"
      });
      execFileSync("git", ["add", "-A"], { cwd: sync.storageRoot, env: sync.environment, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "Local fixture update"], {
        cwd: sync.storageRoot,
        env: sync.environment,
        stdio: "pipe"
      });
    }
  }
  return { home, sync };
}

function advanceCliRemote({ sync, data, commitMessage }) {
  execFileSync("node", ["--import", "tsx", path.join(import.meta.dirname, "terminal-capture-home.ts")], {
    cwd: root,
    env: {
      ...sync.environment,
      HOME: sync.externalHome,
      ILU_CAPTURE_EMPTY_HOME: "1",
      ILU_CAPTURE_SEED_JSON: JSON.stringify(data)
    },
    stdio: "pipe"
  });
  for (const args of [
    ["add", "-A"],
    ["commit", "-m", commitMessage],
    ["push", "origin", "main"]
  ]) {
    execFileSync("git", args, { cwd: sync.externalWriterPath, env: sync.environment, stdio: "pipe" });
  }
}

export async function runCliSequence({ app, screen, home, workspaceRoot, expectScreen, input, sync }) {
  const quote = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`;
  const readFiles = () =>
    Object.fromEntries(
      input.watchedFiles.map((relative) => {
        const file = path.resolve(home, relative);
        assert.ok(path.relative(home, file).length > 0 && !path.relative(home, file).startsWith(".."));
        return [relative, fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null];
      })
    );
  const initialFiles = readFiles();
  const observations = [];
  await app.type("stty -echo; PS1=''; printf '\\033[2J\\033[H'");
  await app.press("ENTER");
  await screen();
  for (const [index, command] of input.commands.entries()) {
    for (const operation of command.before ?? []) {
      assert.ok(sync !== null && typeof operation.advanceRemote === "object", "Expected a private remote update");
      advanceCliRemote({ sync, ...operation.advanceRemote });
    }
    const statusPath = path.join(workspaceRoot, `cli-${index + 1}.status`);
    const environment = Object.entries(input.env).map(([key, value]) => {
      assert.match(key, /^[A-Za-z_][A-Za-z0-9_]*$/);
      assert.ok(
        !["HOME", "DISPLAY", "NODE_OPTIONS", "ILU_CAPTURE_HTTP_CONFIG"].includes(key),
        "CLI fixture cannot override isolation"
      );
      return `${key}=${quote(value)}`;
    });
    const args = ["node", input.cli, ...command.args].map(quote).join(" ");
    const script = path.join(workspaceRoot, `cli-${index + 1}.sh`);
    fs.writeFileSync(
      script,
      `cd ${quote(home)}\nprintf '\\033[2J\\033[H'\n${environment.join(" ")} ILU_CAPTURE_HTTP_INDEX=${index} ${args}\nprintf '%s' "$?" > ${quote(statusPath)}\n`,
      { mode: 0o600, flag: "wx" }
    );
    await app.type(`. ../../cli-${index + 1}.sh`);
    await app.press("ENTER");
    for (const step of command.steps ?? []) {
      assert.equal(Object.keys(step).length, 1, "CLI sequence steps require one operation");
      if (typeof step.waitFor === "string") {
        await expectScreen((text) => text.includes(step.waitFor), `Expected current CLI state: ${step.waitFor}`);
      } else if (typeof step.key === "string") {
        await app.press(step.key);
      } else if (typeof step.text === "string") {
        await app.type(step.text);
      } else if (typeof step.capture === "string") {
        await screen();
        await app.screenshot({ name: step.capture });
      } else {
        throw new Error(`Unsupported CLI sequence step: ${JSON.stringify(step)}`);
      }
    }
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(statusPath)) {
      assert.ok(Date.now() < deadline, "The real CLI command must finish normally");
      await delay(30);
    }
    observations.push({
      exitCode: Number(fs.readFileSync(statusPath, "utf8")),
      currentScreen: await screen(),
      files: readFiles()
    });
    await app.screenshot({ name: `cli-${index + 1}` });
  }
  await app.type("exit");
  await app.press("ENTER");
  assert.equal(await app.waitForExit(), 0);
  return { home, initialFiles, observations };
}
