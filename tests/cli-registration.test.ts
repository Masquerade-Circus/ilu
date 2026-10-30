import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assertRepoTempHome } from "../support/home-sandbox.ts";
import { captureIluScenario } from "./test-helpers/terminal-capture.ts";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios.ts";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "bin", "cli.js");
const watchedFiles = [
  ".ilu/todos.json",
  ".ilu/notes.json",
  ".ilu/boards.json",
  ".ilu/clocks.json",
  ".ilu/.config/tts-config.json",
  ".ilu/.config/sync-pending.json",
  ".ilu/.sync-core/state.json"
];

// Integration input for the capture owner. cliSequence runs the real Node CLI
// commands sequentially in one physical terminal and one video, with a private
// HOME shared only by those commands. It captures cli-N after each command,
// plus explicitly named intermediate checkpoints. Each observation contains
// the actual exitCode, currentScreen and watched file bytes at that moment.
// waitFor observes the CURRENT PTY screen, not accumulated output. env applies
// to the real CLI child, and every command starts from the private HOME.
// seed prepares real model data before launch. It never replaces model methods.
// syncFixture builds real local Git histories with a common ancestor, then
// applies its local/remote data updates. All remotes/transports stay under tmp/.
// External fixtures intercept only HTTP/SDK or Git transport boundaries, fail
// closed on unmatched IO, and report real boundary requests by commandIndex.
async function captureRegistration({
  context,
  commands,
  seed = {},
  files = {},
  syncFixture = null,
  external = { denyUnmatched: true },
  env = {},
  checkpoints = []
}) {
  const result = await captureIluScenario({
    testName: context.name,
    command: ["sh"],
    scenario: "cliSequence",
    viewport: { cols: 120, rows: 48 },
    input: { cli, commands, seed, files, syncFixture, external, env, watchedFiles, cwd: "home" }
  });
  assertRepoTempHome(result.home, "CLI registration capture HOME");
  assert.ok(
    Array.isArray(result.externalRequests),
    "boundary observations must be available even when no external request occurs"
  );
  assert.ok(Array.isArray(result.observations));
  assert.equal(
    result.observations.length,
    commands.length,
    "every requested CLI invocation must finish and expose its actual observation"
  );
  for (const observation of result.observations) {
    assert.ok(Number.isInteger(observation.exitCode), "a missing exit status is not a successful CLI invocation");
    assert.equal(typeof observation.currentScreen, "string");
  }
  assertCaptureArtifacts({
    result,
    checkpoints: checkpoints.length > 0 ? checkpoints : commands.map((_, index) => `cli-${index + 1}`),
    testName: context.name,
    diagnostic: (message) => context.diagnostic(message)
  });
  return result;
}

function rows({ observation, domain }) {
  const document = JSON.parse(observation.files[`.ilu/${domain}.json`]);
  const items = domain === "clocks" ? document : document.collections[domain].data;
  assert.ok(Array.isArray(items), `the real ${domain} data must remain readable`);
  return items;
}

const boardSeed = {
  boards: [
    {
      title: "Registration Board",
      description: "",
      current: true,
      columns: [
        {
          title: "Backlog",
          cards: [
            { title: "First card", description: "" },
            { title: "Second card", description: "" }
          ]
        }
      ]
    }
  ]
};

test("configureProgram registra los comandos principales del CLI", async (context) => {
  const paths = [
    [],
    ["ui"],
    ["todo"],
    ["note"],
    ["board"],
    ["sync"],
    ["sync", "init"],
    ["sync", "status"],
    ["sync", "retry"],
    ["sync", "enable"],
    ["sync", "disable"],
    ["babel"],
    ["clock"],
    ["tts"],
    ["tts", "voice"],
    ["t"],
    ["n"],
    ["bd"],
    ["b"],
    ["c"]
  ];
  const result = await captureRegistration({ context, commands: paths.map((args) => ({ args: [...args, "--help"] })) });
  for (const [index, command] of paths.entries()) {
    const observation = result.observations[index];
    assert.equal(observation.exitCode, 0, `help must be reachable for ${command.join(" ") || "ilu"}`);
    assert.match(observation.currentScreen, /Usage:/i);
  }
  for (const name of ["ui", "todo", "note", "board", "sync", "babel", "clock", "tts"]) {
    assert.ok(result.observations[0].currentScreen.includes(name), `${name} must be discoverable`);
  }
  assert.match(result.observations[4].currentScreen, /--move/);
  assert.match(result.observations[11].currentScreen, /<text\.\.\.>/);
  assert.match(result.observations[13].currentScreen, /<inputFile>.*<outputFile>/);
});

test("configureProgram parsea tts con archivos sin requerir voice", async (context) => {
  const result = await captureRegistration({
    context,
    files: { "chapter.md": "# Registration audio\n" },
    seed: { ttsConfig: { apiKey: "synthetic-registration-key" } },
    external: { denyUnmatched: true, openai: { audioFixture: "short-valid-mp3" } },
    commands: [{ args: ["tts", "chapter.md", "chapter.mp3"] }]
  });
  assert.equal(result.observations[0].exitCode, 0);
  assert.ok(
    fs.statSync(path.join(result.home, "chapter.mp3")).size > 0,
    "positional paths must produce the requested audio file"
  );
  const requests = result.externalRequests.filter((request) => request.service === "openai");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.input, "# Registration audio\n");
  assert.equal(requests[0].body.voice, "alloy");
});

test("configureProgram parsea tts voice sin argumento posicional", async (context) => {
  const result = await captureRegistration({
    context,
    external: { denyUnmatched: true },
    commands: [
      {
        args: ["tts", "voice"],
        steps: [
          { waitFor: "Select a default TTS voice" },
          { capture: "voice-select" },
          ...Array.from({ length: 6 }, () => ({ key: "DOWN" })),
          { key: "ENTER" }
        ]
      }
    ],
    checkpoints: ["voice-select", "cli-1"]
  });
  assert.equal(result.observations[0].exitCode, 0);
  const config = JSON.parse(result.observations[0].files[".ilu/.config/tts-config.json"]);
  assert.equal(config.voice, "nova", "the no-positional subcommand must persist the choice made in its real prompt");
  assert.equal(result.externalRequests.length, 0, "selecting a voice must not generate audio or contact a provider");
});

test("configureProgram rechaza argumento posicional extra en tts voice", async (context) => {
  const result = await captureRegistration({ context, commands: [{ args: ["tts", "voice", "fable"] }] });
  const observation = result.observations[0];
  assert.equal(observation.exitCode, 1);
  assert.match(observation.currentScreen, /too many arguments/i);
  assert.equal(
    observation.files[".ilu/.config/tts-config.json"],
    null,
    "invalid syntax must not change the default voice"
  );
});

test("configureProgram preserva argumentos y defaults de babel al parsear con commander", async (context) => {
  const result = await captureRegistration({
    context,
    env: { LANG: "es_ES.UTF-8" },
    external: {
      denyUnmatched: true,
      googleTranslate: { response: { sentences: [{ trans: "Traduccion de registro" }], src: "es" } }
    },
    commands: [{ args: ["b", "hola", "mundo"] }]
  });
  assert.equal(result.observations[0].exitCode, 0);
  assert.match(result.observations[0].currentScreen, /Traduccion de registro/);
  const requests = result.externalRequests.filter((request) => request.service === "googleTranslate");
  assert.equal(requests.length, 1);
  const url = new URL(requests[0].url);
  assert.equal(url.searchParams.get("q"), "hola mundo");
  assert.equal(url.searchParams.get("sl"), "auto");
  assert.equal(url.searchParams.get("tl"), "es");
});

test("configureProgram registra board con default show cuando no recibe flags", async (context) => {
  const result = await captureRegistration({ context, seed: boardSeed, commands: [{ args: ["bd"] }] });
  const observation = result.observations[0];
  assert.equal(observation.exitCode, 0);
  assert.match(observation.currentScreen, /Registration Board/);
  assert.match(observation.currentScreen, /First card/);
  assert.match(observation.currentScreen, /Second card/);
  assert.equal(
    observation.files[".ilu/boards.json"],
    result.initialFiles[".ilu/boards.json"],
    "default show must not mutate the board"
  );
});

test("configureProgram normaliza aliases raros de board management y preserva priority", async (context) => {
  const commands = [
    {
      args: ["board", "--priority"],
      steps: [
        { waitFor: "Select the column to reorder" },
        { key: "ENTER" },
        { waitFor: "Select the card to move" },
        { key: "ENTER" },
        { waitFor: "to position" },
        { key: "CTRL_A" },
        { text: "2" },
        { key: "ENTER" }
      ]
    },
    {
      args: ["board", "-ab"],
      steps: [
        { waitFor: "Title of the board" },
        { text: "Alias board" },
        { key: "ENTER" },
        { waitFor: "Description of the board" },
        { key: "ENTER" },
        { waitFor: "Initial columns" },
        { key: "ENTER" },
        { waitFor: "Default column for new cards" },
        { key: "ENTER" }
      ]
    },
    {
      args: ["board", "-eb"],
      steps: [
        { waitFor: "Select the board to edit" },
        { text: "Alias board" },
        { key: "ENTER" },
        { waitFor: "Title of the board" },
        { key: "CTRL_A" },
        { text: "Renamed alias board" },
        { key: "ENTER" },
        { waitFor: "Description of the board" },
        { key: "ENTER" }
      ]
    },
    {
      args: ["board", "-rb"],
      steps: [{ waitFor: "Select the boards to remove" }, { key: "DOWN" }, { key: "SPACE" }, { key: "ENTER" }]
    }
  ];
  const result = await captureRegistration({ context, seed: boardSeed, commands });
  for (const observation of result.observations) {
    assert.equal(observation.exitCode, 0);
  }
  assert.deepEqual(
    rows({ observation: result.observations[0], domain: "boards" })[0].columns[0].cards.map((card) => card.title),
    ["Second card", "First card"]
  );
  assert.ok(
    rows({ observation: result.observations[1], domain: "boards" }).some((board) => board.title === "Alias board")
  );
  const renamed = rows({ observation: result.observations[2], domain: "boards" });
  assert.ok(renamed.some((board) => board.title === "Renamed alias board"));
  assert.equal(
    renamed.some((board) => board.title === "Alias board"),
    false
  );
  const remaining = rows({ observation: result.observations[3], domain: "boards" });
  assert.deepEqual(
    remaining.map((board) => board.title),
    ["Registration Board"]
  );
  assert.deepEqual(
    remaining[0].columns[0].cards.map((card) => card.title),
    ["Second card", "First card"]
  );
});

test("configureProgram registra clock --priority y -p", async (context) => {
  const move = [
    { waitFor: "Select the clock to move" },
    { key: "ENTER" },
    { waitFor: "to position" },
    { key: "CTRL_A" },
    { text: "2" },
    { key: "ENTER" }
  ];
  const result = await captureRegistration({
    context,
    seed: {
      clocks: [
        { name: "First clock", timezone: "Etc/UTC" },
        { name: "Second clock", timezone: "America/Mexico_City" }
      ]
    },
    commands: [
      { args: ["clock", "--priority"], steps: move },
      { args: ["clock", "-p"], steps: move }
    ]
  });
  assert.equal(result.observations[0].exitCode, 0);
  assert.equal(result.observations[1].exitCode, 0);
  assert.deepEqual(
    rows({ observation: result.observations[0], domain: "clocks" }).map((clock) => clock.name),
    ["Second clock", "First clock"]
  );
  assert.deepEqual(
    rows({ observation: result.observations[1], domain: "clocks" }).map((clock) => clock.name),
    ["First clock", "Second clock"]
  );
});

test("configureProgram registra ui y ejecuta Ui.action", async (context) => {
  const result = await captureRegistration({
    context,
    commands: [
      {
        args: ["ui"],
        steps: [
          { waitFor: "Todo" },
          { waitFor: "Notes" },
          { waitFor: "Board" },
          { capture: "workspace" },
          { key: "CTRL_C" }
        ]
      }
    ],
    checkpoints: ["workspace", "cli-1"]
  });
  assert.equal(
    result.observations[0].exitCode,
    0,
    "the real workspace must mount and exit through its public keyboard action"
  );
});

test("configureProgram bloquea una mutación de dominio cuando startup sync detecta conflicto", async (context) => {
  const result = await captureRegistration({
    context,
    syncFixture: {
      base: { todos: [{ title: "Base list", current: true, tasks: [] }] },
      local: {
        todos: [{ title: "Local divergent list", current: true, tasks: [{ title: "Preserved local task" }] }]
      },
      remote: { todos: [{ title: "Remote divergent list", current: true, tasks: [] }] },
      config: { enabled: true, autoSync: true, autoPull: true, autoPush: true }
    },
    commands: [
      { args: ["todo", "--add"] },
      { args: ["todo", "--add"] },
      { args: ["sync", "disable"] },
      { args: ["todo"] }
    ]
  });
  for (const observation of result.observations.slice(0, 2)) {
    assert.equal(observation.exitCode, 1);
    assert.match(observation.currentScreen, /conflict/i);
    assert.doesNotMatch(observation.currentScreen, /Title of the task/i);
    assert.equal(
      observation.files[".ilu/todos.json"],
      result.initialFiles[".ilu/todos.json"],
      "startup conflict must preserve local data before opening a mutation prompt"
    );
    assert.equal(JSON.parse(observation.files[".ilu/.sync-core/state.json"]).status, "conflict");
  }
  assert.equal(result.observations[2].exitCode, 0);
  assert.equal(result.observations[3].exitCode, 0);
  assert.match(result.observations[3].currentScreen, /Preserved local task/);
  assert.equal(result.observations[3].files[".ilu/todos.json"], result.initialFiles[".ilu/todos.json"]);
  assert.equal(
    result.externalRequests.filter((request) => request.service === "git" && request.operation === "push").length,
    0,
    "a rejected startup must not publish a conflicting resolution"
  );
});

test("configureProgram continúa con datos locales cuando startup sync queda degradado por red", async (context) => {
  const result = await captureRegistration({
    context,
    syncFixture: {
      base: {
        todos: [
          {
            title: "Offline local list",
            current: true,
            tasks: [{ title: "Offline local task", description: "", done: false }]
          }
        ]
      },
      config: { enabled: true, autoSync: true, autoPull: true, autoPush: true },
      transportFailure: { stderr: "network is unreachable", exitCode: 1 }
    },
    commands: [{ args: ["todo"] }]
  });
  const observation = result.observations[0];
  assert.equal(observation.exitCode, 0);
  assert.match(observation.currentScreen, /Offline local task/);
  assert.equal(observation.files[".ilu/todos.json"], result.initialFiles[".ilu/todos.json"]);
  const state = JSON.parse(observation.files[".ilu/.sync-core/state.json"]);
  assert.equal(state.status, "degraded_network");
  assert.equal(state.hasPendingRemote, true);
});

test("configureProgram ejecuta startup sync una vez antes de cada comando CLI que carga datos", async (context) => {
  const base = {
    todos: [{ title: "Base todos", current: true, tasks: [{ title: "Base task", description: "", done: false }] }],
    notes: [{ title: "Base notes", current: true, notes: [{ title: "Base note", content: "" }] }],
    boards: [{ title: "Base board", current: true, columns: [{ title: "Backlog", cards: [] }] }],
    clocks: [{ name: "Base clock", timezone: "Etc/UTC" }]
  };
  const updated = {
    todos: [{ title: "Remote todos", current: true, tasks: [{ title: "Remote task", description: "", done: false }] }],
    notes: [{ title: "Remote notes", current: true, notes: [{ title: "Remote note", content: "" }] }],
    boards: [{ title: "Remote board", current: true, columns: [{ title: "Backlog", cards: [] }] }],
    clocks: [{ name: "Remote clock", timezone: "Etc/UTC" }]
  };
  const remoteStages = [
    { ...base, todos: updated.todos },
    { ...base, todos: updated.todos, notes: updated.notes },
    { ...updated, clocks: base.clocks },
    updated
  ];
  const commands = ["todo", "note", "board", "clock"].map((name, index) => ({
    args: [name],
    before: index === 0 ? [] : [{ advanceRemote: { data: remoteStages[index], commitMessage: `Before ${name}` } }]
  }));
  const result = await captureRegistration({
    context,
    syncFixture: {
      base,
      remote: remoteStages[0],
      config: { enabled: true, autoSync: true, autoPull: true, autoPush: true }
    },
    commands
  });
  for (const [index, marker] of ["Remote task", "Remote note", "Remote board", "Remote clock"].entries()) {
    const observation = result.observations[index];
    assert.equal(observation.exitCode, 0);
    assert.ok(
      observation.currentScreen.includes(marker),
      "remote data must be integrated before the command reads its domain"
    );
    const fetches = result.externalRequests.filter(
      (request) => request.service === "git" && request.operation === "fetch" && request.commandIndex === index
    );
    assert.equal(
      fetches.length,
      1,
      "each data-loading CLI invocation must contact the controlled remote exactly once for startup reconciliation"
    );
    const state = JSON.parse(observation.files[".ilu/.sync-core/state.json"]);
    assert.equal(state.status, "healthy");
    assert.equal(state.hasPendingRemote, false);
  }
});

test("configureProgram omite startup sync en comandos que no cargan datos de usuario", async (context) => {
  const result = await captureRegistration({
    context,
    syncFixture: {
      base: { todos: [{ title: "Status-only list", current: true, tasks: [] }] },
      config: { enabled: true, autoSync: true, autoPull: true, autoPush: true }
    },
    commands: [{ args: ["sync", "status"] }]
  });
  const observation = result.observations[0];
  assert.equal(observation.exitCode, 0);
  assert.match(observation.currentScreen, /status|healthy/i);
  assert.equal(
    result.externalRequests.filter((request) => request.service === "git").length,
    0,
    "status must not fetch or publish as a side effect"
  );
  assert.equal(observation.files[".ilu/todos.json"], result.initialFiles[".ilu/todos.json"]);
});

test("bin/cli.js usa el tsconfig del paquete para ejecutar la TUI", async (context) => {
  const result = await captureRegistration({
    context,
    files: { "react-jsx-tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react" } }) },
    env: { TSX_TSCONFIG_PATH: "./react-jsx-tsconfig.json" },
    commands: [
      {
        args: ["ui"],
        steps: [{ waitFor: "Todo" }, { waitFor: "Notes" }, { capture: "hostile-config-workspace" }, { key: "CTRL_C" }]
      }
    ],
    checkpoints: ["hostile-config-workspace", "cli-1"]
  });
  assert.equal(result.observations[0].exitCode, 0);
  assert.doesNotMatch(fs.readFileSync(result.outputPath, "utf8"), /React is not defined/);
});
