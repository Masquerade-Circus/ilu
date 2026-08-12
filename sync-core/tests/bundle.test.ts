import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const packageRoot = process.cwd();
const bundles = [path.join(packageRoot, "dist", "sync-core.js"), path.join(packageRoot, "dist", "sync-core.min.js")];

function assertApi(api: Record<string, unknown>) {
  assert.deepEqual(Object.keys(api).sort(), ["createSyncRuntime"]);
}

test("CommonJS and ESM package conditions expose the minimal API", async () => {
  assertApi(require("sync-core"));
  assertApi(await import("sync-core"));
});

test("browser global and AMD bundles load but reject runtime creation with the stable Node-only error", async () => {
  for (const bundlePath of bundles) {
    let amdFactory: (() => Record<string, any>) | null = null;
    const amdContext = {
      define(_dependencies: string[], factory: () => Record<string, any>) {
        amdFactory = factory;
      }
    } as Record<string, any>;
    amdContext.define.amd = {};
    vm.runInNewContext(fs.readFileSync(bundlePath, "utf8"), amdContext);
    const amdApi = amdFactory!();
    assertApi(amdApi);
    await assert.rejects(amdApi.createSyncRuntime({}), /supports Node\.js only/);

    const globalContext: Record<string, any> = {};
    vm.runInNewContext(fs.readFileSync(bundlePath, "utf8"), globalContext);
    assertApi(globalContext.SyncCore);
    await assert.rejects(globalContext.SyncCore.createSyncRuntime({}), /supports Node\.js only/);
  }
});

test("removed file store subpath and declarations do not exist", () => {
  for (const removed of [
    "file-state-store.cjs",
    "file-state-store.mjs",
    path.join("types", "file-state-store.d.ts"),
    path.join("types", "state", "file-store.d.ts")
  ]) {
    assert.equal(fs.existsSync(path.join(packageRoot, "dist", removed)), false, removed);
  }
  const declarations = fs.readFileSync(path.join(packageRoot, "dist", "types", "index.d.ts"), "utf8");
  for (const removed of [
    "SyncStateStore",
    "stateStore",
    "notifyLocalMutation",
    "retry(",
    "enable(",
    "disable(",
    "receiveRemote",
    "publishLocal",
    "description:"
  ]) {
    assert.equal(declarations.includes(removed), false, removed);
  }
});

test("package ships declarations only for public entrypoints", () => {
  assert.deepEqual(fs.readdirSync(path.join(packageRoot, "dist", "types")).sort(), [
    "diagram.d.ts",
    "git.d.ts",
    "index.d.ts"
  ]);
  const indexDeclarations = fs.readFileSync(path.join(packageRoot, "dist", "types", "index.d.ts"), "utf8");
  assert.doesNotMatch(indexDeclarations, /PersistedSyncState|ResolvedSyncRuntimeOptions/);
  assert.match(fs.readFileSync(path.join(packageRoot, "dist", "types", "git.d.ts"), "utf8"), /from "\.\/index\.js"/);
});

test("Git subpath has identical named exports in CJS, ESM and declarations", async () => {
  const expected = ["classifyError", "createGitBackend"];
  assert.deepEqual(Object.keys(require("sync-core/git")).sort(), expected);
  assert.deepEqual(Object.keys(await import("sync-core/git")).sort(), expected);
  const declaration = fs.readFileSync(path.join(packageRoot, "dist", "types", "git.d.ts"), "utf8");
  assert.match(declaration, /export \{ createGitBackend, classifyError \}/);
  assert.doesNotMatch(declaration, /export default|_default/);
});

test("Git declarations accept named imports and reject a default import", () => {
  const rootPath = fs.mkdtempSync(path.join(packageRoot, "tmp", "git-types-"));
  const nodeModules = path.join(rootPath, "node_modules");
  fs.mkdirSync(nodeModules, { recursive: true });
  fs.symlinkSync(packageRoot, path.join(nodeModules, "sync-core"), "dir");
  fs.writeFileSync(path.join(rootPath, "package.json"), '{"type":"module"}\n');
  fs.writeFileSync(
    path.join(rootPath, "named.ts"),
    'import { createGitBackend } from "sync-core/git"; void createGitBackend;\n'
  );
  fs.writeFileSync(path.join(rootPath, "default.ts"), 'import git from "sync-core/git"; void git;\n');
  const tscPath = path.join(packageRoot, "..", "node_modules", ".bin", "tsc");

  try {
    const compilerArguments = [
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--esModuleInterop",
      "false",
      "--allowSyntheticDefaultImports",
      "false",
      "--ignoreDeprecations",
      "6.0",
      "--module",
      "ESNext",
      "--moduleResolution",
      "Bundler"
    ];
    const named = spawnSync(tscPath, [...compilerArguments, "named.ts"], {
      cwd: rootPath,
      encoding: "utf8"
    });
    assert.equal(named.status, 0, named.stderr || named.stdout);
    const defaultImport = spawnSync(tscPath, [...compilerArguments, "default.ts"], {
      cwd: rootPath,
      encoding: "utf8"
    });
    assert.notEqual(defaultImport.status, 0);
    assert.match(`${defaultImport.stdout}\n${defaultImport.stderr}`, /has no default export/i);
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});
