import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launchTerminal } from "@valyrianjs/terminal/testing";
import { captureScenarios } from "./terminal-capture-scenarios.ts";
import { createCaptureScreenReader } from "./terminal-capture-screen.ts";
import { prepareSyncCapture } from "./terminal-capture-sync.ts";
import { prepareCliSequence, runCliSequence } from "./terminal-capture-cli.ts";

const [requestPath, responsePath] = process.argv.slice(2);
const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
const outputDir = path.dirname(requestPath);
const finalDirectory = path.resolve(import.meta.dirname, "..", "..", "tmp", "terminal-captures");
const stem = request.artifactStem;
if (typeof stem !== "string" || !/^[a-z0-9][a-z0-9-]{0,179}$/.test(stem)) {
  throw new Error("Invalid capture artifact name");
}
let app = null;
let failure = null;
let outcome = null;
let artifacts = null;
let directory = null;
const screenshots = {};
let syncFixture = null;
let cliHome = null;
let cliSync = null;
try {
  let command = request.command;
  const environment = { ...request.env };
  const babelAdapter = request.scenario === "adapterBehavior" && request.input.area === "babel";
  const ttsAdapter = request.scenario === "adapterBehavior" && request.input.area === "tts";
  const traceAudioEncoder = ttsAdapter && request.input.caseId === "tts-missing-credentials";
  if (request.scenario === "adapterBehavior" && !babelAdapter) {
    if (!["todo", "notes", "clocks", "tts"].includes(request.input.area)) {
      throw new Error(`Adapter fixture not integrated: ${request.input.area}`);
    }
    const prepared = prepareCliSequence({
      workspaceRoot: outputDir,
      input: {
        files: ttsAdapter ? request.input.fixture.files : {},
        syncFixture: null,
        seed: {
          todos: [],
          notes: [],
          boards: [],
          clocks: [],
          ...(ttsAdapter
            ? {
                ttsConfig: {
                  voice: request.input.fixture.storedVoice ?? "alloy",
                  ...(request.input.fixture.credentials === "synthetic-local-only"
                    ? { apiKey: "synthetic-test-key-not-a-credential" }
                    : {})
                }
              }
            : {
                [request.input.area === "clocks" ? "clocks" : request.input.area === "todo" ? "todos" : "notes"]:
                  request.input.area === "clocks" ? request.input.fixture.clocks : request.input.fixture.lists
              })
        }
      }
    });
    cliHome = prepared.home;
    command = ["sh"];
  }
  if (request.scenario === "cliSequence") {
    const prepared = prepareCliSequence({ workspaceRoot: outputDir, input: request.input });
    cliHome = prepared.home;
    cliSync = prepared.sync;
    if (cliSync !== null) {
      const { HOME, ...gitEnvironment } = cliSync.environment;
      Object.assign(environment, gitEnvironment);
    }
  }
  if (request.scenario === "syncWorkflow") {
    syncFixture = prepareSyncCapture({ workspaceRoot: outputDir, fixture: request.input.fixture });
    const { HOME, ...gitEnvironment } = syncFixture.environment;
    Object.assign(environment, gitEnvironment);
  }
  const translation = request.scenario.startsWith("translation");
  const cliSequence = request.scenario === "cliSequence";
  const tui = request.scenario === "tuiInteraction" || babelAdapter || ttsAdapter;
  const tuiSeed = tui ? { ...request.input.seed } : {};
  const speech = tui && Object.hasOwn(tuiSeed, "tts") ? tuiSeed.tts : null;
  if (speech !== null) {
    for (const key of Object.keys(speech)) {
      if (!["syntheticCredentials", "voice", "inputText"].includes(key)) {
        throw new Error(`Unknown synthetic Speech fixture: ${key}`);
      }
    }
    if (
      speech.syntheticCredentials !== true ||
      typeof speech.voice !== "string" ||
      typeof speech.inputText !== "string"
    ) {
      throw new Error("Speech capture requires explicit synthetic credentials, voice and input text");
    }
    delete tuiSeed.tts;
    tuiSeed.ttsConfig = { apiKey: "synthetic-test-key-not-a-credential", voice: speech.voice };
  }
  const restartableTui =
    request.scenario === "tuiInteraction" &&
    request.input.steps.some((step) => Object.hasOwn(step, "restartAppNormally"));
  if (restartableTui) {
    command = ["sh"];
  }
  if (translation || cliSequence || tui) {
    if (cliSequence) {
      const external = request.input.external;
      for (const key of Object.keys(external)) {
        if (!["denyUnmatched", "googleTranslate", "openai"].includes(key)) {
          throw new Error(`CLI external fixture not yet integrated: ${key}`);
        }
      }
    }
    const fixtureDirectory = path.join(outputDir, "external-services");
    fs.mkdirSync(fixtureDirectory, { mode: 0o700 });
    const config = {
      ...((cliSequence && request.input.external.openai) || speech !== null || ttsAdapter
        ? {
            openaiAudioBase64: (() => {
              if (speech === null && !ttsAdapter && request.input.external.openai.audioFixture !== "short-valid-mp3") {
                throw new Error("Unsupported synthetic audio fixture");
              }
              return execFileSync("ffmpeg", [
                "-nostdin",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=0.18",
                "-f",
                "mp3",
                "pipe:1"
              ]).toString("base64");
            })()
          }
        : {}),
      responses: cliSequence
        ? request.input.external.googleTranslate
          ? [{ status: 200, body: request.input.external.googleTranslate.response }]
          : []
        : tui || request.scenario === "translationValidation"
          ? []
          : request.scenario === "translationMalformedResults"
            ? request.input.bodies.map((body) => ({ status: 200, body }))
            : Array.isArray(request.input.http)
              ? request.input.http
              : [request.input.http],
      ...(request.scenario === "translationValidation" || request.scenario === "translationMalformedResults"
        ? {
            commands:
              request.scenario === "translationValidation"
                ? request.input.commands
                : request.input.bodies.map(() => command),
            sequenceDirectory: fixtureDirectory
          }
        : {}),
      requestsPath: path.join(fixtureDirectory, "requests.jsonl"),
      ...(tui
        ? {
            tuiProviderPath: path.join(fixtureDirectory, "provider.json"),
            releasesDirectory: path.join(fixtureDirectory, "releases")
          }
        : {}),
      ...(speech !== null
        ? {
            syntheticTextFile: path.join(fixtureDirectory, "speech-input.txt"),
            privateAudioFile: path.join(fixtureDirectory, "speech-output.mp3")
          }
        : {}),
      clipboardPath: path.join(fixtureDirectory, "clipboard.txt"),
      clipboardRequestsPath: path.join(fixtureDirectory, "clipboard-requests.jsonl"),
      systemClipboardAvailable: !babelAdapter || request.input.fixture.systemClipboard !== "unavailable",
      clipboardWritesPath: path.join(fixtureDirectory, "clipboard-writes.jsonl")
    };
    if (cliSync !== null) {
      const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
      const transport = JSON.stringify(request.input.syncFixture.transportFailure ?? null);
      fs.writeFileSync(
        path.join(fixtureDirectory, "git"),
        `#!/usr/bin/env -S -u NODE_OPTIONS node
import fs from "node:fs";
import cp from "node:child_process";
const args = process.argv.slice(2);
const operation = args.find(arg => ["fetch", "push", "pull", "ls-remote"].includes(arg));
if (operation) {
  fs.appendFileSync(${JSON.stringify(config.requestsPath)}, JSON.stringify({service: "git", operation, commandIndex: Number(process.env.ILU_CAPTURE_HTTP_INDEX)}) + "\\n");
  const failure = ${transport};
  if (failure !== null) { process.stderr.write(failure.stderr); process.exitCode = failure.exitCode; }
  else { const result = cp.spawnSync(${JSON.stringify(realGit)}, args, {stdio: "inherit"}); process.exitCode = result.status ?? 1; }
} else { const result = cp.spawnSync(${JSON.stringify(realGit)}, args, {stdio: "inherit"}); process.exitCode = result.status ?? 1; }
`,
        { mode: 0o700, flag: "wx" }
      );
    }
    fs.writeFileSync(config.requestsPath, "", { mode: 0o600 });
    if (tui) {
      fs.mkdirSync(config.releasesDirectory, { mode: 0o700 });
    }
    if (speech !== null) {
      fs.writeFileSync(config.syntheticTextFile, speech.inputText, { flag: "wx", mode: 0o600 });
    }
    fs.writeFileSync(config.clipboardWritesPath, "", { mode: 0o600 });
    fs.writeFileSync(config.clipboardRequestsPath, "", { mode: 0o600 });
    fs.writeFileSync(config.clipboardPath, request.input.clipboardBefore ?? "", { mode: 0o600 });
    environment.ILU_CAPTURE_HTTP_CONFIG = path.join(fixtureDirectory, "config.json");
    fs.writeFileSync(environment.ILU_CAPTURE_HTTP_CONFIG, JSON.stringify(config), { mode: 0o600 });
    const clipboardProgram = path.join(import.meta.dirname, "terminal-capture-clipboard.ts");
    for (const executable of ["xsel", "xclip", "wl-copy", "wl-paste"]) {
      fs.writeFileSync(
        path.join(fixtureDirectory, executable),
        `#!/bin/sh\nexec env -u NODE_OPTIONS node --import tsx '${clipboardProgram}' "$0" "$@"\n`,
        { mode: 0o700 }
      );
    }
    environment.PATH = `${fixtureDirectory}:${process.env.PATH}`;
    if (cliSequence || tui) {
      environment.NODE_OPTIONS = `--import tsx --import ${path.join(import.meta.dirname, "terminal-capture-http.ts")}`;
    } else if (Object.hasOwn(config, "commands")) {
      command = ["node", "--import", "tsx", path.join(import.meta.dirname, "terminal-capture-sequence.ts")];
    } else if (command[0] !== "node") {
      throw new Error("Isolated translation requires the real Node CLI");
    } else {
      command = [
        "node",
        "--import",
        "tsx",
        "--import",
        path.join(import.meta.dirname, "terminal-capture-http.ts"),
        ...command.slice(1)
      ];
    }
  }
  if (request.scenario === "tuiInteraction") {
    for (const key of Object.keys(request.input)) {
      if (!["seed", "steps", "finish", "externalIsolation"].includes(key)) {
        throw new Error(`Unsupported TUI setup requirement: ${key}`);
      }
    }
    if (Object.hasOwn(request.input, "externalIsolation") && request.input.externalIsolation !== "deny-unmatched") {
      throw new Error("The TUI HTTP boundary must reject unmatched requests");
    }
  }
  const cwd =
    cliHome ??
    request.cwd ??
    (speech !== null ? path.join(outputDir, "external-services") : path.resolve(import.meta.dirname, "..", ".."));
  if (traceAudioEncoder) {
    command = [
      "strace",
      "-f",
      "-q",
      "-e",
      "trace=execve",
      "-s",
      "512",
      "-o",
      path.join(outputDir, "application-exec.log"),
      ...command
    ];
  }
  app = await launchTerminal({
    backend: "kitty",
    command,
    cwd,
    env: {
      ...environment,
      ...(request.scenario === "tuiInteraction" ? { ILU_CAPTURE_SEED_JSON: JSON.stringify(tuiSeed) } : {})
    },
    outputDir,
    runName: "capture",
    videoName: `${stem}.mp4`,
    viewport: request.viewport,
    video: "on",
    timeoutMs: 8000
  });
  directory = path.join(outputDir, "capture");
  const outputPath = path.join(directory, "terminal-output.bin");
  const reader = createCaptureScreenReader({ directory });
  const screen = async () => {
    const deadline = Date.now() + 8000;
    let previous = -1;
    while (Date.now() < deadline) {
      const length = fs.statSync(outputPath).size;
      await Bun.sleep(30);
      if (length === previous && length === fs.statSync(outputPath).size) {
        return reader.read();
      }
      previous = length;
    }
    throw new Error("The captured PTY did not settle for a screen observation");
  };
  const interactions = {
    ...app,
    async screenshot({ name }) {
      const file = await app.screenshot({ name });
      screenshots[name] = file;
      return file;
    },
    async resize(size) {
      const before = fs.statSync(outputPath).size;
      const status = JSON.parse(fs.readFileSync(path.join(directory, "application.json"), "utf8"));
      reader.resize(size);
      await app.resize(size);
      if (status.cols !== size.cols || status.rows !== size.rows) {
        const deadline = Date.now() + 8000;
        while (fs.statSync(outputPath).size === before) {
          if (Date.now() >= deadline) {
            throw new Error("The application did not redraw after the physical TTY resize");
          }
          await Bun.sleep(20);
        }
      }
      await screen();
    }
  };
  if (cliSequence) {
    outcome = await runCliSequence({
      app: interactions,
      screen,
      home: path.join(directory, "home"),
      workspaceRoot: outputDir,
      input: request.input,
      sync: cliSync,
      expectScreen: async (predicate, message) => {
        const deadline = Date.now() + 8000;
        let current = "";
        do {
          current = await screen();
          if (predicate(current)) {
            return current;
          }
          await Bun.sleep(25);
        } while (Date.now() < deadline);
        throw new Error(`${message}\n${current}`);
      }
    });
    const config = JSON.parse(fs.readFileSync(environment.ILU_CAPTURE_HTTP_CONFIG, "utf8"));
    outcome.externalRequests = fs
      .readFileSync(config.requestsPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } else {
    if (!Object.hasOwn(captureScenarios, request.scenario)) {
      throw new Error("Unknown capture scenario");
    }
    outcome = await captureScenarios[request.scenario](
      {
        app: interactions,
        home: path.join(directory, "home"),
        externalDirectory: path.join(outputDir, "external-services"),
        syncFixture,
        restartCommand: restartableTui ? request.command : null,
        cwd,
        execTracePath: traceAudioEncoder ? path.join(outputDir, "application-exec.log") : null,
        screen,
        output: () => fs.readFileSync(outputPath, "utf8"),
        frame: () => reader.frame()
      },
      request.input
    );
  }
} catch (error) {
  failure = error;
  if (app !== null) {
    try {
      screenshots["scenario-failure"] = await app.screenshot({ name: "scenario-failure" });
    } catch (captureError) {
      failure = new AggregateError([error, captureError], "Scenario and failure screenshot failed");
    }
  }
} finally {
  if (app !== null) {
    try {
      await app.close();
    } catch (error) {
      failure = failure === null ? error : new AggregateError([failure, error], "Scenario and capture cleanup failed");
    }
  }
}
// The library owns recorder finalization and resource cleanup. Publish only
// after close(), including diagnostics and checkpoints from a failed scenario.
try {
  if (directory === null) {
    const fixedDirectory = path.join(outputDir, "capture");
    if (fs.existsSync(fixedDirectory)) {
      directory = fixedDirectory;
    }
  }
  if (directory !== null) {
    const publishedScreenshots = {};
    for (const [index, [name, file]] of Object.entries(screenshots).entries()) {
      const destination = path.join(finalDirectory, `${stem}-${index + 1}.png`);
      fs.renameSync(file, destination);
      publishedScreenshots[name] = destination;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile()) {
        const destination = entry.name === `${stem}.mp4` ? `${stem}.mp4` : `${stem}.${entry.name}`;
        fs.renameSync(path.join(directory, entry.name), path.join(finalDirectory, destination));
      }
    }
    artifacts = {
      directory: finalDirectory,
      videoPath: path.join(finalDirectory, `${stem}.mp4`),
      screenshots: publishedScreenshots,
      actionsPath: path.join(finalDirectory, `${stem}.actions.json`)
    };
  }
} catch (error) {
  failure = failure === null ? error : new AggregateError([failure, error], "Scenario and artifact publication failed");
}
const result =
  failure === null
    ? {
        ok: true,
        value: { ...outcome, ...artifacts, outputPath: path.join(finalDirectory, `${stem}.terminal-output.bin`) }
      }
    : {
        ok: false,
        error:
          failure instanceof Error
            ? `${failure.stack}\n${failure instanceof AggregateError ? failure.errors.map(String).join("\n") : ""}`
            : String(failure)
      };
fs.writeFileSync(responsePath, JSON.stringify(result, null, 2), { mode: 0o600 });
process.exitCode = failure === null ? 0 : 1;
