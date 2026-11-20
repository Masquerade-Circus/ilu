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
      [
        "remote",
        "local",
        "remoteData",
        "initialize",
        "config",
        "excludedFiles",
        "transport",
        "denyExternalTransport",
        "ssh",
        "homeCanary",
        "removeCoreState",
        "legacyState",
        "coreState",
        "pendingData"
      ].includes(key),
      `Unsupported Sync fixture requirement: ${key}`
    );
  }
  assert.ok(["empty", "seeded", "none"].includes(fixture.remote), "Unsupported private remote fixture");
  const seed = (data, targetHome) => {
    const records = {};
    for (const [domain, value] of Object.entries(data)) {
      if (domain === "card") {
        continue;
      }
      assert.ok(["todos", "notes", "boards", "clocks"].includes(domain), `Unsupported Sync seed domain: ${domain}`);
      records[domain] =
        typeof value === "string"
          ? [
              {
                title: value,
                current: true,
                ...(domain === "boards"
                  ? {
                      columns: [
                        {
                          id: "backlog",
                          title: "Backlog",
                          cards: typeof data.card === "string" ? [{ title: data.card }] : []
                        },
                        { id: "ready", title: "Ready", cards: [] }
                      ]
                    }
                  : {})
              }
            ]
          : value;
    }
    if (Object.keys(records).length === 0) {
      return;
    }
    fs.mkdirSync(path.join(targetHome, ".ilu"), { recursive: true, mode: 0o700 });
    execFileSync("node", ["--import", "tsx", path.join(import.meta.dirname, "terminal-capture-home.ts")], {
      cwd: root,
      env: {
        ...environment,
        HOME: targetHome,
        ILU_CAPTURE_EMPTY_HOME: "1",
        ILU_CAPTURE_SEED_JSON: JSON.stringify(records)
      },
      stdio: "pipe"
    });
  };
  // Task/Note mutation journeys need current lists before the captured action.
  // Bootstrap-from-empty journeys do not set initialize and remain empty.
  const existingData = ["todos", "notes", "boards", "clocks"].some((domain) =>
    fs.existsSync(path.join(storageRoot, `${domain}.json`))
  );
  seed(fixture.local ?? (fixture.initialize === true && !existingData ? { todos: "Inbox", notes: "Notes" } : {}), home);
  const excludedFiles = Object.keys(fixture.excludedFiles ?? {});
  for (const [relative, contents] of Object.entries(fixture.excludedFiles ?? {})) {
    const file = path.resolve(storageRoot, relative);
    assert.ok(
      !path.isAbsolute(relative) &&
        path.relative(storageRoot, file).length > 0 &&
        !path.relative(storageRoot, file).startsWith("..")
    );
    assert.equal(typeof contents, "string");
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, contents, { mode: 0o600 });
  }
  if (fixture.remote === "seeded") {
    seed(fixture.remoteData, externalHome);
    git(["init", "--initial-branch=main"], externalWriterPath);
    git(["add", "-A"], externalWriterPath);
    git(["commit", "-m", "Synthetic remote seed"], externalWriterPath);
    git(["remote", "add", "origin", remotePath], externalWriterPath);
    git(["push", "origin", "main"], externalWriterPath);
  }
  if (fixture.initialize === true) {
    execFileSync("node", [cli, "sync", "init", "--remote", remotePath], { cwd: root, env: environment, stdio: "pipe" });
    const configPath = path.join(storageRoot, ".config", "sync-config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    fs.writeFileSync(configPath, JSON.stringify({ ...config, ...fixture.config }), { mode: 0o600 });
    if (!fs.existsSync(externalWriterPath)) {
      fs.mkdirSync(externalHome, { mode: 0o700 });
      git(["clone", remotePath, externalWriterPath]);
    }
  } else if (typeof fixture.config === "object") {
    const configPath = path.join(storageRoot, ".config", "sync-config.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(fixture.config), { mode: 0o600 });
  }
  if (Object.hasOwn(fixture, "pendingData")) {
    assert.ok(
      typeof fixture.pendingData === "object" && fixture.pendingData !== null && !Array.isArray(fixture.pendingData)
    );
    seed(fixture.pendingData, home);
  }
  const statePath = path.join(storageRoot, ".sync-core", "state.json");
  if (fixture.removeCoreState === true) {
    assert.ok(fs.lstatSync(statePath).isFile());
    fs.unlinkSync(statePath);
  }
  if (typeof fixture.coreState === "object") {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    fs.writeFileSync(statePath, JSON.stringify({ ...state, ...fixture.coreState }), { mode: 0o600 });
  }
  if (typeof fixture.legacyState === "object") {
    const legacyPath = path.join(storageRoot, ".config", "sync-state.json");
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(legacyPath, JSON.stringify(fixture.legacyState), { mode: 0o600 });
  }
  const canaryPath = path.join(workspaceRoot, "home-canary", ".ilu", ".config", "sync-config.json");
  if (fixture.homeCanary === true) {
    fs.mkdirSync(path.dirname(canaryPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(canaryPath, JSON.stringify({ synthetic: "separate HOME must stay untouched" }), { mode: 0o600 });
  }
  const canaryBefore = fixture.homeCanary === true ? fs.readFileSync(canaryPath, "utf8") : null;
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const transportDirectory = path.join(workspaceRoot, "git-transport");
  fs.mkdirSync(transportDirectory, { mode: 0o700 });
  const transportConfig = path.join(transportDirectory, "config.json");
  const transportLog = path.join(transportDirectory, "events.jsonl");
  fs.writeFileSync(transportLog, "", { mode: 0o600 });
  fs.writeFileSync(
    transportConfig,
    JSON.stringify({
      mode: fixture.transport?.arm === "after-open" ? "healthy" : (fixture.transport?.mode ?? "healthy"),
      gate: fixture.transport?.arm === "after-open" ? null : (fixture.transport?.gate ?? null),
      deny: fixture.denyExternalTransport === true,
      sshRemote: fixture.ssh === "local-boundary" ? "ssh://git@ilu-sync.invalid/repo.git" : null,
      stdout: fixture.transport?.stdout ?? "",
      stderr: fixture.transport?.stderr ?? ""
    }),
    { mode: 0o600 }
  );
  fs.writeFileSync(
    path.join(transportDirectory, "git"),
    `#!/usr/bin/env -S -u NODE_OPTIONS node
import fs from "node:fs";
import {spawnSync} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
const args = process.argv.slice(2);
const operation = args.find(arg => ["fetch", "push", "pull", "ls-remote", "clone"].includes(arg));
const configPath = ${JSON.stringify(transportConfig)};
const log = ${JSON.stringify(transportLog)};
let config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const startedAt = Date.now();
const boundary = typeof config.sshRemote === "string" ? {protocol: "ssh", local: true} : {};
if (operation) {
  fs.appendFileSync(log, JSON.stringify({id: process.pid, operation, startedAt, gated: config.gate === operation, ...boundary}) + "\\n");
  const release = ${JSON.stringify(transportDirectory)} + "/release-" + process.pid;
  while (config.gate === operation && !fs.existsSync(release)) {
    await delay(20);
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
  if (fs.existsSync(release)) {
    config = {...config, ...JSON.parse(fs.readFileSync(release, "utf8"))};
  }
}
const failure = operation && ((config.deny && typeof config.sshRemote !== "string") || config.mode !== "healthy");
const message = config.mode === "auth-failure" ? "fatal: Authentication failed" : config.mode === "network-failure" ? "fatal: Could not resolve host: controlled.invalid" : "fatal: Controlled backend failure";
const gitArgs = typeof config.sshRemote === "string" ? ["-c", ${JSON.stringify(`url.${remotePath}.insteadOf=`)} + config.sshRemote, ...args] : args;
const result = failure ? {status: 128, stdout: config.stdout, stderr: message + "\\n" + config.stderr} : spawnSync(${JSON.stringify(realGit)}, gitArgs, {encoding: "utf8"});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (operation) {
  fs.appendFileSync(log, JSON.stringify({id: process.pid, operation, startedAt, finishedAt: Date.now(), stderr: result.stderr ?? "", exitCode: result.status}) + "\\n");
}
process.exitCode = result.status ?? 1;
`,
    { mode: 0o700 }
  );
  environment.PATH = `${transportDirectory}:${environment.PATH}`;
  return {
    workspaceRoot,
    home,
    storageRoot,
    remotePath,
    externalHome,
    externalWriterPath,
    environment,
    realGit,
    transportDirectory,
    transportConfig,
    transportLog,
    fixture,
    excludedFiles,
    canaryPath,
    canaryBefore
  };
}

export async function runSyncWorkflow({ app, screen, output, syncFixture, click, expectScreen }, { steps }) {
  const { workspaceRoot, home, storageRoot, remotePath, externalHome, externalWriterPath, environment } = syncFixture;
  const at = {};
  let commandNumber = 0;
  let activeUI = null;
  let activeCommand = null;
  let lastUI = null;
  let lastMutationAt = null;
  let lastBackoffUntil = null;
  let stateFaultActive = false;
  const runtimeDirectory = path.join(storageRoot, ".sync-core");
  const runtimeBackup = path.join(workspaceRoot, "runtime-state-backup");
  // The script runs under POSIX sh. Single quotes preserve literal line breaks.
  const quote = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`;
  const git = (args, cwd = workspaceRoot) =>
    spawnSync(syncFixture.realGit, args, { cwd, env: environment, encoding: "utf8" });
  const transport = () => {
    const events = new Map();
    for (const line of fs.readFileSync(syncFixture.transportLog, "utf8").split("\n").filter(Boolean)) {
      const event = JSON.parse(line);
      events.set(event.id, { ...events.get(event.id), finishedAt: null, stderr: "", ...event });
    }
    return [...events.values()];
  };
  const changeTransport = (changes) => {
    const config = JSON.parse(fs.readFileSync(syncFixture.transportConfig, "utf8"));
    const next = `${syncFixture.transportConfig}.next`;
    fs.writeFileSync(next, JSON.stringify({ ...config, ...changes }), { mode: 0o600 });
    fs.renameSync(next, syncFixture.transportConfig);
  };
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
    const status = fs.readFileSync(file, "utf8");
    assert.match(status, /^(?:0|[1-9][0-9]{0,2})$/, `Invalid CLI exit marker: ${path.basename(file)}`);
    const code = Number(status);
    assert.ok(code <= 255, `CLI exit code out of range: ${path.basename(file)}`);
    return code;
  };
  const sendCommand = async (args, interactive = false) => {
    const status = path.join(workspaceRoot, `command-status-${++commandNumber}`);
    const command = ["node", cli, ...args].map(quote).join(" ");
    const script = `c${commandNumber}`;
    // Launch through stable keys only. The shell script still runs inside the real PTY.
    fs.writeFileSync(
      path.join(workspaceRoot, script),
      `stty -echo\nprintf '\\033[2J\\033[H'\n${command}\nprintf '%s' "$?" > ${quote(`${status}.tmp`)} && mv -- ${quote(`${status}.tmp`)} ${quote(status)}\n`,
      { flag: "wx", mode: 0o600 }
    );
    await app.type(`sh ${script}`);
    await app.press("ENTER");
    activeCommand = status;
    if (interactive === true) {
      activeUI = status;
      lastUI = status;
      await expectScreen((text) => text.includes("Add task"), "The real Sync workspace must start", 30000);
      return null;
    }
    if (interactive === "prompt") {
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
      ".sync-core/state.json",
      ...syncFixture.excludedFiles
    ]) {
      const localFile = path.join(storageRoot, file);
      files[file] = fs.existsSync(localFile) ? fs.readFileSync(localFile, "utf8") : null;
      const remote = git(["--git-dir", remotePath, "show", `main:${file}`]);
      remoteFiles[file] = remote.status === 0 ? remote.stdout : null;
    }
    const head = git(["--git-dir", remotePath, "rev-parse", "refs/heads/main"]);
    const commits = git(["--git-dir", remotePath, "log", "--format=%H%x09%s", "main"]);
    const observation = {
      exitCode,
      screen: await screen(),
      files,
      remoteFiles,
      remoteHead: head.status === 0 ? head.stdout.trim() : null,
      isGitRepository: fs.existsSync(path.join(storageRoot, ".git")),
      storageRoot,
      remotePath,
      externalWriterPath,
      transport: transport(),
      remoteCommits:
        commits.status === 0
          ? commits.stdout
              .trim()
              .split("\n")
              .map((line) => ({ hash: line.split("\t")[0], message: line.slice(line.indexOf("\t") + 1) }))
          : [],
      elapsedSinceMutationMs: typeof lastMutationAt === "number" ? Date.now() - lastMutationAt : null,
      applicationExited: typeof lastUI === "string" && fs.existsSync(lastUI),
      applicationExitedAt: typeof lastUI === "string" && fs.existsSync(lastUI) ? fs.statSync(lastUI).mtimeMs : null
    };
    if (typeof name === "string") {
      at[name] = observation;
      await app.screenshot({ name });
    }
    return observation;
  };
  const closeUI = async (background = false) => {
    assert.notEqual(activeUI, null, "A real workspace must be open before closing it");
    await app.press("ESCAPE");
    await app.press("ESCAPE");
    await click("Todo");
    await app.press("CTRL_C");
    if (!background) {
      assert.equal(await waitForStatus(activeUI), 0);
      activeUI = null;
    }
  };
  const fill = async (label, value) => {
    await click(label, { rowOffset: 1, exact: true });
    await app.press("CTRL_A");
    await app.press("BACKSPACE");
    if (value.length > 0) {
      await app.type(value);
    }
  };
  const settle = async () => {
    const deadline = Date.now() + 15000;
    while (true) {
      const current = await observe(null);
      if (
        ["todos.json", "notes.json", "boards.json", "clocks.json"].every(
          (file) => current.files[file] === current.remoteFiles[file]
        ) &&
        current.files[".config/sync-pending.json"] === null
      ) {
        break;
      }
      assert.ok(Date.now() < deadline, "The actual private remote did not receive the saved domain data");
      await delay(30);
    }
    if (activeUI !== null) {
      await expectScreen((text) => /synced|healthy/i.test(text), "The workspace must show completed sync");
    }
  };
  try {
    for (const step of steps) {
      switch (step.action) {
        case "cli": {
          assert.equal(activeUI, null, "CLI commands require a closed TUI");
          const args = step.args.map((arg) => (arg === "$REMOTE" ? remotePath : arg));
          const exitCode = await sendCommand(args, step.background === true ? "prompt" : false);
          await observe(step.name, exitCode);
          break;
        }
        case "cli-input": {
          assert.equal(activeUI, null, "Interactive CLI input requires a closed TUI");
          assert.equal(typeof activeCommand, "string");
          assert.equal(fs.existsSync(activeCommand), false, "The real CLI prompt must still be active");
          if (typeof step.waitFor === "string") {
            await expectScreen(
              (text) => text.toLowerCase().includes(step.waitFor.toLowerCase()),
              "The CLI must expose its current prompt or validation error"
            );
          }
          if (typeof step.press === "string") {
            await app.press(step.press);
          }
          const exitCode = step.waitForExit === true ? await waitForStatus(activeCommand) : null;
          await observe(step.name, exitCode);
          break;
        }
        case "open":
          assert.equal(activeUI, null, "Only one TUI may use a fixture at a time");
          await sendCommand(["ui"], true);
          if (step.view !== "Todo") {
            await click(step.view);
          }
          if (syncFixture.fixture.transport?.arm === "after-open") {
            changeTransport({
              gate: syncFixture.fixture.transport.gate ?? null,
              mode: syncFixture.fixture.transport.mode ?? "healthy"
            });
          }
          break;
        case "cli-ui": {
          assert.equal(activeUI, null);
          await sendCommand(step.args, "prompt");
          for (const [answer, value] of Object.entries(step.answers)) {
            await expectScreen(
              (text) => text.toLowerCase().includes(answer === "title" ? "title" : answer),
              "The real CLI prompt must request the next answer"
            );
            await app.type(value);
            lastMutationAt = Date.now();
            await app.press("ENTER");
          }
          if (step.background !== true) {
            const code = await waitForStatus(activeCommand);
            if (step.waitRemote === true) {
              await settle();
            }
            await observe(step.name, code);
          }
          break;
        }
        case "close-ui":
          await closeUI(step.background === true);
          if (step.background !== true) {
            await observe(step.name, 0);
          }
          break;
        case "wait-command": {
          const code = await waitForStatus(activeCommand);
          if (activeUI === activeCommand) {
            activeUI = null;
          }
          await observe(step.name, code);
          break;
        }
        case "transport":
          assert.ok(["healthy", "network-failure", "auth-failure", "unknown-failure"].includes(step.mode));
          changeTransport({ mode: step.mode });
          break;
        case "wait-transport": {
          const deadline = Date.now() + 15000;
          while (
            transport().filter(
              (event) => event.operation === step.operation && (step.gated !== true || event.gated === true)
            ).length < (step.occurrence ?? 1)
          ) {
            assert.ok(Date.now() < deadline, "The real Git transport did not reach the requested operation");
            await delay(20);
          }
          await observe(step.name);
          break;
        }
        case "release-transport": {
          if (Number.isInteger(step.count)) {
            const waiting = transport().filter(
              (event) =>
                event.gated &&
                event.finishedAt === null &&
                !fs.existsSync(path.join(syncFixture.transportDirectory, `release-${event.id}`))
            );
            assert.ok(waiting.length >= step.count);
            for (const event of waiting.slice(0, step.count)) {
              fs.writeFileSync(
                path.join(syncFixture.transportDirectory, `release-${event.id}`),
                fs.readFileSync(syncFixture.transportConfig, "utf8"),
                {
                  flag: "wx",
                  mode: 0o600
                }
              );
            }
          } else {
            changeTransport({ gate: null });
          }
          break;
        }
        case "wait-debounce":
          await delay(Math.max(0, 5100 - (Date.now() - lastMutationAt)));
          break;
        case "wait-status": {
          const deadline = Date.now() + 15000;
          while (true) {
            const current = await observe(null);
            const state =
              current.files[".sync-core/state.json"] === null
                ? null
                : JSON.parse(current.files[".sync-core/state.json"]);
            const text = current.screen;
            if (
              (state?.status === step.status ||
                (step.status === "failed" &&
                  stateFaultActive &&
                  state === null &&
                  current.files[".config/sync-pending.json"] !== null) ||
                (step.status === "setup" && /set\s*up/i.test(text)) ||
                (step.status === "pending_remote" && current.files[".config/sync-pending.json"] !== null)) &&
              (step.status === "failed"
                ? /failed/i.test(text)
                : step.status === "degraded_auth"
                  ? /auth|recover|blocked|preserv/i.test(text)
                  : /conflict|failed|pending|set\s*up|unavailable|healthy|synced/i.test(text))
            ) {
              break;
            }
            assert.ok(Date.now() < deadline, `The real workspace did not expose ${step.status}`);
            await delay(30);
          }
          await observe(step.name);
          break;
        }
        case "observe":
          await observe(step.name);
          break;
        case "wait-screen": {
          assert.equal(typeof step.pattern, "string");
          const expected = new RegExp(step.pattern, "i");
          await expectScreen((text) => expected.test(text), "The requested public TUI state must become visible");
          break;
        }
        case "configure-sync": {
          assert.equal(activeUI, null, "Fixture configuration may change only between real TUI sessions");
          const settings = step.settings;
          assert.ok(typeof settings === "object" && settings !== null && !Array.isArray(settings));
          for (const [key, value] of Object.entries(settings)) {
            assert.ok(["enabled", "autoPull", "autoSync", "remoteUrl"].includes(key));
            if (key === "remoteUrl") {
              assert.equal(value, "", "This fixture operation may only remove the owned remote setting");
            } else {
              assert.equal(typeof value, "boolean");
            }
          }
          const configPath = path.join(storageRoot, ".config", "sync-config.json");
          const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
          fs.writeFileSync(configPath, JSON.stringify({ ...config, ...settings }), { mode: 0o600 });
          break;
        }
        case "write-legacy-state":
          fs.writeFileSync(path.join(storageRoot, ".config", "sync-state.json"), JSON.stringify(step.state), {
            mode: 0o600
          });
          break;
        case "wait-backoff": {
          const deadline = Date.now() + 15000;
          while (true) {
            const state = JSON.parse(fs.readFileSync(path.join(runtimeDirectory, "state.json"), "utf8"));
            if (typeof state.backoffUntil === "number" && state.backoffUntil > Date.now()) {
              lastBackoffUntil = state.backoffUntil;
              break;
            }
            assert.ok(Date.now() < deadline, "The real runtime must enter network retry backoff");
            await delay(20);
          }
          break;
        }
        case "observe-after-retry-window":
          await delay(Math.max(1100, (lastBackoffUntil ?? Date.now()) - Date.now() + 100));
          await observe(step.name);
          break;
        case "filesystem-fault":
          assert.equal(step.target, "runtime-state");
          if (step.mode === "not-directory") {
            assert.equal(stateFaultActive, false);
            assert.ok(fs.lstatSync(runtimeDirectory).isDirectory());
            fs.renameSync(runtimeDirectory, runtimeBackup);
            fs.writeFileSync(runtimeDirectory, "synthetic controlled filesystem failure", { flag: "wx", mode: 0o600 });
            stateFaultActive = true;
          } else {
            assert.equal(step.mode, "restore");
            assert.equal(stateFaultActive, true);
            fs.unlinkSync(runtimeDirectory);
            fs.renameSync(runtimeBackup, runtimeDirectory);
            stateFaultActive = false;
          }
          break;
        case "write-domain": {
          assert.ok(["todos", "notes", "boards", "clocks"].includes(step.domain));
          assert.equal(typeof step.content, "string");
          const file = path.join(storageRoot, `${step.domain}.json`);
          assert.ok(fs.lstatSync(file).isFile(), "The external edit requires an existing private domain file");
          fs.writeFileSync(file, step.content, { mode: 0o600 });
          await observe(step.name);
          break;
        }
        case "wait-recovery-blocked":
          await expectScreen(
            (text) => /could not finish safely|current file was preserved/i.test(text),
            "Recovery failure must remain safe and visible"
          );
          await observe(step.name);
          break;
        case "external-writer": {
          assert.ok(["todos", "notes", "boards"].includes(step.domain), "Unsupported external-writer domain");
          runGit(["pull", "--ff-only", "origin", "main"], externalWriterPath);
          if (step.readLocalFirst === true) {
            fs.copyFileSync(
              path.join(storageRoot, `${step.domain}.json`),
              path.join(externalWriterPath, `${step.domain}.json`)
            );
          }
          const source =
            step.domain === "boards"
              ? `import model from ${JSON.stringify(path.join(root, "scrumban/model.ts"))};
          const board = model.getCurrent(); Object.assign(board, ${JSON.stringify(step.values)}); model.save(board);`
              : `import createListModel from ${JSON.stringify(modelPath)};
          const domain = ${JSON.stringify(step.domain)};
          const model = createListModel({ dbName: domain, collectionName: domain, itemKey: domain === "todos" ? "tasks" : "notes", itemHasCheck: domain === "todos" });
          const list = model.getCurrent(); Object.assign(list, ${JSON.stringify(step.values)}); model.save(list);`;
          execFileSync("node", ["--import", "tsx", "--input-type=module", "-e", source], {
            cwd: root,
            env: { ...environment, HOME: externalHome },
            stdio: "pipe"
          });
          if (step.publish === true) {
            runGit(["add", `${step.domain}.json`], externalWriterPath);
            runGit(["commit", "-m", "external fixture revision"], externalWriterPath);
            runGit(["push", "origin", "main"], externalWriterPath);
          }
          if (step.copyToLocal !== false) {
            fs.copyFileSync(
              path.join(externalWriterPath, `${step.domain}.json`),
              path.join(storageRoot, `${step.domain}.json`)
            );
          }
          await observe(step.name);
          break;
        }
        case "ui":
          assert.notEqual(activeUI, null, "A physical TUI must be open");
          if (step.operation === "add-task" || step.operation === "add-note") {
            const note = step.operation === "add-note";
            if (note) {
              await app.press("CTRL_2");
            }
            await click(note ? "Add note" : "Add task", { area: "actions" });
            if (step.title.length > 0) {
              await app.type(step.title);
            }
            if (note && typeof step.content === "string") {
              await fill("Note content", step.content);
            }
            lastMutationAt = Date.now();
            await click(step.confirm === false ? "Cancel" : "Save", { area: "overlay", occurrence: -1 });
            await screen();
          } else if (step.operation === "add-list") {
            await click("Manage lists");
            await click("Add list");
            await fill("List title", step.title);
            lastMutationAt = Date.now();
            await click("Add list", { occurrence: -1 });
            await expectScreen(
              (text) => !text.includes("List title") && text.includes(step.title),
              "The new current list must be visible"
            );
          } else if (step.operation === "add-board") {
            await click("Add board", { area: "actions" });
            await fill("Title", step.title);
            lastMutationAt = Date.now();
            await click("Save", { area: "overlay" });
            await expectScreen(
              (text) => !text.includes("Cancel") && text.includes(step.title),
              "The new board must be visible"
            );
          } else if (step.operation === "add-card") {
            await click("Add card");
            await fill("Title", step.title);
            lastMutationAt = Date.now();
            await click("Save");
            if (step.expectRecovery !== true) {
              await expectScreen(
                (text) => !text.includes("Cancel") && text.includes(step.title),
                "The new card must be visible"
              );
            }
          } else if (["edit-task", "edit-card", "remove-task", "remove-card"].includes(step.operation)) {
            const card = step.operation.endsWith("card");
            const remove = step.operation.startsWith("remove");
            await click(step.title);
            await app.press("o");
            await click(card ? (remove ? "Remove" : "Edit") : `${remove ? "Remove" : "Edit"} task`, {
              area: "overlay"
            });
            if (!remove) {
              await fill(card ? "Title" : "Task title", step.values.title);
            }
            lastMutationAt = Date.now();
            await click(
              remove
                ? step.confirm === false
                  ? card
                    ? "Close"
                    : "Cancel"
                  : card
                    ? "Delete card"
                    : "Remove task"
                : "Save",
              {
                area: "overlay",
                occurrence: -1
              }
            );
            await expectScreen(
              (text) =>
                !text.includes("Cancel") && (remove ? !text.includes(step.title) : text.includes(step.values.title)),
              "The submitted edit or removal must be visible"
            );
          } else if (step.operation === "move-card") {
            await click(step.title);
            await app.press("ENTER");
            lastMutationAt = Date.now();
            await app.press("RIGHT");
            await screen();
          } else if (step.operation === "reorder-note") {
            assert.ok(["up", "down"].includes(step.direction));
            await app.press("CTRL_2");
            await click(step.title);
            lastMutationAt = Date.now();
            await app.press(step.direction === "up" ? "SHIFT_UP" : "SHIFT_DOWN");
            await screen();
          } else if (step.operation === "check-task") {
            await click(step.title);
            lastMutationAt = Date.now();
            await app.press("ENTER");
            await screen();
          } else if (step.operation === "add-clock") {
            await click("Add clock");
            await app.type(step.name);
            await fill("Time zone", step.timezone);
            await click(step.timezone, { occurrence: -1 });
            lastMutationAt = Date.now();
            await click("Add clock", { area: "overlay", occurrence: -1 });
            await expectScreen(
              (text) => !text.includes("Clock name") && text.includes(step.name),
              "The new clock must be visible"
            );
          } else if (step.operation === "remove-clock") {
            if (typeof step.name === "string") {
              await click(step.name);
              await app.press("ENTER");
              await click("Remove", { area: "overlay" });
              lastMutationAt = Date.now();
              await click(step.confirm === false ? "Cancel" : "Remove clock", { occurrence: -1 });
            } else {
              await click("Remove");
            }
            await screen();
          } else if (step.operation === "cancel-dialog") {
            await click("Cancel", { area: "overlay", occurrence: -1 });
            await screen();
          } else if (step.operation === "dismiss-notice") {
            await app.press("ESCAPE");
            await screen();
          } else if (step.operation === "switch-view") {
            if (step.view === "Sync") {
              await app.press("CTRL_5");
            } else {
              await click(step.view);
            }
          } else if (step.operation === "sync-init") {
            assert.equal(typeof step.waitFor, "string");
            await app.press("CTRL_5");
            await click("Set up sync", { area: "actions" });
            await fill("Remote URL", remotePath);
            await fill("Branch", "main");
            await click("Confirm setup", { area: "overlay", occurrence: -1 });
            await click("Set up sync", { area: "overlay" });
            const expected = new RegExp(step.waitFor, "i");
            await expectScreen((text) => expected.test(text), "The real Sync setup must expose its outcome");
          } else if (["sync-disable", "sync-enable", "sync-retry"].includes(step.operation)) {
            if (!/^\s*Sync\s*$/m.test(await screen())) {
              await app.press("CTRL_5");
            }
            await click(
              step.operation === "sync-disable"
                ? "Disable sync"
                : step.operation === "sync-retry"
                  ? "Retry sync"
                  : "Enable sync",
              { area: "actions" }
            );
            if (step.operation === "sync-disable") {
              await expectScreen(
                (text) => /Status:\s*Sync off/i.test(text),
                "Disable must finish before Enable is available"
              );
            }
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
              (step.domain === "boards" ? ["boards.json"] : ["todos.json", "notes.json"]).every(
                (file) => observed.files[file] === observed.remoteFiles[file]
              )
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
          await settle();
          await observe(step.name);
          break;
        }
        case "expect-no-output-after-exit": {
          assert.ok(Number.isSafeInteger(step.durationMs) && step.durationMs > 0 && step.durationMs <= 1500);
          assert.equal(await app.waitForExit(), 0);
          const finalOutput = output();
          await delay(step.durationMs);
          assert.equal(output(), finalOutput, "The exited application must not continue rendering");
          break;
        }
        case "exit":
          if (activeUI !== null) {
            await closeUI();
          }
          await app.type("exit");
          await app.press("ENTER");
          break;
        default:
          throw new Error(`Unsupported Sync workflow operation: ${step.action}`);
      }
    }
    return {
      at,
      home,
      workspaceRoot,
      terminalOutput: output(),
      canaryBefore: syncFixture.canaryBefore,
      canaryAfter: syncFixture.canaryBefore === null ? null : fs.readFileSync(syncFixture.canaryPath, "utf8"),
      exitCode: await app.waitForExit()
    };
  } finally {
    if (stateFaultActive) {
      fs.unlinkSync(runtimeDirectory);
      fs.renameSync(runtimeBackup, runtimeDirectory);
    }
    changeTransport({ gate: null });
  }
}
