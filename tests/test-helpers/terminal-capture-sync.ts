import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { assertRepoTempHome } from "../../support/home-sandbox.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const cli = path.join(root, "bin", "cli.js");
const modelPath = path.join(root, "utils", "create-list-model.ts");

export function prepareSyncCapture({ workspaceRoot, fixture }) {
  const home = assertRepoTempHome(path.join(workspaceRoot, "capture", "home"), "Sync capture HOME");
  const storageRoot = path.join(home, ".ilu");
  const remotePath = path.join(workspaceRoot, "remote.git");
  const externalHome = path.join(workspaceRoot, "external-writer");
  const externalWriterPath = path.join(externalHome, ".ilu");
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const gitConfig = path.join(workspaceRoot, "gitconfig");
  fs.writeFileSync(gitConfig, "", { mode: 0o600 });
  const environment = {
    PATH: process.env.PATH,
    LANG: "C.UTF-8",
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_ALLOW_PROTOCOL: "file",
    GIT_AUTHOR_NAME: "ilu capture",
    GIT_AUTHOR_EMAIL: "capture@ilu.local",
    GIT_COMMITTER_NAME: "ilu capture",
    GIT_COMMITTER_EMAIL: "capture@ilu.local",
    GIT_TERMINAL_PROMPT: "0"
  };
  const git = (args, cwd = workspaceRoot) =>
    execFileSync("git", args, { cwd, env: environment, encoding: "utf8", stdio: "pipe" }).trim();
  git(["init", "--bare", "--initial-branch=main", remotePath]);
  for (const key of Object.keys(fixture)) {
    assert.ok(
      ["remote", "local", "remoteData", "initialize", "config"].includes(key),
      `Unsupported Sync fixture requirement: ${key}`
    );
  }
  assert.equal(fixture.remote, "empty", "This capture fixture requires an empty private remote");
  for (const [domain, title] of Object.entries(fixture.local ?? {})) {
    assert.ok(["todos", "notes"].includes(domain), `Unsupported Sync seed domain: ${domain}`);
    const source = `import createListModel from ${JSON.stringify(modelPath)};
      const model = createListModel({ dbName: ${JSON.stringify(domain)}, collectionName: ${JSON.stringify(domain)}, itemKey: ${JSON.stringify(domain === "todos" ? "tasks" : "notes")}, itemHasCheck: ${domain === "todos"} });
      model.add({ title: ${JSON.stringify(title)}, description: "" });`;
    execFileSync("node", ["--import", "tsx", "--input-type=module", "-e", source], {
      cwd: root,
      env: environment,
      stdio: "pipe"
    });
  }
  if (fixture.initialize === true) {
    execFileSync("node", [cli, "sync", "init", "--remote", remotePath], { cwd: root, env: environment, stdio: "pipe" });
    const configPath = path.join(storageRoot, ".config", "sync-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    fs.writeFileSync(configPath, JSON.stringify({ ...config, ...fixture.config }), { mode: 0o600 });
    fs.mkdirSync(externalHome, { mode: 0o700 });
    git(["clone", remotePath, externalWriterPath]);
  }
  return { workspaceRoot, home, storageRoot, remotePath, externalHome, externalWriterPath, environment };
}

export async function runSyncWorkflow({ app, screen, syncFixture, click, expectScreen }, { steps }) {
  const { workspaceRoot, home, storageRoot, remotePath, externalHome, externalWriterPath, environment } = syncFixture;
  const at = {};
  let commandNumber = 0;
  let activeUI = null;
  const quote = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`;
  const git = (args, cwd = workspaceRoot) => spawnSync("git", args, { cwd, env: environment, encoding: "utf8" });
  const runGit = (args, cwd) => {
    const result = git(args, cwd);
    assert.equal(result.status, 0, `Private fixture Git failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  const waitForStatus = async (file) => {
    const deadline = Date.now() + 12000;
    while (!fs.existsSync(file)) {
      assert.ok(Date.now() < deadline, "The real CLI command did not finish");
      await delay(20);
    }
    return Number(fs.readFileSync(file, "utf8"));
  };
  const sendCommand = async (args, interactive = false) => {
    const status = path.join(workspaceRoot, `command-status-${++commandNumber}`);
    const command = ["node", cli, ...args].map(quote).join(" ");
    await app.type(`printf '\\033[2J\\033[H'; ${command}; printf '%s' "$?" > ${quote(status)}`);
    await app.press("ENTER");
    if (interactive) {
      activeUI = status;
      await expectScreen((text) => text.includes("Add task"), "The real Sync workspace must start");
      return null;
    }
    return waitForStatus(status);
  };
  const observe = async (name, exitCode = null) => {
    const files = {};
    const remoteFiles = {};
    for (const file of [
      "todos.json",
      "notes.json",
      "boards.json",
      "clocks.json",
      ".config/sync-config.json",
      ".config/sync-pending.json",
      ".sync-core/state.json"
    ]) {
      const localFile = path.join(storageRoot, file);
      files[file] = fs.existsSync(localFile) ? fs.readFileSync(localFile, "utf8") : null;
      const remote = git(["--git-dir", remotePath, "show", `main:${file}`]);
      remoteFiles[file] = remote.status === 0 ? remote.stdout : null;
    }
    const head = git(["--git-dir", remotePath, "rev-parse", "refs/heads/main"]);
    const observation = {
      exitCode,
      screen: await screen(),
      files,
      remoteFiles,
      remoteHead: head.status === 0 ? head.stdout.trim() : null,
      isGitRepository: fs.existsSync(path.join(storageRoot, ".git")),
      storageRoot,
      remotePath,
      externalWriterPath
    };
    if (typeof name === "string") {
      at[name] = observation;
      await app.screenshot({ name });
    }
    return observation;
  };
  await app.type("stty -echo; PS1=''; printf '\\033[2J\\033[H'");
  await app.press("ENTER");
  await screen();
  for (const step of steps) {
    switch (step.action) {
      case "cli": {
        assert.equal(activeUI, null, "CLI commands require a closed TUI");
        const args = step.args.map((arg) => (arg === "$REMOTE" ? remotePath : arg));
        const exitCode = await sendCommand(args);
        await observe(step.name, exitCode);
        break;
      }
      case "open":
        assert.equal(activeUI, null, "Only one TUI may use a fixture at a time");
        await sendCommand(["ui"], true);
        if (step.view !== "Todo") {
          await click(step.view);
        }
        break;
      case "observe":
        await observe(step.name);
        break;
      case "external-writer": {
        assert.equal(step.domain, "todos", "Unsupported external-writer domain");
        runGit(["pull", "--ff-only", "origin", "main"], externalWriterPath);
        const source = `import createListModel from ${JSON.stringify(modelPath)};
          const model = createListModel({ dbName: "todos", collectionName: "todos", itemKey: "tasks", itemHasCheck: true });
          const list = model.getCurrent(); Object.assign(list, ${JSON.stringify(step.values)}); model.save(list);`;
        execFileSync("node", ["--import", "tsx", "--input-type=module", "-e", source], {
          cwd: root,
          env: { ...environment, HOME: externalHome },
          stdio: "pipe"
        });
        if (step.publish === true) {
          runGit(["add", "todos.json"], externalWriterPath);
          runGit(["commit", "-m", "external fixture revision"], externalWriterPath);
          runGit(["push", "origin", "main"], externalWriterPath);
        }
        fs.copyFileSync(path.join(externalWriterPath, "todos.json"), path.join(storageRoot, "todos.json"));
        await observe(step.name);
        break;
      }
      case "ui":
        assert.notEqual(activeUI, null, "A physical TUI must be open");
        if (step.operation === "add-task") {
          await click("Add task");
          await app.type(step.title);
          await click("Save");
          await screen();
        } else if (step.operation === "dismiss-notice") {
          await app.press("ESCAPE");
          await screen();
        } else if (step.operation === "switch-view") {
          await click(step.view);
        } else {
          throw new Error(`Unsupported Sync UI operation: ${step.operation}`);
        }
        break;
      case "wait-recovery": {
        await expectScreen(
          (text) => /repeat|retry|changed|conflict/i.test(text),
          "The stale mutation must report recovery"
        );
        const deadline = Date.now() + 12000;
        while (true) {
          const observed = await observe(null);
          const state = JSON.parse(observed.files[".sync-core/state.json"]);
          if (
            state.status === "healthy" &&
            state.lastSyncReason === "revision-conflict" &&
            observed.files[".config/sync-pending.json"] === null &&
            observed.files["todos.json"] === observed.remoteFiles["todos.json"]
          ) {
            break;
          }
          assert.ok(Date.now() < deadline, "The current external snapshot was not reconciled before retry");
          await delay(50);
        }
        await observe(step.name);
        break;
      }
      case "settle-sync": {
        const deadline = Date.now() + 12000;
        while (true) {
          const state = await observe(null);
          if (
            state.files["todos.json"] === state.remoteFiles["todos.json"] &&
            state.files[".config/sync-pending.json"] === null
          ) {
            break;
          }
          assert.ok(Date.now() < deadline, "The actual private remote did not receive the saved data");
          await delay(50);
        }
        await observe(step.name);
        break;
      }
      case "exit":
        if (activeUI !== null) {
          await click("Todo");
          await app.press("CTRL_C");
          assert.equal(await waitForStatus(activeUI), 0, "The real TUI must exit normally");
          activeUI = null;
        }
        await app.type("exit");
        await app.press("ENTER");
        break;
      default:
        throw new Error(`Unsupported Sync workflow operation: ${step.action}`);
    }
  }
  return { at, home, workspaceRoot, exitCode: await app.waitForExit() };
}
