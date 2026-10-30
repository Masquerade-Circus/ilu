import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { execFileSync } from "node:child_process";
import IluDb from "iludb";
import JsonPlugin from "iludb/plugins/node-json";
import { assertRepoTempHome } from "../../support/home-sandbox.ts";
import { runSyncWorkflow } from "./terminal-capture-sync.ts";
import { runAdapterBehavior } from "./terminal-capture-adapters.ts";

IluDb.use(JsonPlugin);
const root = path.resolve(import.meta.dirname, "..", "..");
export const captureCommand = [
  "node",
  "--import",
  "tsx",
  "--import",
  path.join(import.meta.dirname, "terminal-capture-home.ts"),
  path.join(root, "bin", "cli.js"),
  "ui"
];

// The implementation owner supplies the Node/Bun bridge, lifecycle and live PTY screen reader.
// screen() must describe the CURRENT real application's terminal, never a headless rerender
// or a search in accumulated output. These fixtures only interact and assert CLI/TUI behavior.
async function expectScreen({ screen, predicate, message }) {
  const deadline = Date.now() + 8000;
  let current = "";
  do {
    current = await screen();
    if (predicate(current)) {
      return current;
    }
    await delay(25);
  } while (Date.now() < deadline);
  assert.fail(`${message}\nCurrent terminal:\n${current}`);
}

async function clickText({
  app,
  screen,
  text,
  rowOffset = 0,
  columnOffset = 0,
  occurrence = 0,
  area = "any",
  exact = false
}) {
  assert.ok(["any", "nav", "actions", "overlay", "content"].includes(area), `Unknown click area: ${area}`);
  const current = await expectScreen({
    screen,
    predicate: (value) =>
      value.includes(text) || (text === "Start conversion" && value.split("\n").at(-2)?.includes("Creating audio...")),
    message: `Expected visible target ${text}`
  });
  const lines = current.split("\n");
  if (text === "Translate" && area === "actions" && lines.at(-2)?.includes("Translating...")) {
    text = "Translating...";
  }
  if (text === "Start conversion" && lines.at(-2)?.includes("Creating audio...")) {
    text = "Creating audio...";
    area = "actions";
  }
  const matches = lines.flatMap((line, row) =>
    (exact ? line.replace(/^[│\s]+|[│\s]+$/g, "") === text : line.includes(text)) &&
    (area === "any" ||
      (area === "nav"
        ? row === 0
        : area === "actions"
          ? row === lines.length - 2
          : area === "overlay"
            ? line.indexOf("│") >= 0 &&
              line.indexOf(text) > line.indexOf("│") &&
              line.indexOf(text) < line.lastIndexOf("│")
            : row > 0))
      ? [{ column: line.indexOf(text) + 1 + columnOffset, row: row + 1 + rowOffset }]
      : []
  );
  const target = matches.at(occurrence);
  assert.ok(target, `Expected target occurrence ${occurrence}: ${text}`);
  await app.mouse({ action: "press", ...target });
  await app.mouse({ action: "release", ...target });
}

function readLists({ home, domain }) {
  const safeHome = assertRepoTempHome(home, "Captured application HOME");
  return IluDb(path.join(safeHome, ".ilu", `${domain}.json`))
    .getCollection(domain)
    .find();
}

async function finish({ app, screen }) {
  await clickText({ app, screen, text: "Todo" });
  await app.press("CTRL_C");
  const exitCode = await app.waitForExit();
  assert.equal(exitCode, 0, "the captured real CLI must exit normally");
  return { exitCode };
}

async function openItemEditor({ app, screen, domain }) {
  await clickText({ app, screen, text: domain });
  await clickText({ app, screen, text: domain === "Todo" ? "Capture task" : "Capture note" });
  await app.press(domain === "Todo" ? "o" : "ENTER");
  await clickText({ app, screen, text: domain === "Todo" ? "Edit task" : "Edit note" });
  await expectScreen({
    screen,
    predicate: (text) => text.includes("Cancel") && text.includes("Save"),
    message: "The edit dialog must be open"
  });
}

export const captureScenarios = {
  async adapterBehavior(context, input) {
    return runAdapterBehavior(
      {
        ...context,
        click: (text, options = {}) => clickText({ ...context, text, ...options }),
        expectScreen: (predicate, message) => expectScreen({ screen: context.screen, predicate, message })
      },
      input
    );
  },
  async syncWorkflow(context, input) {
    return runSyncWorkflow(
      {
        ...context,
        click: (text) => clickText({ ...context, text }),
        expectScreen: (predicate, message) => expectScreen({ screen: context.screen, predicate, message })
      },
      input
    );
  },
  async translationHttpRecovery(context, input) {
    const { app, screen, externalDirectory } = context;
    await expectScreen({
      screen,
      predicate: (text) => text.includes("Add task"),
      message: "Workspace must finish starting"
    });
    await app.press("CTRL_6");
    await clickText({ ...context, text: "Text to translate (", rowOffset: 1 });
    await app.type(input.text);
    await app.press("TAB");
    await app.press("CTRL_A");
    await app.type(input.source);
    await app.press("TAB");
    await app.press("CTRL_A");
    await app.type(input.target);
    await clickText({ ...context, text: "Translate", occurrence: -1 });
    const failureScreen = await expectScreen({
      screen,
      predicate: (text) => /Could not translate|503|unavailable|failed/i.test(text),
      message: "The failed HTTP request must remain visible in the same workspace"
    });
    await app.screenshot({ name: "translation-failed" });
    const config = JSON.parse(fs.readFileSync(path.join(externalDirectory, "config.json"), "utf8"));
    const clipboardAfterFailure = fs.readFileSync(config.clipboardPath, "utf8");
    const clipboardWritesAfterFailure = fs
      .readFileSync(config.clipboardWritesPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    await clickText({ ...context, text: "Translate", occurrence: -1 });
    const translated = input.http[1].body.sentences.map((sentence) => sentence.trans).join("");
    const recoveredScreen = await expectScreen({
      screen,
      predicate: (text) => text.includes(translated),
      message: "The same workspace must allow a successful retry"
    });
    await clickText({ ...context, text: "Copy result" });
    await expectScreen({ screen, predicate: (text) => text.includes("Copied."), message: "Copy must complete" });
    await app.screenshot({ name: "translation-recovered" });
    const clipboardAfter = fs.readFileSync(config.clipboardPath, "utf8");
    const requests = fs
      .readFileSync(config.requestsPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return {
      ...(await finish(context)),
      failureScreen,
      recoveredScreen,
      clipboardAfterFailure,
      clipboardWritesAfterFailure,
      clipboardAfter,
      requests
    };
  },
  async translationValidation(context) {
    return captureScenarios.translationMalformedResults(context, {
      checkpoints: ["translation-too-long", "translation-missing"]
    });
  },
  async translationMalformedResults({ app, screen, externalDirectory }, input) {
    const config = JSON.parse(fs.readFileSync(path.join(externalDirectory, "config.json"), "utf8"));
    const invocations = [];
    for (let index = 0; index < config.commands.length; index++) {
      const outcome = path.join(config.sequenceDirectory, `invocation-${index}.json`);
      const deadline = Date.now() + 8000;
      while (!fs.existsSync(outcome)) {
        if (Date.now() >= deadline) {
          throw new Error("The real translation invocation did not complete");
        }
        await delay(20);
      }
      const status = JSON.parse(fs.readFileSync(outcome, "utf8"));
      invocations.push({
        ...status,
        currentScreen: await screen(),
        clipboardAfter: fs.readFileSync(config.clipboardPath, "utf8"),
        clipboardWrites: fs
          .readFileSync(config.clipboardWritesPath, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      });
      await app.screenshot({ name: input.checkpoints?.[index] ?? `translation-invalid-${index + 1}` });
      fs.writeFileSync(path.join(config.sequenceDirectory, `continue-${index}`), "continue", { mode: 0o600 });
    }
    const exitCode = await app.waitForExit();
    return {
      exitCode,
      invocations,
      requests: fs
        .readFileSync(config.requestsPath, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    };
  },
  async translationCli({ app, screen, externalDirectory }) {
    const exitCode = await app.waitForExit();
    const currentScreen = await screen();
    await app.screenshot({ name: "translation-result" });
    const config = JSON.parse(fs.readFileSync(path.join(externalDirectory, "config.json"), "utf8"));
    const jsonLines = (file) =>
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    return {
      exitCode,
      currentScreen,
      requests: jsonLines(config.requestsPath),
      clipboardWrites: jsonLines(config.clipboardWritesPath),
      clipboardAfter: fs.readFileSync(config.clipboardPath, "utf8")
    };
  },
  async cliExit({ app, screen }) {
    const exitCode = await app.waitForExit();
    const currentScreen = await screen();
    await app.screenshot({ name: "cli-result" });
    return { exitCode, currentScreen };
  },

  async cliScript(context, { steps }) {
    const { app, screen } = context;
    const frames = {};
    const fileSnapshots = {};
    for (const step of steps) {
      const operation = Object.keys(step).filter((key) => !["flags", "occurrence", "rowOffset", "files"].includes(key));
      assert.equal(operation.length, 1, `Expected one supported CLI step: ${JSON.stringify(step)}`);
      switch (operation[0]) {
        case "waitFor": {
          const pattern = typeof step.flags === "string" ? new RegExp(step.waitFor, step.flags) : null;
          await expectScreen({
            screen,
            predicate: (text) => (pattern === null ? text.includes(step.waitFor) : pattern.test(text)),
            message: `Expected current CLI prompt: ${step.waitFor}`
          });
          break;
        }
        case "press":
          await app.press(step.press);
          await screen();
          break;
        case "type":
          await app.type(step.type);
          await screen();
          break;
        case "clickText":
          await clickText({
            ...context,
            text: step.clickText,
            occurrence: step.occurrence ?? 0,
            rowOffset: step.rowOffset ?? 0
          });
          await screen();
          break;
        case "doubleClickText":
          await clickText({ ...context, text: step.doubleClickText, occurrence: step.occurrence ?? 0 });
          await clickText({ ...context, text: step.doubleClickText, occurrence: step.occurrence ?? 0 });
          await screen();
          break;
        case "checkpoint":
          frames[step.checkpoint] = await screen();
          fileSnapshots[step.checkpoint] = {};
          for (const file of step.files ?? []) {
            assertRepoTempHome(path.dirname(file), "CLI snapshot directory");
            fileSnapshots[step.checkpoint][file] = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
          }
          await app.screenshot({ name: step.checkpoint });
          break;
        default:
          throw new Error(`Unsupported CLI operation: ${operation[0]}`);
      }
    }
    const exitCode = await app.waitForExit();
    const currentScreen = await screen();
    await app.screenshot({ name: "cli-result" });
    return { exitCode, currentScreen, frames, fileSnapshots };
  },

  async tuiInteraction(context, input) {
    const { app, screen } = context;
    const home = assertRepoTempHome(context.home, "TUI capture HOME");
    const quote = (value) => `'${String(value).replace(/'/g, `'"'"'`)}'`;
    let launches = 0;
    let status = null;
    const launch = async () => {
      const workspace = path.dirname(path.dirname(home));
      const script = path.join(workspace, `workspace-${++launches}.sh`);
      status = path.join(workspace, `workspace-${launches}.status`);
      const command = launches === 1 ? context.restartCommand : ["node", path.join(root, "bin", "cli.js"), "ui"];
      fs.writeFileSync(
        script,
        `printf '\\033[2J\\033[H'\n${command.map(quote).join(" ")}\nprintf '%s' "$?" > ${quote(status)}\n`,
        { flag: "wx", mode: 0o600 }
      );
      await app.type(`. ${quote(script)}`);
      await app.press("ENTER");
      await expectScreen({
        screen,
        predicate: (text) => text.includes("Ctrl+K") && text.includes("Add task"),
        message: "A fresh real workspace must start"
      });
    };
    const closeWorkspace = async () => {
      await clickText({ ...context, text: "Todo", area: "nav" });
      await app.press("CTRL_C");
      const deadline = Date.now() + 8000;
      while (!fs.existsSync(status)) {
        assert.ok(Date.now() < deadline, "The workspace must close normally before restart");
        await delay(25);
      }
      assert.equal(fs.readFileSync(status, "utf8"), "0");
    };
    if (Array.isArray(context.restartCommand)) {
      await app.type("stty -echo; PS1=''");
      await app.press("ENTER");
      await launch();
    }
    await expectScreen({
      screen,
      predicate: (text) => text.includes("Ctrl+K") && text.includes("Add task"),
      message: "The real workspace must finish starting before interaction or data observations"
    });
    const remembered = new Map();
    const positions = new Map();
    const blockedDirectories = new Map();
    let exitCode = null;
    let clipboardChecks = 0;
    const externalConfig = JSON.parse(fs.readFileSync(path.join(context.externalDirectory, "config.json"), "utf8"));
    const domainFile = (domain) =>
      path.join(
        home,
        ".ilu",
        ["sync-config", "tts-config"].includes(domain) ? `.config/${domain}.json` : `${domain}.json`
      );
    const steps = input.steps.flatMap((step) => {
      if (!Object.hasOwn(step, "translateText")) {
        return [step];
      }
      assert.equal(typeof step.translateText, "string");
      return [
        { fill: { label: "Text to translate", text: step.translateText } },
        { click: "Translate", area: "actions" },
        ...(step.wait === false ? [] : [{ expect: { pending: false } }])
      ];
    });
    try {
      for (const step of steps) {
        const operation = Object.keys(step).filter(
          (key) => !["area", "occurrence", "rowOffset", "repeat"].includes(key)
        );
        assert.equal(operation.length, 1, `Expected one supported TUI step: ${JSON.stringify(step)}`);
        switch (operation[0]) {
          case "editorResizeRoundTrip": {
            const options = step.editorResizeRoundTrip;
            assert.equal(
              options.domain,
              "translation",
              "This editor resize route currently covers the real Translate editor"
            );
            assert.equal(options.form, "translate");
            assert.ok(
              Number.isSafeInteger(options.documentLines) && options.documentLines > 0 && options.documentLines <= 100
            );
            const document = Array.from(
              { length: options.documentLines },
              (_, index) => `Row${String(index + 1).padStart(3, "0")}`
            );
            await clickText({ ...context, text: "Text to translate (", rowOffset: 1 });
            await app.press("CTRL_A");
            await app.press("BACKSPACE");
            for (const [index, line] of document.entries()) {
              if (index > 0) {
                await app.press("SHIFT_ENTER");
              }
              await app.type(line);
            }
            const visible = [];
            for (const [index, size] of options.sizes.entries()) {
              await app.resize(size);
              const current = await expectScreen({
                screen,
                predicate: (text) =>
                  text.includes(document.at(-1)) && options.requiredControls.every((label) => text.includes(label)),
                message: "The resized editor must retain its draft and every required control"
              });
              visible.push([...current.matchAll(/Row\d{3}/g)].length);
              assert.ok(
                current.split("\n").length <= size.rows &&
                  current.split("\n").every((line) => [...line].length <= size.cols),
                "The editor and controls must stay within the resized viewport"
              );
              await app.screenshot({ name: `translate-resize-${index + 1}` });
            }
            if (options.requireMoreLinesOnGrowth) {
              assert.ok(visible[1] > visible[0], "A taller real editor must expose more document lines");
            }
            if (options.requireSameLinesOnShrink) {
              assert.equal(visible[2], visible[0], "Shrinking must restore the prior visible editor capacity");
            }
            await clickText({ ...context, text: "Text to translate (", rowOffset: 1 });
            for (let index = 0; index < options.documentLines; index++) {
              await app.press("DOWN");
            }
            await app.press("END");
            if (typeof options.editAfterShrink === "string") {
              await app.type(options.editAfterShrink);
              document[document.length - 1] += options.editAfterShrink;
            }
            if (options.preserveAcrossTabs) {
              await app.press("CTRL_1");
              await expectScreen({
                screen,
                predicate: (text) => text.includes("Add task"),
                message: "Tab navigation must remain usable after resize"
              });
              await app.press("CTRL_6");
              await expectScreen({
                screen,
                predicate: (text) => text.includes("Text to translate ("),
                message: "Translate must reopen with its real draft"
              });
              await clickText({ ...context, text: "Text to translate (", rowOffset: 1 });
            }
            for (let index = 0; index < options.documentLines; index++) {
              await app.press("UP");
            }
            await app.press("HOME");
            const seen = new Set();
            for (let index = 0; index < options.documentLines; index++) {
              const current = await screen();
              for (const match of current.matchAll(/Row\d{3}!*/g)) {
                seen.add(match[0]);
              }
              await app.press("DOWN");
            }
            assert.deepEqual(
              [...seen],
              document,
              "Real keyboard navigation must recover every original document line and the edit after shrink"
            );
            break;
          }
          case "storageFault": {
            assert.ok(["clocks", "todos", "notes", "boards"].includes(step.storageFault.domain));
            assert.ok(["deny-write", "restore"].includes(step.storageFault.kind));
            const directory = path.join(home, ".ilu", ...(step.storageFault.domain === "clocks" ? [".config"] : []));
            if (step.storageFault.kind === "restore") {
              assert.ok(
                blockedDirectories.has(directory),
                "Storage permissions must only be restored after a controlled fault"
              );
              fs.chmodSync(directory, blockedDirectories.get(directory));
              blockedDirectories.delete(directory);
            } else {
              assert.equal(blockedDirectories.has(directory), false, "Storage fault is already active");
              fs.mkdirSync(directory, { recursive: true });
              assert.ok(
                fs.lstatSync(directory).isDirectory(),
                "The storage target must be a private directory, not a symlink"
              );
              blockedDirectories.set(directory, fs.statSync(directory).mode & 0o777);
              fs.chmodSync(directory, 0o500);
            }
            break;
          }
          case "rememberFooter":
            remembered.set(`footer:${step.rememberFooter}`, (await screen()).split("\n").at(-1));
            break;
          case "waitForClockTick": {
            const before = (await screen()).split("\n").at(-1);
            const name = step.waitForClockTick.name;
            assert.ok(before.includes(name), "The observed clock must be visible before its tick");
            const time = before.slice(before.indexOf(name) + name.length).match(/^\s*\d{2}:\d{2}:\d{2}/)?.[0];
            assert.equal(typeof time, "string");
            const deadline = Date.now() + step.waitForClockTick.timeoutMs;
            let changed = false;
            do {
              const footer = (await screen()).split("\n").at(-1);
              changed =
                footer.includes(name) &&
                footer.slice(footer.indexOf(name) + name.length).match(/^\s*\d{2}:\d{2}:\d{2}/)?.[0] !== time;
              if (!changed) {
                await delay(30);
              }
            } while (!changed && Date.now() < deadline);
            assert.equal(changed, true, "The real clock must refresh within its declared observation interval");
            break;
          }
          case "expectNoOutputAfterExit": {
            assert.equal(exitCode, 0, "Clock shutdown observations require normal application exit");
            const output = context.output();
            await delay(step.expectNoOutputAfterExit.durationMs);
            assert.equal(context.output(), output, "The exited workspace must not leave a clock render timer active");
            break;
          }
          case "rememberVisibleCount": {
            const current = await screen();
            remembered.set(
              `visible:${step.rememberVisibleCount.as}`,
              [...current.matchAll(new RegExp(step.rememberVisibleCount.pattern, "g"))].length
            );
            break;
          }
          case "scroll": {
            assert.ok(["up", "down"].includes(step.scroll.direction));
            assert.ok(Number.isSafeInteger(step.scroll.count) && step.scroll.count > 0 && step.scroll.count <= 100);
            const lines = (await screen()).split("\n");
            const target = step.scroll.target === "scrollbar" ? "█" : step.scroll.text;
            assert.equal(typeof target, "string");
            const row = lines.findIndex((line) => line.includes(target));
            assert.ok(row >= 0, "A physical wheel event requires a currently visible target");
            const column = lines[row].indexOf(target);
            for (let index = 0; index < step.scroll.count; index++) {
              await app.mouse({ action: `wheel-${step.scroll.direction}`, row: row + 1, column: column + 1 });
            }
            await screen();
            break;
          }
          case "provider":
            assert.ok(["translation", "speech"].includes(step.provider.kind), "Unknown external provider boundary");
            if (step.provider.kind === "speech") {
              assert.equal(
                typeof externalConfig.openaiAudioBase64,
                "string",
                "Speech needs a synthetic audio fixture before any SDK request"
              );
            }
            fs.writeFileSync(externalConfig.tuiProviderPath, JSON.stringify(step.provider), { mode: 0o600 });
            break;
          case "restartAppNormally":
            assert.equal(step.restartAppNormally, true);
            assert.ok(
              Array.isArray(context.restartCommand),
              "A restart requires the public CLI within the same captured shell"
            );
            await closeWorkspace();
            await launch();
            break;
          case "releaseProvider":
            assert.match(step.releaseProvider.id, /^[a-z0-9-]+$/);
            fs.writeFileSync(
              path.join(externalConfig.releasesDirectory, `${step.releaseProvider.id}.json`),
              JSON.stringify(step.releaseProvider),
              { flag: "wx", mode: 0o600 }
            );
            await screen();
            break;
          case "externalCalls": {
            const requests = fs
              .readFileSync(externalConfig.requestsPath, "utf8")
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line));
            for (const [kind, count] of Object.entries(step.externalCalls)) {
              assert.ok(["translation", "speech"].includes(kind), `Unknown provider observation: ${kind}`);
              assert.equal(
                requests.filter(
                  (request) => request.service === (kind === "translation" ? "googleTranslate" : "openai")
                ).length,
                count
              );
            }
            break;
          }
          case "providerRequest": {
            const kind = step.providerRequest.kind;
            assert.ok(["translation", "speech"].includes(kind));
            const requests = fs
              .readFileSync(externalConfig.requestsPath, "utf8")
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line));
            const request = requests.findLast(
              (item) => item.service === (kind === "translation" ? "googleTranslate" : "openai")
            );
            assert.ok(request, "Expected an actual external provider request");
            for (const [key, value] of Object.entries(step.providerRequest)) {
              if (key === "kind") {
                continue;
              }
              assert.ok(
                (kind === "translation" ? ["text", "source", "target"] : ["text", "voice"]).includes(key),
                `Unsupported provider request field: ${key}`
              );
              const observed =
                kind === "translation"
                  ? new URL(request.url).searchParams.get({ text: "q", source: "sl", target: "tl" }[key])
                  : request.body[key === "text" ? "input" : key];
              assert.equal(observed, value);
            }
            break;
          }
          case "audioFile": {
            for (const key of Object.keys(step.audioFile)) {
              assert.ok(["exists", "nonempty"].includes(key), `Unknown audio observation: ${key}`);
            }
            const file = externalConfig.privateAudioFile;
            assert.equal(typeof file, "string");
            assertRepoTempHome(path.dirname(file), "Synthetic audio target");
            assert.equal(fs.existsSync(file), step.audioFile.exists);
            if (step.audioFile.exists) {
              assert.ok(fs.statSync(file).size > 0, "The real service must create a nonempty audio file");
              const metadata = JSON.parse(
                execFileSync(
                  "ffprobe",
                  ["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", file],
                  { encoding: "utf8" }
                )
              );
              assert.ok(
                metadata.streams.some((stream) => stream.codec_type === "audio"),
                "The synthetic response must produce decodable audio"
              );
              assert.ok(Number(metadata.format.duration) > 0);
            }
            break;
          }
          case "clipboardEquals": {
            await app.screenshot({ name: `clipboard-before-paste-${++clipboardChecks}` });
            await clickText({ ...context, text: "Text to translate (", rowOffset: 1 });
            await app.press("CTRL_A");
            await app.press("BACKSPACE");
            await app.press("CTRL_V");
            await expectScreen({
              screen,
              message: "The real editor must paste exactly the session clipboard",
              predicate: (text) => {
                const lines = text.split("\n");
                const start = lines.findIndex((line) => line.includes("Text to translate ("));
                const end = lines.findIndex((line) => line.includes("Language codes:"));
                return (
                  start >= 0 &&
                  end > start &&
                  lines
                    .slice(start + 1, end)
                    .map((line) => line.trim())
                    .join("\n")
                    .trimEnd() === step.clipboardEquals
                );
              }
            });
            break;
          }
          case "key":
            assert.ok(
              Number.isSafeInteger(step.repeat ?? 1) && (step.repeat ?? 1) > 0 && (step.repeat ?? 1) <= 100,
              "Expected a bounded positive key repetition"
            );
            for (let index = 0; index < (step.repeat ?? 1); index++) {
              await app.press(step.key);
              await screen();
            }
            break;
          case "type":
            await app.type(step.type);
            await screen();
            break;
          case "focusLabel":
          case "fill": {
            const label = operation[0] === "fill" ? step.fill.label : step.focusLabel;
            const inline = ["From", "To"].includes(label);
            await clickText({
              ...context,
              text: label === "Text to translate" ? "Text to translate (" : label,
              exact: !inline && label !== "Text to translate",
              area: inline ? "content" : "any",
              rowOffset: inline ? 0 : 1,
              columnOffset: inline ? label.length + 3 : 0
            });
            if (operation[0] === "fill") {
              let value = Object.hasOwn(step.fill, "valueFrom") ? externalConfig[step.fill.valueFrom] : step.fill.text;
              if (Object.hasOwn(step.fill, "valueFrom")) {
                assert.ok(
                  ["syntheticTextFile", "privateAudioFile"].includes(step.fill.valueFrom),
                  "Unknown synthetic file fixture"
                );
              }
              assert.equal(typeof value, "string", "Field input must be an explicit value or a prepared private file");
              if (Object.hasOwn(step.fill, "valueFrom")) {
                value = path.relative(context.cwd, value);
              }
              await app.press("CTRL_A");
              await app.press("BACKSPACE");
              for (const [index, line] of value.split("\n").entries()) {
                if (index > 0) {
                  await app.press("SHIFT_ENTER");
                }
                if (line.length > 0) {
                  await app.type(line);
                }
              }
            }
            await screen();
            break;
          }
          case "data": {
            const expected = step.data;
            if (expected.domain === "tts-config") {
              assert.deepEqual(Object.keys(expected).sort(), ["domain", "voice"]);
              const config = JSON.parse(fs.readFileSync(domainFile("tts-config"), "utf8"));
              assert.equal(config.voice, expected.voice);
              break;
            }
            if (expected.domain === "clocks") {
              for (const key of Object.keys(expected)) {
                assert.ok(["domain", "names", "exactOrder"].includes(key), `Unknown clock data observation: ${key}`);
              }
              const clocks = JSON.parse(fs.readFileSync(domainFile("clocks"), "utf8"));
              assert.ok(Array.isArray(clocks), "The public legacy clock storage must remain readable");
              const names = clocks.map((clock) => clock.name);
              if (expected.exactOrder === true) {
                assert.deepEqual(names, expected.names);
              } else {
                assert.ok(expected.names.every((name) => names.includes(name)));
              }
              break;
            }
            const lists = readLists({ home, domain: expected.domain });
            if (["todos", "notes"].includes(expected.domain)) {
              for (const key of Object.keys(expected)) {
                assert.ok(["domain", "title", "count"].includes(key), `Unsupported list data observation: ${key}`);
              }
              const list = lists.find((item) => item.current) ?? lists[0];
              assert.ok(list, "Expected a persisted current list");
              const items = list[expected.domain === "todos" ? "tasks" : "notes"];
              assert.equal(items.filter((item) => item.title === expected.title).length, expected.count);
              break;
            }
            assert.equal(expected.domain, "boards", "Unsupported data observation domain");
            for (const key of Object.keys(expected)) {
              assert.ok(
                ["domain", "board", "card", "column", "description", "absentColumn"].includes(key),
                `Unsupported board data observation: ${key}`
              );
            }
            const board =
              typeof expected.board === "string"
                ? lists.find((item) => item.title === expected.board)
                : lists.find((item) => item.current);
            assert.ok(board, "Expected persisted board");
            if (Object.hasOwn(expected, "absentColumn")) {
              assert.equal(
                board.columns.some((column) => column.title === expected.absentColumn),
                false
              );
              break;
            }
            const columns = Object.hasOwn(expected, "column")
              ? board.columns.filter((column) => column.title === expected.column)
              : board.columns;
            const card = board.columns.flatMap((column) => column.cards).find((item) => item.title === expected.card);
            assert.ok(card, "Expected persisted card");
            assert.ok(
              columns.some((column) => column.cards.some((item) => item.title === expected.card)),
              "Expected card in the requested column"
            );
            if (Object.hasOwn(expected, "description")) {
              assert.equal(card.description, expected.description);
            }
            break;
          }
          case "locate": {
            const lines = (await screen()).split("\n");
            const row = lines.findIndex((line) => line.includes(step.locate.text));
            assert.ok(row >= 0, `Expected a visible coordinate target: ${step.locate.text}`);
            positions.set(step.locate.as, { column: lines[row].indexOf(step.locate.text) + 1, row: row + 1 });
            break;
          }
          case "clickRemembered": {
            assert.ok(positions.has(step.clickRemembered), "Expected a previously observed target position");
            const target = positions.get(step.clickRemembered);
            await app.mouse({ action: "press", ...target });
            await app.mouse({ action: "release", ...target });
            await screen();
            break;
          }
          case "doubleClick":
            await clickText({ ...context, text: step.doubleClick });
            await clickText({ ...context, text: step.doubleClick });
            await screen();
            break;
          case "exitNormally":
            assert.equal(step.exitNormally, true);
            await app.press("CTRL_C");
            exitCode = await app.waitForExit();
            assert.equal(exitCode, 0);
            await screen();
            break;
          case "expectExit":
            exitCode = await app.waitForExit();
            assert.equal(exitCode, step.expectExit);
            await screen();
            break;
          case "expectTerminalTitle": {
            const titles = [...context.output().matchAll(/\x1b\](?:0|2);([^\x07\x1b]*)(?:\x07|\x1b\\)/g)];
            assert.equal(titles.at(-1)?.[1], step.expectTerminalTitle);
            break;
          }
          case "expectTerminalSequences":
            for (const [kind, modes] of Object.entries(step.expectTerminalSequences)) {
              assert.ok(
                ["enabled", "enabledExactlyOnce"].includes(kind),
                `Unknown terminal sequence observation: ${kind}`
              );
              for (const mode of modes) {
                assert.match(mode, /^\d+$/);
                const count = context.output().split(`\x1b[?${mode}h`).length - 1;
                assert.ok(count > 0, `Mouse reporting ${mode} must be enabled by the real runtime`);
                if (kind === "enabledExactlyOnce") {
                  assert.equal(count, 1, `Mouse reporting ${mode} must only be enabled once`);
                }
              }
            }
            break;
          case "expectTerminalRestored": {
            const output = context.output();
            const restored =
              ["1000", "1002", "1006"].every((mode) => {
                const enabled = output.lastIndexOf(`\x1b[?${mode}h`);
                return enabled >= 0 && output.lastIndexOf(`\x1b[?${mode}l`) > enabled;
              }) && output.lastIndexOf("\x1b[?25h") > output.lastIndexOf("\x1b[?25l");
            assert.equal(restored, step.expectTerminalRestored);
            break;
          }
          case "click":
            await clickText({
              ...context,
              text: step.click,
              occurrence: step.occurrence ?? 0,
              area: step.area ?? "any",
              rowOffset: step.rowOffset ?? 0
            });
            await screen();
            break;
          case "resize":
            await app.resize(step.resize);
            break;
          case "screenshot":
            await screen();
            await app.screenshot({ name: step.screenshot });
            break;
          case "remember":
          case "unchanged":
            for (const domain of step[operation[0]]) {
              assert.match(domain, /^[a-z-]+$/);
              const file = domainFile(domain);
              let bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
              if (domain === "all-app-files") {
                const storage = path.join(home, ".ilu");
                bytes = Object.fromEntries(
                  fs
                    .readdirSync(storage, { recursive: true, withFileTypes: true })
                    .filter((entry) => {
                      assert.equal(
                        entry.isSymbolicLink(),
                        false,
                        "Application file observations must not follow symlinks"
                      );
                      return entry.isFile();
                    })
                    .map((entry) => {
                      const filename = path.join(entry.parentPath, entry.name);
                      return [path.relative(storage, filename), fs.readFileSync(filename)];
                    })
                );
              }
              if (operation[0] === "remember") {
                remembered.set(domain, bytes);
              } else {
                assert.ok(remembered.has(domain), `Missing remembered ${domain} data`);
                assert.deepEqual(bytes, remembered.get(domain), `TUI must preserve ${domain} bytes`);
              }
            }
            break;
          case "expect": {
            const supported = [
              "text",
              "texts",
              "absent",
              "sameRow",
              "sameRowOrdered",
              "overlayTexts",
              "separateRows",
              "withinViewport",
              "blankRowsAfter",
              "absentStandaloneTitle",
              "navActiveBackground",
              "navInactiveBackground",
              "navAsciiMarkers",
              "navSyncRightAligned",
              "activeTab",
              "footerActionsVisible",
              "footerClockSeconds",
              "footerColors",
              "footerAbsent",
              "footerWidth",
              "frameColumns",
              "frameRows",
              "helpCopyGuidance",
              "helpEscapeGuidance",
              "helpKeyboardGuidance",
              "advertisedTabShortcuts",
              "footerExitHint",
              "footerCopyHint",
              "footerCloseHint",
              "overlayAbsent",
              "error",
              "invalid",
              "copyAvailable",
              "pending",
              "translateAvailable",
              "dictionaryState",
              "languageExamples",
              "textPattern",
              "inputEquals",
              "pageBottomActions",
              "speechAvailable",
              "voiceChoiceAvailable",
              "audioReady",
              "overlayBottomActions",
              "overlayMargin",
              "overlayFullSurface",
              "controlBackground",
              "wrappedComplete",
              "empty",
              "moreVisibleThan",
              "footerChangedSince"
            ];
            for (const key of Object.keys(step.expect)) {
              assert.ok(supported.includes(key), `Unsupported TUI expectation: ${key}`);
            }
            await expectScreen({
              screen,
              message: `Expected TUI state: ${JSON.stringify(step.expect)}`,
              predicate: (text) => {
                const frame = context.frame();
                const lines = text.split("\n");
                const nav = frame.lines[0];
                const footer = frame.lines.at(-1).trimEnd();
                for (const [kind, value] of Object.entries(step.expect)) {
                  const values = Array.isArray(value) ? value : [value];
                  if (kind === "moreVisibleThan") {
                    assert.ok(remembered.has(`visible:${value.name}`));
                    if (
                      [...text.matchAll(new RegExp(value.pattern, "g"))].length <=
                      remembered.get(`visible:${value.name}`)
                    ) {
                      return false;
                    }
                  } else if (kind === "footerChangedSince") {
                    assert.ok(remembered.has(`footer:${value}`));
                    if (footer === remembered.get(`footer:${value}`)) {
                      return false;
                    }
                  } else if (kind === "overlayMargin" || kind === "overlayFullSurface") {
                    const top = frame.lines.findIndex((line) => line.includes("┌") && line.includes("┐"));
                    const bottom = frame.lines.findLastIndex((line) => line.includes("└") && line.includes("┘"));
                    if (top < 0 || bottom <= top) {
                      return false;
                    }
                    const left = frame.lines[top].indexOf("┌");
                    const right = frame.lines[top].lastIndexOf("┐");
                    const margin = kind === "overlayMargin" ? value : 0.1;
                    assert.equal(margin, 0.1);
                    if (kind === "overlayFullSurface") {
                      assert.equal(value, true);
                    }
                    if (
                      left !== Math.floor(frame.cols * margin) ||
                      top !== Math.floor(frame.rows * margin) ||
                      frame.cols - right - 1 !== left ||
                      frame.rows - bottom - 1 !== top ||
                      frame.lines.slice(top + 1, bottom).some((line) => line[left] !== "│" || line[right] !== "│")
                    ) {
                      return false;
                    }
                  } else if (kind === "controlBackground") {
                    for (const [label, color] of Object.entries(value)) {
                      const row = frame.lines.findLastIndex((line) => line.includes(label));
                      if (row < 0) {
                        return false;
                      }
                      const column = frame.lines[row].indexOf(label);
                      if (
                        !frame.backgrounds[row].slice(column, column + label.length).every((cell) => cell === color)
                      ) {
                        return false;
                      }
                    }
                  } else if (kind === "wrappedComplete") {
                    const compact = text.replace(/[│\s]/g, "");
                    if (!values.every((value) => compact.includes(value.replace(/\s/g, "")))) {
                      return false;
                    }
                  } else if (kind === "empty") {
                    assert.equal(value, true);
                    if (!/No (?:clocks|tasks|notes|cards|boards|lists)(?: yet| available|\.)/i.test(text)) {
                      return false;
                    }
                  } else if (
                    ["pending", "translateAvailable", "speechAvailable", "voiceChoiceAvailable"].includes(kind)
                  ) {
                    assert.equal(typeof value, "boolean");
                    const pending = text.includes("Translation in progress") || text.includes("Audio in progress");
                    if ((kind === "pending" ? pending : !pending) !== value) {
                      return false;
                    }
                  } else if (kind === "audioReady") {
                    assert.equal(value, true);
                    if (!text.includes("Audio ready.") || !fs.existsSync(externalConfig.privateAudioFile)) {
                      return false;
                    }
                  } else if (kind === "overlayBottomActions") {
                    const bottom = frame.lines.findLastIndex((line) => line.includes("└") && line.includes("┘"));
                    if (bottom < 1 || !values.every((label) => frame.lines[bottom - 1].includes(label))) {
                      return false;
                    }
                  } else if (kind === "pageBottomActions") {
                    if (!values.every((label) => frame.lines.at(-2).includes(label))) {
                      return false;
                    }
                  } else if (kind === "dictionaryState") {
                    assert.ok(["unqueried", "no-results"].includes(value));
                    if (
                      !text.includes(
                        value === "unqueried"
                          ? "Translate text to see dictionary entries"
                          : "No dictionary entries found"
                      )
                    ) {
                      return false;
                    }
                  } else if (kind === "languageExamples") {
                    assert.equal(value, true);
                    if (
                      !["en (English)", "es (Spanish)", "fr (French)", "auto (detect)"].every((example) =>
                        text.includes(example)
                      )
                    ) {
                      return false;
                    }
                  } else if (kind === "textPattern") {
                    if (!new RegExp(value).test(text)) {
                      return false;
                    }
                  } else if (kind === "inputEquals") {
                    assert.equal(value.label, "Text to translate");
                    const first = lines.findIndex((line) => line.includes("Text to translate ("));
                    const last = lines.findIndex((line) => line.includes("Language codes:"));
                    if (
                      first < 0 ||
                      last <= first ||
                      lines
                        .slice(first + 1, last)
                        .map((line) => line.trim())
                        .join("\n")
                        .trimEnd() !== value.text
                    ) {
                      return false;
                    }
                  } else if (kind === "error" || kind === "invalid") {
                    assert.equal(typeof value, "boolean");
                    const present =
                      kind === "invalid"
                        ? /(?:required|choose a|must be|up to 5,?000|too long)/i.test(text)
                        : /(?:could not|failed|unavailable|no translation|was not|not found)/i.test(text);
                    if (present !== value) {
                      return false;
                    }
                  } else if (kind === "copyAvailable") {
                    assert.equal(typeof value, "boolean");
                    const first = lines.findIndex((line) => line.trim() === "Translation");
                    const last = lines.findIndex((line) => line.trim() === "Dictionary");
                    if (first < 0 || last <= first || !text.includes("Copy result")) {
                      return false;
                    }
                    const available =
                      lines.slice(first + 1, last).some((line) => line.trim().length > 0) &&
                      !text.includes("Translation in progress");
                    if (available !== value) {
                      return false;
                    }
                  } else if (["footerExitHint", "footerCopyHint", "footerCloseHint"].includes(kind)) {
                    assert.equal(typeof value, "boolean");
                    const label = { footerExitHint: "Exit", footerCopyHint: "Copy", footerCloseHint: "Close" }[kind];
                    if (footer.includes(`Ctrl+C: ${label}`) !== value) {
                      return false;
                    }
                  } else if (
                    kind === "helpCopyGuidance" ||
                    kind === "helpEscapeGuidance" ||
                    kind === "helpKeyboardGuidance"
                  ) {
                    assert.equal(value, true);
                    const guidance = {
                      helpCopyGuidance: /Ctrl\+C.*cop(?:y|ies).*select.*(?:input|editor)/i,
                      helpEscapeGuidance: /Esc.*close.*Help/i,
                      helpKeyboardGuidance: /Tab.*focus[\s\S]*Enter.*activat/i
                    }[kind];
                    if (!guidance.test(text)) {
                      return false;
                    }
                  } else if (kind === "advertisedTabShortcuts") {
                    if (values.some((tab, index) => !text.includes(`Ctrl+${index + 1}: ${tab}`))) {
                      return false;
                    }
                  } else if (kind === "withinViewport") {
                    assert.equal(value, true);
                    if (lines.length > frame.rows || lines.some((line) => [...line].length > frame.cols)) {
                      return false;
                    }
                  } else if (kind === "frameColumns" || kind === "frameRows") {
                    if (frame[kind === "frameColumns" ? "cols" : "rows"] !== value) {
                      return false;
                    }
                  } else if (kind === "blankRowsAfter") {
                    const index = lines.findIndex((line) => line.includes(value.text));
                    if (
                      index < 0 ||
                      lines.slice(index + 1, index + 1 + value.count).length !== value.count ||
                      lines.slice(index + 1, index + 1 + value.count).some((line) => line.trim().length > 0)
                    ) {
                      return false;
                    }
                  } else if (kind === "absentStandaloneTitle") {
                    // A padded selector remains a usable control. The original
                    // regression rejects an extra unindented page heading.
                    if (lines.some((line) => line === value)) {
                      return false;
                    }
                  } else if (
                    kind === "navActiveBackground" ||
                    kind === "navInactiveBackground" ||
                    kind === "activeTab"
                  ) {
                    const backgrounds = kind === "activeTab" ? { [value]: "#315f9e" } : value;
                    for (const [label, color] of Object.entries(backgrounds)) {
                      const start = nav.indexOf(label);
                      if (
                        start < 0 ||
                        !frame.backgrounds[0].slice(start, start + label.length).every((cell) => cell === color)
                      ) {
                        return false;
                      }
                    }
                  } else if (kind === "navAsciiMarkers") {
                    assert.equal(value, false);
                    if (/[\[\]>*]/.test(nav)) {
                      return false;
                    }
                  } else if (kind === "navSyncRightAligned") {
                    assert.equal(value, true);
                    if (!nav.trimEnd().endsWith("Sync") || nav.indexOf("Sync") < frame.cols - 10) {
                      return false;
                    }
                  } else if (kind === "footerActionsVisible") {
                    assert.equal(value, true);
                    if (!footer.includes("Ctrl+K") || !/Ctrl\+C: (Exit|Copy|Close)/.test(footer)) {
                      return false;
                    }
                  } else if (kind === "footerAbsent") {
                    if (values.some((target) => footer.includes(target))) {
                      return false;
                    }
                  } else if (kind === "footerClockSeconds") {
                    if (
                      values.some(
                        (name) =>
                          !footer.includes(name) ||
                          !/^\s*\d{2}:\d{2}:\d{2}\b/.test(footer.slice(footer.indexOf(name) + name.length))
                      )
                    ) {
                      return false;
                    }
                  } else if (kind === "footerColors") {
                    for (const [name, color] of Object.entries(value)) {
                      const column = footer.indexOf(name);
                      if (
                        column < 0 ||
                        !frame.foregrounds
                          .at(-1)
                          .slice(column, column + name.length)
                          .every((cell) => cell === color)
                      ) {
                        return false;
                      }
                    }
                  } else if (kind === "footerWidth") {
                    if ([...footer].length !== value) {
                      return false;
                    }
                  } else if (kind === "absent" || kind === "overlayAbsent") {
                    if (values.some((target) => text.includes(target))) {
                      return false;
                    }
                  } else if (kind === "separateRows") {
                    const rows = values.map((target) => text.split("\n").findIndex((line) => line.includes(target)));
                    if (rows.some((row) => row < 0) || new Set(rows).size !== rows.length) {
                      return false;
                    }
                  } else if (kind === "sameRow" || kind === "sameRowOrdered") {
                    if (
                      !text
                        .split("\n")
                        .some((line) =>
                          values.every(
                            (target, index) =>
                              line.includes(target) &&
                              (kind === "sameRow" ||
                                index === 0 ||
                                line.indexOf(target) > line.indexOf(values[index - 1]))
                          )
                        )
                    ) {
                      return false;
                    }
                  } else if (values.some((target) => !text.includes(target))) {
                    return false;
                  }
                }
                return true;
              }
            });
            break;
          }
          default:
            throw new Error(`Unsupported TUI operation: ${operation[0]}`);
        }
      }
    } finally {
      for (const [directory, mode] of blockedDirectories) {
        fs.chmodSync(directory, mode);
      }
    }
    if (Array.isArray(context.restartCommand)) {
      await closeWorkspace();
      await app.type("exit");
      await app.press("ENTER");
      exitCode = await app.waitForExit();
      assert.equal(exitCode, 0);
    }
    return exitCode === null ? finish(context) : { exitCode };
  },

  async notesFocus(context) {
    const { app, screen } = context;
    const home = assertRepoTempHome(context.home, "Captured Notes HOME");
    await clickText({ app, screen, text: "Notes" });
    await expectScreen({
      screen,
      predicate: (text) => text.includes("Capture note"),
      message: "Notes must display its active list"
    });
    await app.screenshot({ name: "notes-list" });
    await clickText({ app, screen, text: "Archive Notes" });
    await expectScreen({
      screen,
      predicate: (text) => text.includes("Archived note") && !text.includes("Capture note"),
      message: "Switching lists must replace visible notes"
    });
    await app.screenshot({ name: "notes-selector-focus" });
    await clickText({ app, screen, text: "Capture Notes" });
    await clickText({ app, screen, text: "Capture note" });
    await app.screenshot({ name: "notes-list-focus" });
    await clickText({ app, screen, text: "Manage lists" });
    await expectScreen({
      screen,
      predicate: (text) => text.includes("Rename list") && text.includes("Archive Notes"),
      message: "List management must remain usable"
    });
    await app.screenshot({ name: "notes-manager" });
    await app.press("ESCAPE");
    const before = fs.readFileSync(path.join(home, ".ilu", "notes.json"), "utf8");
    await clickText({ app, screen, text: "Add note" });
    await app.type("Unsaved capture note");
    await clickText({ app, screen, text: "Note content", rowOffset: 1 });
    await app.type("Synthetic draft");
    await expectScreen({
      screen,
      predicate: (text) => text.includes("Synthetic draft") && text.includes("Cancel"),
      message: "The note editor must accept text"
    });
    await app.screenshot({ name: "notes-editor-focus" });
    await clickText({ app, screen, text: "Cancel" });
    assert.equal(
      fs.readFileSync(path.join(home, ".ilu", "notes.json"), "utf8"),
      before,
      "cancel must discard the note draft"
    );
    return finish(context);
  },

  async listEditor(context, { domain }) {
    const { app, screen } = context;
    const home = assertRepoTempHome(context.home, "Captured editor HOME");
    assert.ok(domain === "Todo" || domain === "Notes");
    const db = domain === "Todo" ? "todos" : "notes";
    await openItemEditor({ ...context, domain });
    const before = fs.readFileSync(path.join(home, ".ilu", `${db}.json`), "utf8");
    const visibleCounts = [];
    for (const size of [
      { cols: 80, rows: 24 },
      { cols: 100, rows: 40 },
      { cols: 80, rows: 24 }
    ]) {
      await app.resize(size);
      const frame = await expectScreen({
        screen,
        predicate: (text) =>
          text.includes("Save") &&
          text.includes("Cancel") &&
          /Row\d{2}/.test(text) &&
          text.split("\n").length <= size.rows,
        message: "Resize must keep editor content and actions visible"
      });
      assert.ok(frame.split("\n").every((line) => line.length <= size.cols));
      visibleCounts.push((frame.match(/Row\d{2}/g) ?? []).length);
      await app.screenshot({ name: `editor-${visibleCounts.length}` });
    }
    assert.ok(visibleCounts[1] > visibleCounts[0], "a taller editor must expose more real document lines");
    assert.equal(visibleCounts[2], visibleCounts[0]);
    await clickText({ app, screen, text: "Cancel" });
    assert.equal(fs.readFileSync(path.join(home, ".ilu", `${db}.json`), "utf8"), before);
    await openItemEditor({ ...context, domain });
    await clickText({ app, screen, text: domain === "Todo" ? "Task details" : "Note content", rowOffset: 1 });
    for (let row = 0; row < 44; row++) {
      await app.press("UP");
    }
    await app.press("HOME");
    await app.type("Edited capture ");
    await expectScreen({
      screen,
      predicate: (text) => text.includes("Edited capture ") && text.includes("Save") && text.includes("Cancel"),
      message: "Editing must preserve the document and its visible Save/Cancel controls"
    });
    await app.screenshot({ name: "editor-edited" });
    await clickText({ app, screen, text: "Save" });
    await expectScreen({
      screen,
      predicate: (text) => !text.includes("Cancel"),
      message: "Save must close the dialog"
    });
    const lists = readLists({ home, domain: db });
    const saved = lists
      .flatMap((list) => list[domain === "Todo" ? "tasks" : "notes"])
      .find((item) => item.title === (domain === "Todo" ? "Capture task" : "Capture note"));
    assert.ok(saved);
    const expected = `Edited capture ${Array.from({ length: 44 }, (_, index) => `Row${String(index + 1).padStart(2, "0")}`).join("\n")}`;
    assert.equal(domain === "Todo" ? saved.description : saved.content, expected);
    await app.screenshot({ name: "editor-saved" });
    return finish(context);
  },

  async boardLayout(context) {
    const { app, screen } = context;
    const home = assertRepoTempHome(context.home, "Captured Board HOME");
    await clickText({ app, screen, text: "Board" });
    const before = fs.readFileSync(path.join(home, ".ilu", "boards.json"), "utf8");
    const initial = await expectScreen({
      screen,
      predicate: (text) => text.includes("Long") && text.includes("Other"),
      message: "Both Board columns must be visible"
    });
    const start = (frame) =>
      frame
        .split("\n")
        .find((line) => line.includes("Long") && line.includes("Other"))
        ?.indexOf("Other") ?? -1;
    await app.screenshot({ name: "board-before" });
    await clickText({ app, screen, text: "Long" });
    await app.press("CTRL_K");
    const help = await expectScreen({
      screen,
      predicate: (text) => /layout|resiz/i.test(text),
      message: "Board Help must expose its resize action"
    });
    const hint = help.split("\n").find((line) => /layout|resiz|adjust.*column/i.test(line) && /Ctrl\+/i.test(line));
    const key = hint?.match(/\b(Ctrl\+[A-Z0-9]+)\b/i)?.[1];
    assert.ok(key, "a documented keyboard resize action must be available");
    await app.press("ESCAPE");
    await clickText({ app, screen, text: "Backlog" });
    await app.press(key.replace("+", "_").toUpperCase());
    await app.screenshot({ name: "board-layout-mode" });
    await app.press("SHIFT_RIGHT");
    await app.press("ESCAPE");
    const keyboard = await expectScreen({
      screen,
      predicate: (text) => start(text) > start(initial),
      message: "Columns must reflect keyboard resizing"
    });
    assert.ok(start(keyboard) > start(initial), "keyboard adjustment must move the real column boundary");
    await app.screenshot({ name: "board-keyboard" });
    const lines = keyboard.split("\n");
    const row = lines.findIndex((line) => line.includes("Long") && line.includes("Other"));
    const column = lines[row].lastIndexOf("│", lines[row].indexOf("Other"));
    assert.ok(column > 0);
    await app.mouse({ action: "press", column, row: row + 1 });
    await app.mouse({ action: "drag", column: column + 3, row: row + 1 });
    await app.mouse({ action: "release", column: column + 3, row: row + 1 });
    const dragged = await expectScreen({
      screen,
      predicate: (text) => text.includes("Long") && text.includes("Other") && start(text) > start(keyboard),
      message: "Dragging the divider must resize the real Board"
    });
    const headerStart = (frame) =>
      frame
        .split("\n")
        .find((line) => line.includes("Ready") && line.includes("(1)"))
        .indexOf("Ready");
    assert.equal(headerStart(dragged) - headerStart(keyboard), start(dragged) - start(keyboard));
    await app.screenshot({ name: "board-dragged" });
    await app.resize({ cols: 100, rows: 40 });
    await expectScreen({
      screen,
      predicate: (text) => text.includes("Other") && text.includes("Add card"),
      message: "Resized Board must preserve content and actions"
    });
    await app.screenshot({ name: "board-resized" });
    assert.equal(
      fs.readFileSync(path.join(home, ".ilu", "boards.json"), "utf8"),
      before,
      "layout adjustment must not move cards or persist sizes"
    );
    return finish(context);
  },

  async translateEditor(context) {
    const { app, screen } = context;
    await openItemEditor({ ...context, domain: "Notes" });
    await clickText({ app, screen, text: "Note content", rowOffset: 1 });
    await app.press("CTRL_A");
    await app.press("CTRL_C");
    await app.press("ESCAPE");
    await clickText({ app, screen, text: "Translate" });
    await clickText({ app, screen, text: "Text to translate (", rowOffset: 1 });
    await app.press("CTRL_V");
    for (const [index, size] of [
      { cols: 80, rows: 24 },
      { cols: 100, rows: 40 },
      { cols: 80, rows: 24 }
    ].entries()) {
      await app.resize(size);
      await expectScreen({
        screen,
        predicate: (text) =>
          text.includes("Row43") &&
          text.includes("Row44") &&
          text.includes("From") &&
          text.includes("To") &&
          text.includes("Copy result"),
        message: "Translate must preserve multiline text, language fields and actions after resize"
      });
      await app.screenshot({ name: `translate-${index + 1}` });
      // Only inputs and window size change. No translation provider is called.
    }
    return finish(context);
  },

  async helpFooter(context) {
    const { app, screen } = context;
    await clickText({ app, screen, text: "Notes" });
    await clickText({ app, screen, text: "Add note" });
    await app.type("Clipboard capture");
    await app.screenshot({ name: "footer-input" });
    await clickText({ app, screen, text: "Note content", rowOffset: 1 });
    await app.type("Copy roundtrip");
    await app.press("CTRL_A");
    await app.press("CTRL_C");
    await app.press("BACKSPACE");
    await app.press("CTRL_V");
    await expectScreen({
      screen,
      predicate: (text) => text.includes("Copy roundtrip") && /Ctrl\+C[^\n]*copy/i.test(text),
      message: "Editor copy and paste must work without closing the dialog"
    });
    await app.screenshot({ name: "footer-editor" });
    await app.press("CTRL_K");
    await expectScreen({
      screen,
      predicate: (text) => text.includes("Notes help"),
      message: "Help must cover the editor"
    });
    await app.screenshot({ name: "help-over-editor" });
    await app.press("ESCAPE");
    await expectScreen({
      screen,
      predicate: (text) => !text.includes("Notes help") && text.includes("Copy roundtrip"),
      message: "Esc must close Help and preserve the draft"
    });
    await app.screenshot({ name: "help-closed" });
    await clickText({ app, screen, text: "Save" });
    await expectScreen({
      screen,
      predicate: (text) => !text.includes("Cancel"),
      message: "The draft must remain saveable after Help"
    });
    const saved = readLists({ home: context.home, domain: "notes" })
      .flatMap((list) => list.notes)
      .find((note) => note.title === "Clipboard capture");
    assert.equal(saved?.content, "Copy roundtrip");
    return finish(context);
  },

  async cliFailure({ app, screen }) {
    const exitCode = await app.waitForExit();
    assert.notEqual(exitCode, 0, "the real CLI must reject an unsupported option");
    await expectScreen({
      screen,
      predicate: (text) => text.includes("--unsupported-capture-option") && /option|argument/i.test(text),
      message: "The CLI must identify the rejected option, not fail to launch"
    });
    await app.screenshot({ name: "cli-error" });
    return { exitCode };
  }
};

export function assertCaptureArtifacts({ result, checkpoints, testName, diagnostic }) {
  const outputRoot = path.join(root, "tmp", "terminal-captures");
  assert.equal(typeof testName, "string");
  const expectedStem = testName.toLowerCase().replace(/[^a-z0-9]/g, "");
  assert.ok(expectedStem.length > 0);
  assert.equal(
    path.resolve(result.directory),
    outputRoot,
    "published artifacts must use the flat capture directory, not a per-run subdirectory"
  );
  for (const file of [
    ...checkpoints.map((name) => result.screenshots[name]),
    result.videoPath,
    result.actionsPath,
    result.outputPath
  ]) {
    assert.equal(typeof file, "string", "the capture must expose image and diagnostic paths");
    assert.equal(
      path.dirname(path.resolve(file)),
      outputRoot,
      "PNG, MP4 and diagnostics must be direct children of the final capture directory"
    );
    assert.ok(
      path
        .basename(file)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .startsWith(expectedStem),
      "the inspecting user must be able to identify the test from each artifact name"
    );
  }
  for (const name of checkpoints) {
    assert.equal(typeof result.screenshots[name], "string", `missing physical PNG checkpoint ${name}`);
  }
  for (const [index, name] of Object.keys(result.screenshots).entries()) {
    const png = result.screenshots[name];
    assert.equal(typeof png, "string", `missing physical PNG checkpoint ${name}`);
    const numberedName = path.basename(png, ".png").match(/^(.*?)[ ._-](\d+)$/);
    assert.ok(numberedName, "PNG filenames must end in the capture consecutive number");
    assert.equal(
      numberedName[1].toLowerCase().replace(/[^a-z0-9]/g, ""),
      expectedStem,
      "PNG names must derive from the test, without random IDs or checkpoint labels"
    );
    assert.equal(
      Number(numberedName[2]),
      index + 1,
      "capture numbers must follow the capture order within this test, starting at one"
    );
    const bytes = fs.readFileSync(png);
    assert.ok(
      bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      `expected PNG bytes for ${name}`
    );
    assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0, "PNG must have nonzero image dimensions");
    diagnostic(`${name} (${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)} pixels): ${png}`);
  }
  assert.ok(fs.statSync(result.actionsPath).isFile(), "capture diagnostics must remain inspectable");
  assert.ok(fs.statSync(result.outputPath).size > 0, "the real CLI output must remain available for diagnosis");
  assert.equal(path.extname(result.videoPath), ".mp4");
  assert.equal(
    path
      .basename(result.videoPath, ".mp4")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ""),
    expectedStem,
    "each test must publish its own video without a random suffix"
  );
  // Read-only media validation, not recorder control or video finalization.
  const metadata = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_type,width,height:format=duration",
        "-of",
        "json",
        result.videoPath
      ],
      { encoding: "utf8" }
    )
  );
  assert.ok(
    Array.isArray(metadata.streams) &&
      metadata.streams.some((stream) => stream.codec_type === "video" && stream.width > 0 && stream.height > 0),
    "the MP4 must contain real video frames"
  );
  const duration = Number(metadata.format?.duration);
  assert.ok(Number.isFinite(duration) && duration > 0, "the MP4 must be finalized and playable");
  execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-i", result.videoPath, "-f", "null", "-"], { stdio: "pipe" });
  diagnostic(`Video: ${result.videoPath}`);
  diagnostic(`Application output: ${result.outputPath}`);
  diagnostic(`Capture diagnostics: ${result.directory}`);
}
