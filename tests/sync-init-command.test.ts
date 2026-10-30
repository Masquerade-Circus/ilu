import test from "node:test";
import assert from "node:assert/strict";
import { captureIluScenario } from "./test-helpers/terminal-capture";
import { assertCaptureArtifacts } from "./test-helpers/terminal-capture-scenarios";

// syncWorkflow executes real bin/cli.js commands in the captured private shell.
// $REMOTE is substituted as ONE argv value, never interpolated as shell source.
// Rejected remote fixtures must be blocked at the Git process boundary as well.
const workflows = [
  {
    name: "sync init valida remote y usa branch main por default",
    fixture: { remote: "empty", local: { todos: "Local inbox" } },
    steps: [
      { action: "cli", args: ["sync", "init"], name: "rejected" },
      { action: "cli", args: ["sync", "init", "--remote", "$REMOTE"], name: "initialized" },
    ],
    check({ at }) {
      assert.notEqual(at.rejected.exitCode, 0);
      assert.equal(at.rejected.files[".config/sync-config.json"], null);
      assert.equal(at.rejected.transport.length, 0);
      assert.equal(at.initialized.exitCode, 0);
      const config = JSON.parse(at.initialized.files[".config/sync-config.json"]);
      assert.equal(config.branch, "main");
      assert.equal(config.remoteUrl, at.initialized.remotePath);
      assert.match(at.initialized.remoteFiles["todos.json"], /Local inbox/);
    },
  },
  {
    name: "sync init rechaza branch vacío explícito sin cambiar el default omitido",
    fixture: { remote: "empty", local: { todos: "Local inbox" } },
    steps: [
      { action: "cli", args: ["sync", "init", "--remote", "$REMOTE", "--branch", "   "], name: "rejected" },
      { action: "cli", args: ["sync", "init", "--remote", "$REMOTE"], name: "initialized" },
    ],
    check({ at }) {
      assert.notEqual(at.rejected.exitCode, 0);
      assert.equal(at.rejected.transport.length, 0);
      assert.equal(at.rejected.files[".config/sync-config.json"], null);
      assert.equal(at.initialized.exitCode, 0);
      assert.equal(JSON.parse(at.initialized.files[".config/sync-config.json"]).branch, "main");
    },
  },
  {
    name: "sync init rechaza nombres de branch inseguros antes de tocar bootstrap",
    fixture: { remote: "empty", local: { todos: "Untouched" } },
    steps: ["../main", "feature.lock", "feature..main", "feature@{main", "feature main", "-bad"].map((branch, index) => ({
      action: "cli", args: ["sync", "init", "--remote", "$REMOTE", "--branch", branch], name: `rejected-${index + 1}`,
    })),
    check({ at }) {
      assert.equal(Object.keys(at).length, 6, "every invalid branch must produce its own rejected command observation");
      for (const observation of Object.values(at) as any[]) {
        assert.notEqual(observation.exitCode, 0);
        assert.equal(observation.transport.length, 0);
        assert.equal(observation.files[".config/sync-config.json"], null);
        assert.match(observation.files["todos.json"], /Untouched/);
        assert.equal(observation.remoteHead, null);
      }
    },
  },
  {
    name: "sync init rechaza remotes con credenciales embebidas antes de tocar bootstrap",
    fixture: { remote: "none", denyExternalTransport: true },
    steps: ["https://user:synthetic@example.test/repo.git", "https://synthetic@example.test/repo.git", "https://ghp_SYNTHETIC@example.test/repo.git", "ssh://git:synthetic@example.test/repo.git"].map((remote, index) => ({
      action: "cli", args: ["sync", "init", "--remote", remote], name: `rejected-${index + 1}`,
    })),
    check({ at }) {
      assert.equal(Object.keys(at).length, 4, "every credential-bearing remote must be rejected independently");
      for (const observation of Object.values(at) as any[]) {
        assert.notEqual(observation.exitCode, 0);
        assert.equal(observation.transport.length, 0);
        assert.equal(observation.files[".config/sync-config.json"], null);
      }
    },
  },
  {
    name: "sync init rechaza remotes con formato ambiguo antes de tocar bootstrap",
    fixture: { remote: "none", denyExternalTransport: true },
    steps: ["https://", "ftp://example.test/repo.git", "git@example.test", "git@example.test:", "example.test/org/repo.git", "repo with spaces.git", "./tmp/repo.git\nnext"].map((remote, index) => ({
      action: "cli", args: ["sync", "init", "--remote", remote], name: `rejected-${index + 1}`,
    })),
    check({ at }) {
      assert.equal(Object.keys(at).length, 7, "every ambiguous remote must be rejected independently");
      for (const observation of Object.values(at) as any[]) {
        assert.notEqual(observation.exitCode, 0);
        assert.equal(observation.transport.length, 0);
        assert.equal(observation.files[".config/sync-config.json"], null);
      }
    },
  },
  {
    name: "sync init permite remotes SSH con usuario normal",
    fixture: { remote: "seeded", ssh: "local-boundary", denyExternalTransport: true, remoteData: { todos: "SSH seed" } },
    steps: [{ action: "cli", args: ["sync", "init", "--remote", "ssh://git@ilu-sync.invalid/repo.git"], name: "initialized" }],
    check({ at }) {
      assert.equal(at.initialized.exitCode, 0);
      assert.equal(JSON.parse(at.initialized.files[".config/sync-config.json"]).remoteUrl, "ssh://git@ilu-sync.invalid/repo.git");
      assert.match(at.initialized.files["todos.json"], /SSH seed/);
      assert.ok(at.initialized.transport.some(event => event.protocol === "ssh" && event.local === true));
    },
  },
  {
    name: "sync init en este test no escribe config real en disco",
    fixture: { remote: "empty", local: { todos: "Private inbox" }, homeCanary: true },
    steps: [{ action: "cli", args: ["sync", "init", "--remote", "$REMOTE"], name: "initialized" }],
    check({ at, home, canaryBefore, canaryAfter }) {
      assert.equal(at.initialized.exitCode, 0);
      assert.ok(home.includes("terminal-capture-workspaces"));
      assert.equal(JSON.parse(at.initialized.files[".config/sync-config.json"]).enabled, true);
      assert.equal(typeof canaryBefore, "string");
      assert.ok(canaryBefore.length > 0);
      assert.equal(canaryAfter, canaryBefore, "a separate controlled HOME must remain unchanged");
    },
  },
  {
    name: "sync init aborta si local y remoto ya tienen historia",
    fixture: { remote: "seeded", local: { todos: "Local original" }, remoteData: { todos: "Remote original" } },
    steps: [
      { action: "observe", name: "before" },
      { action: "cli", args: ["sync", "init", "--remote", "$REMOTE"], name: "rejected" },
    ],
    check({ at }) {
      assert.notEqual(at.rejected.exitCode, 0);
      assert.equal(at.rejected.files["todos.json"], at.before.files["todos.json"]);
      assert.equal(at.rejected.remoteHead, at.before.remoteHead);
      assert.equal(at.rejected.files[".config/sync-config.json"], null);
    },
  },
  {
    name: "sync init inspecciona bootstrap usando source root e ignore patterns del consumer",
    fixture: { remote: "seeded", excludedFiles: { ".config/canary.json": "synthetic-private" }, remoteData: { todos: "Adopted seed" } },
    steps: [{ action: "cli", args: ["sync", "init", "--remote", "$REMOTE"], name: "initialized" }],
    check({ at }) {
      assert.equal(at.initialized.exitCode, 0, "excluded configuration must not count as local application history");
      assert.match(at.initialized.files["todos.json"], /Adopted seed/);
      assert.equal(at.initialized.files[".config/canary.json"], "synthetic-private");
      assert.equal(at.initialized.remoteFiles[".config/canary.json"], null);
    },
  },
  {
    name: "sync init usa la factory única con backend explícito para publicar datos locales iniciales",
    fixture: { remote: "empty", local: { todos: "Published seed" }, excludedFiles: { ".config/canary.json": "synthetic-private" } },
    steps: [{ action: "cli", args: ["sync", "init", "--remote", "$REMOTE"], name: "initialized" }],
    check({ at }) {
      assert.equal(at.initialized.exitCode, 0);
      assert.match(at.initialized.remoteFiles["todos.json"], /Published seed/);
      assert.equal(at.initialized.remoteFiles[".config/canary.json"], null);
      assert.equal(at.initialized.remoteFiles[".sync-core/state.json"], null);
      assert.equal(JSON.parse(at.initialized.files[".config/sync-config.json"]).enabled, true);
    },
  },
];

for (const { name, fixture, steps, check } of workflows) {
  test(name, async (t) => {
    const checkpoints = steps.filter(step => typeof step.name === "string").map(step => step.name);
    const result = await captureIluScenario({ testName: t.name, command: ["bash", "--noprofile", "--norc"], scenario: "syncWorkflow", input: { fixture, steps: [...steps, { action: "exit" }] } });
    assertCaptureArtifacts({ result, checkpoints, testName: t.name, diagnostic: message => t.diagnostic(message) });
    check(result);
    assert.equal(result.exitCode, 0);
  });
}
