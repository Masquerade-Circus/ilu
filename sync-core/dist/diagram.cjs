"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/diagram.ts
var diagram_exports = {};
__export(diagram_exports, {
  default: () => diagram_default,
  generateSyncDiagrams: () => generateSyncDiagrams
});
module.exports = __toCommonJS(diagram_exports);
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var __cjsImport41 = __toESM(require("x-robot/documentate"), 1);

// src/machine.ts
var machine_exports = {};
__export(machine_exports, {
  createSyncMachine: () => createSyncMachine,
  default: () => machine_default
});
var xRobot = __toESM(require("x-robot"), 1);
var validation = __toESM(require("x-robot/validate"), 1);
var { machine, init, initial, context, state, transition, entry, exit, immediate, guard } = xRobot;
var { validate } = validation;
function hasPendingRemote(ctx) {
  return ctx.hasPendingRemote === true;
}
function hasOutcome(outcome) {
  return (ctx) => ctx.syncOutcome === outcome;
}
async function runSync(ctx, payload = {}) {
  const result = typeof payload.runSyncPipeline === "function" ? await payload.runSyncPipeline() : null;
  if (result === null || result.kind === null || typeof result.kind !== "string" || result.kind === "ok") {
    return {
      ...ctx,
      syncOutcome: "ok",
      hasPendingRemote: false,
      pendingOperationId: null,
      retryCount: 0,
      backoffUntil: null,
      lastErrorKind: null,
      lastErrorMessage: null
    };
  }
  return {
    ...ctx,
    syncOutcome: result.kind,
    lastErrorKind: result.kind,
    lastErrorMessage: result.safeMessage || "Synchronization failed",
    retryCount: (ctx.retryCount ?? 0) + 1,
    backoffUntil: result.retryable === true && typeof result.retryAfterMs === "number" && result.retryAfterMs > 0 ? Date.now() + result.retryAfterMs : null,
    hasPendingRemote: true
  };
}
function createSyncMachine(config = {}) {
  const syncMachine = machine(
    "Sync",
    init(
      initial(config.status || "healthy"),
      context({
        status: config.status || "healthy",
        hasPendingRemote: config.hasPendingRemote === true || config.status === "pending_remote",
        pendingOperationId: config.pendingOperationId ?? null,
        lastErrorKind: config.lastErrorKind ?? null,
        lastErrorMessage: config.lastErrorMessage ?? null,
        retryCount: config.retryCount ?? 0,
        backoffUntil: config.backoffUntil ?? null,
        lastSyncReason: config.lastSyncReason ?? null,
        lastPhase: config.lastPhase ?? null,
        lastSnapshotId: config.lastSnapshotId ?? null,
        lastSyncedSnapshotId: config.lastSyncedSnapshotId ?? null,
        syncOutcome: null
      })
    ),
    state(
      "healthy",
      transition(
        "LOCAL_PERSISTED",
        "pending_remote",
        exit((ctx, payload = {}) => {
          ctx.hasPendingRemote = true;
          ctx.lastSyncReason = payload.action ?? null;
        })
      )
    ),
    state("pending_remote", transition("SYNC_REQUESTED", "syncing", guard(hasPendingRemote))),
    state("syncing", entry(runSync, "route_after_sync", "route_after_sync")),
    state(
      "route_after_sync",
      immediate(
        "healthy",
        guard((ctx) => ctx.syncOutcome === null || ctx.syncOutcome === "ok")
      ),
      immediate("degraded_network", guard(hasOutcome("network"))),
      immediate("degraded_auth", guard(hasOutcome("auth"))),
      immediate("conflict", guard(hasOutcome("conflict"))),
      immediate("failed")
    ),
    state("degraded_network", transition("SYNC_REQUESTED", "syncing", guard(hasPendingRemote))),
    state("degraded_auth", transition("SYNC_REQUESTED", "syncing", guard(hasPendingRemote))),
    state(
      "conflict",
      transition(
        "CONFLICT_RESOLVED",
        "pending_remote",
        exit((ctx) => {
          ctx.syncOutcome = null;
        })
      )
    ),
    state(
      "failed",
      transition(
        "LOCAL_PERSISTED",
        "pending_remote",
        exit((ctx, payload = {}) => {
          ctx.hasPendingRemote = true;
          ctx.lastSyncReason = payload.action ?? null;
        })
      ),
      transition("SYNC_REQUESTED", "syncing", guard(hasPendingRemote))
    )
  );
  validate(syncMachine);
  return syncMachine;
}
var machine_default = { createSyncMachine };

// src/diagram.ts
var { documentate } = __cjsImport41;
var { createSyncMachine: createSyncMachine2 } = machine_exports;
async function generateSyncDiagrams(options = {}) {
  const outDir = options.outDir || import_node_path.default.join(process.cwd(), "docs", "diagrams");
  const svgPath = import_node_path.default.join(outDir, "sync-machine.svg");
  const mermaidPath = import_node_path.default.join(outDir, "sync-machine.mmd");
  const machine2 = createSyncMachine2({ status: "healthy", hasPendingRemote: false });
  import_node_fs.default.mkdirSync(outDir, { recursive: true });
  const svgResult = await documentate(machine2, {
    format: "svg",
    output: svgPath,
    fileName: "sync-machine",
    level: "high"
  });
  const mermaidResult = await documentate(machine2, {
    format: "mermaid",
    level: "high"
  });
  if (mermaidResult.mermaid) {
    import_node_fs.default.writeFileSync(mermaidPath, mermaidResult.mermaid, "utf8");
  }
  if (svgResult.svg && svgResult.svg !== svgPath && import_node_fs.default.existsSync(svgResult.svg)) {
    import_node_fs.default.copyFileSync(svgResult.svg, svgPath);
  }
  return {
    svgPath,
    mermaidPath
  };
}
var diagram_default = {
  generateSyncDiagrams
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  generateSyncDiagrams
});
