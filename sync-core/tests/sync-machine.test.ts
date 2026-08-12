import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as __cjsImport48 from "x-robot";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { invoke } = __cjsImport48;
const repoRoot = process.cwd();
const machineModulePath = path.join(repoRoot, "src", "machine.ts");
const diagramModulePath = path.join(repoRoot, "src", "diagram.ts");

function createMachine(context: any = {}) {
  delete require.cache[require.resolve(machineModulePath)];
  const { createSyncMachine } = require(machineModulePath);
  return createSyncMachine(context);
}

test("sync machine starts healthy by default", () => {
  const machine = createMachine();
  assert.equal(machine.current, "healthy");
});

test("sync machine transitions healthy -> pending_remote -> syncing -> healthy", async () => {
  const machine = createMachine({ status: "healthy" });

  await invoke(machine, "LOCAL_PERSISTED", { domain: "todos", action: "save" });
  assert.equal(machine.current, "pending_remote");
  assert.equal(machine.context.hasPendingRemote, true);
  assert.equal(machine.context.lastSyncReason, "save");

  await invoke(machine, "SYNC_REQUESTED", { runSyncPipeline: async () => {} });
  assert.equal(machine.current, "healthy");
});

test("sync machine transitions syncing failures to degraded states", async () => {
  const networkMachine = createMachine({ status: "pending_remote" });
  await invoke(networkMachine, "SYNC_REQUESTED", { runSyncPipeline: async () => ({ kind: "network" }) });
  assert.equal(networkMachine.current, "degraded_network");

  const authMachine = createMachine({ status: "pending_remote" });
  await invoke(authMachine, "SYNC_REQUESTED", { runSyncPipeline: async () => ({ kind: "auth" }) });
  assert.equal(authMachine.current, "degraded_auth");

  const conflictMachine = createMachine({ status: "pending_remote" });
  await invoke(conflictMachine, "SYNC_REQUESTED", { runSyncPipeline: async () => ({ kind: "conflict" }) });
  assert.equal(conflictMachine.current, "conflict");
});

test("sync machine does not expose app lifecycle or manual retry transitions", async () => {
  const machine = createMachine({ status: "healthy" });
  assert.throws(() => invoke(machine, "DISABLE"), /does not exist/);
  assert.equal(machine.current, "healthy");
  await invoke(machine, "LOCAL_PERSISTED", { action: "save" });
  assert.throws(() => invoke(machine, "RETRY"), /does not exist/);
  assert.equal(machine.current, "pending_remote");
});

test("sync machine rehydrates hasPendingRemote from persisted state", () => {
  const machine = createMachine({ status: "degraded_network", hasPendingRemote: true });
  assert.equal(machine.context.hasPendingRemote, true);
});

test("generated diagram omits app lifecycle and manual retry transitions", async () => {
  const tmpRoot = path.join(repoRoot, "tmp");
  fs.mkdirSync(tmpRoot, { recursive: true });
  const outDir = fs.mkdtempSync(path.join(tmpRoot, "sync-diagram-"));
  try {
    const { generateSyncDiagrams } = require(diagramModulePath);
    const { mermaidPath } = await generateSyncDiagrams({ outDir });
    const mermaid = fs.readFileSync(mermaidPath, "utf8");
    assert.doesNotMatch(mermaid, /ENABLE|DISABLE|RETRY|disabled/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
