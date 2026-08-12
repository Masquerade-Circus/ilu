import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import test from "node:test";
import { createSyncRuntime } from "../src/index.ts";
import type { SyncBackend, SyncRequest } from "../src/index.ts";

function withRoot<T>(name: string, run: (rootPath: string) => T | Promise<T>) {
  const tmpRoot = path.join(process.cwd(), "tmp");
  fs.mkdirSync(tmpRoot, { recursive: true });
  const rootPath = fs.mkdtempSync(path.join(tmpRoot, name));
  return Promise.resolve(run(rootPath)).finally(() => fs.rmSync(rootPath, { recursive: true, force: true }));
}

function backend(synchronize: (request: SyncRequest) => Promise<void>): SyncBackend {
  return {
    synchronize,
    classifyError(error) {
      const failure = error as Error & { retryable?: boolean; retryAfterMs?: number };
      return {
        kind: "network",
        retryable: failure.retryable !== false,
        retryAfterMs: failure.retryAfterMs,
        safeMessage: "Remote unavailable"
      };
    }
  };
}

test("createSyncRuntime rejects invalid runtime options before invoking the backend", async () => {
  await withRoot("runtime-invalid-", async (rootPath) => {
    const validBackend = backend(async () => {});
    const invalid = [
      { options: { backend: validBackend, rootPath: "" }, pattern: /rootPath/i },
      { options: { backend: {}, rootPath }, pattern: /synchronize.*classifyError/i },
      { options: { backend: validBackend, rootPath, maxRetries: -1 }, pattern: /maxRetries/i },
      { options: { backend: validBackend, rootPath, maxRetries: 1.5 }, pattern: /maxRetries/i },
      { options: { backend: validBackend, rootPath, retryDelayMs: Number.NaN }, pattern: /retryDelayMs/i },
      { options: { backend: validBackend, rootPath, retryBackoffFactor: 0.5 }, pattern: /retryBackoffFactor/i },
      {
        options: { backend: validBackend, rootPath, retryDelayMs: 10, maxRetryDelayMs: 9 },
        pattern: /maxRetryDelayMs/i
      }
    ];

    for (const entry of invalid) {
      await assert.rejects(createSyncRuntime(entry.options as never), entry.pattern);
    }
  });
});

test("createSyncRuntime rejects rootPath values that are not safe directories", async () => {
  await withRoot("runtime-root-invalid-", async (sandbox) => {
    const validBackend = backend(async () => {});
    const filePath = path.join(sandbox, "file");
    const targetPath = path.join(sandbox, "target");
    const symlinkPath = path.join(sandbox, "link");
    fs.writeFileSync(filePath, "not a directory");
    fs.mkdirSync(targetPath);
    fs.symlinkSync(targetPath, symlinkPath, "dir");

    await assert.rejects(createSyncRuntime({ backend: validBackend, rootPath: filePath }), /not a directory/i);
    await assert.rejects(createSyncRuntime({ backend: validBackend, rootPath: symlinkPath }), /symbolic link/i);
  });
});

test("createSyncRuntime reports recursive rootPath creation failures with their cause", async () => {
  await withRoot("runtime-root-io-", async (sandbox) => {
    const parentFile = path.join(sandbox, "parent-file");
    const rootPath = path.join(parentFile, "nested", "root");
    fs.writeFileSync(parentFile, "blocks mkdir");

    await assert.rejects(createSyncRuntime({ backend: backend(async () => {}), rootPath }), (error: unknown) => {
      assert.match((error as Error).message, /cannot create rootPath/i);
      assert.equal(((error as Error).cause as NodeJS.ErrnoException | undefined)?.code, "ENOTDIR");
      return true;
    });
  });
});

test("runtime sends the exact neutral request and deduplicates its private exclusion", async () => {
  await withRoot("runtime-request-", async (rootPath) => {
    const requests: SyncRequest[] = [];
    const runtime = await createSyncRuntime({
      backend: backend(async (request) => {
        requests.push(request);
      }),
      rootPath,
      excludePatterns: [".config/**", ".sync-core/**", ".sync-core/**"]
    });

    await runtime.sync({ domain: "todos", action: "save" });

    assert.deepEqual(requests, [
      {
        operationId: requests[0]?.operationId,
        rootPath,
        excludePatterns: [".config/**", ".sync-core/**"],
        context: { domain: "todos", action: "save" }
      }
    ]);
  });
});

test("retryable failures retry automatically with one stable operationId", async () => {
  await withRoot("runtime-retry-", async (rootPath) => {
    const operationIds: string[] = [];
    let attempts = 0;
    const runtime = await createSyncRuntime({
      backend: backend(async (request) => {
        attempts += 1;
        operationIds.push(request.operationId);
        if (attempts < 3) {
          throw new Error("temporary");
        }
      }),
      rootPath,
      maxRetries: 3,
      retryDelayMs: 1,
      retryBackoffFactor: 2,
      maxRetryDelayMs: 10
    });

    const state = await runtime.sync();

    assert.equal(attempts, 3);
    assert.equal(new Set(operationIds).size, 1);
    assert.equal(state.status, "healthy");
    assert.equal(state.retryCount, 0);
  });
});

test("non-retryable failures persist terminal pending state without another attempt", async () => {
  await withRoot("runtime-terminal-", async (rootPath) => {
    let attempts = 0;
    const fatal = Object.assign(new Error("fatal"), { retryable: false });
    const runtime = await createSyncRuntime({
      backend: backend(async () => {
        attempts += 1;
        throw fatal;
      }),
      rootPath,
      retryDelayMs: 1,
      maxRetryDelayMs: 1
    });

    const state = await runtime.sync();
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(attempts, 1);
    assert.equal(state.status, "degraded_network");
    assert.equal(state.hasPendingRemote, true);
    assert.equal(state.retryCount, 0);
  });
});

test("same-turn calls share one operation while in-flight calls share one trailing operation", async () => {
  await withRoot("runtime-coalesce-", async (rootPath) => {
    const requests: SyncRequest[] = [];
    let releaseFirst: (() => void) | null = null;
    let firstStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const runtime = await createSyncRuntime({
      backend: backend(async (request) => {
        requests.push(request);
        if (requests.length === 1) {
          firstStarted?.();
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
      }),
      rootPath
    });

    const first = runtime.sync({ action: "first" });
    const grouped = runtime.sync({ action: "grouped" });
    assert.equal(first, grouped);
    await started;
    const trailing = runtime.sync({ action: "trailing-1" });
    const coalescedTrailing = runtime.sync({ action: "trailing-2" });
    assert.equal(trailing, coalescedTrailing);
    assert.notEqual(first, trailing);
    releaseFirst?.();
    await first;
    assert.equal(requests.length, 1, "the initial caller must not await later work");
    await trailing;

    assert.equal(requests.length, 2);
    assert.notEqual(requests[0]?.operationId, requests[1]?.operationId);
    assert.deepEqual(requests[0]?.context, { action: "grouped" });
    assert.deepEqual(requests[1]?.context, { action: "trailing-2" });
  });
});

test("root API and runtime omit every removed public member", async () => {
  await withRoot("runtime-surface-", async (rootPath) => {
    const api = await import("../src/index.ts");
    const runtime = await createSyncRuntime({ backend: backend(async () => {}), rootPath });

    assert.deepEqual(Object.keys(api).sort(), ["createSyncRuntime"]);
    assert.deepEqual(Object.keys(runtime).sort(), ["getSyncStatus", "sync"]);
    for (const removed of ["notifyLocalMutation", "retry", "enable", "disable"] as const) {
      assert.equal(removed in runtime, false);
    }
  });
});

test("retryAfterMs remains the minimum delay beyond maxRetryDelayMs", async () => {
  await withRoot("runtime-retry-after-", async (rootPath) => {
    const startedAt = Date.now();
    let attempts = 0;
    const retryable = Object.assign(new Error("later"), { retryAfterMs: 25 });
    const runtime = await createSyncRuntime({
      backend: backend(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw retryable;
        }
      }),
      rootPath,
      retryDelayMs: 1,
      maxRetryDelayMs: 2
    });

    await runtime.sync();

    assert.equal(attempts, 2);
    assert.ok(Date.now() - startedAt >= 20);
  });
});

test("runtime rehydrates retryable pending work with its operationId and backoff", async () => {
  await withRoot("runtime-rehydrate-", async (rootPath) => {
    const directory = path.join(rootPath, ".sync-core");
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(
      path.join(directory, "state.json"),
      JSON.stringify({
        status: "degraded_network",
        hasPendingRemote: true,
        pendingOperationId: "persisted-operation",
        retryCount: 0,
        backoffUntil: Date.now() + 15,
        lastErrorKind: "network",
        lastErrorMessage: "Remote unavailable",
        lastSyncReason: "save",
        lastPhase: null,
        lastSnapshotId: null,
        lastSyncedSnapshotId: null,
        retryable: true,
        pendingContext: { action: "save" }
      }),
      { mode: 0o600 }
    );
    const requests: SyncRequest[] = [];
    const runtime = await createSyncRuntime({
      backend: backend(async (request) => {
        requests.push(request);
      }),
      rootPath,
      retryDelayMs: 1,
      maxRetryDelayMs: 2
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.operationId, "persisted-operation");
    assert.equal(runtime.getSyncStatus().status, "healthy");
  });
});

test("terminal active failure persists the distinct trailing operation and resolves its callers", async () => {
  await withRoot("runtime-terminal-trailing-", async (rootPath) => {
    let release: (() => void) | null = null;
    let started: (() => void) | null = null;
    const activeStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const requests: SyncRequest[] = [];
    const fatal = Object.assign(new Error("fatal"), { retryable: false });
    const runtime = await createSyncRuntime({
      backend: backend(async (request) => {
        requests.push(request);
        started?.();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        throw fatal;
      }),
      rootPath
    });

    const first = runtime.sync({ action: "active" });
    await activeStarted;
    const trailing = runtime.sync({ action: "trailing" });
    release?.();
    const [activeState, trailingState] = await Promise.all([first, trailing]);

    assert.equal(requests.length, 1);
    assert.equal(activeState.status, "degraded_network");
    assert.equal(trailingState.status, "degraded_network");
    assert.notEqual(trailingState.pendingOperationId, requests[0]?.operationId);
    assert.equal(runtime.getSyncStatus().lastSyncReason, "trailing");
  });
});

test("retry exhaustion stops after maxRetries retries and leaves terminal pending state", async () => {
  await withRoot("runtime-exhaustion-", async (rootPath) => {
    let attempts = 0;
    const runtime = await createSyncRuntime({
      backend: backend(async () => {
        attempts += 1;
        throw new Error("still unavailable");
      }),
      rootPath,
      maxRetries: 2,
      retryDelayMs: 1,
      maxRetryDelayMs: 2
    });

    const state = await runtime.sync();

    assert.equal(attempts, 3);
    assert.equal(state.retryCount, 2);
    assert.equal(state.hasPendingRemote, true);
    assert.equal(state.backoffUntil, null);
  });
});

test("a sync admitted during backoff becomes trailing and cannot skip the active delay", async () => {
  await withRoot("runtime-backoff-trailing-", async (rootPath) => {
    const requests: Array<{ action: unknown; at: number }> = [];
    let attempts = 0;
    let firstFailure: (() => void) | null = null;
    const failed = new Promise<void>((resolve) => {
      firstFailure = resolve;
    });
    const runtime = await createSyncRuntime({
      backend: backend(async (request) => {
        attempts += 1;
        requests.push({ action: request.context.action, at: Date.now() });
        if (attempts === 1) {
          firstFailure?.();
          throw new Error("temporary");
        }
      }),
      rootPath,
      retryDelayMs: 20,
      maxRetryDelayMs: 20
    });

    const active = runtime.sync({ action: "active" });
    await failed;
    const trailing = runtime.sync({ action: "trailing" });
    await active;
    await trailing;

    assert.deepEqual(
      requests.map((entry) => entry.action),
      ["active", "active", "trailing"]
    );
    assert.ok((requests[1]?.at ?? 0) - (requests[0]?.at ?? 0) >= 15);
  });
});

test("a late caller refs the rehydrated timer that its trailing promise depends on", async () => {
  await withRoot("runtime-late-caller-", async (rootPath) => {
    const directory = path.join(rootPath, ".sync-core");
    const resultPath = path.join(rootPath, "result.json");
    const childPath = path.join(rootPath, "late-caller.mjs");
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(
      path.join(directory, "state.json"),
      JSON.stringify({
        status: "degraded_network",
        hasPendingRemote: true,
        pendingOperationId: "rehydrated-operation",
        retryCount: 0,
        backoffUntil: Date.now() + 1_000,
        lastErrorKind: "network",
        lastErrorMessage: "Remote unavailable",
        lastSyncReason: "save",
        lastPhase: null,
        lastSnapshotId: null,
        lastSyncedSnapshotId: null,
        retryable: true,
        pendingContext: { action: "save" }
      }),
      { mode: 0o600 }
    );
    fs.writeFileSync(
      childPath,
      `
      import fs from "node:fs";
      import { createSyncRuntime } from ${JSON.stringify(path.join(process.cwd(), "src", "index.ts"))};
      let attempts = 0;
      const runtime = await createSyncRuntime({
        rootPath: ${JSON.stringify(rootPath)},
        backend: {
          async synchronize() {
            attempts += 1;
            if (attempts === 1) {
              throw new Error("controlled transport failure");
            }
          },
          classifyError() { return { kind: "network", retryable: true }; }
        },
        retryDelayMs: 250,
        maxRetryDelayMs: 250
      });
      process.on("message", async () => {
        const pending = runtime.sync({ action: "late" });
        process.disconnect();
        const state = await pending;
        fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(state));
      });
      process.send("ready");
    `
    );

    const child = fork(childPath, [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("message", () => child.send("sync"));
      child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`child exited ${code}`))));
    });

    assert.equal(JSON.parse(fs.readFileSync(resultPath, "utf8")).status, "healthy");
  });
});
