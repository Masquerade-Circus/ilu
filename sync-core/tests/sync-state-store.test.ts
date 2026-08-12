import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createSyncRuntime } from "../src/index.ts";
import type { SyncBackend } from "../src/index.ts";

const backend: SyncBackend = {
  async synchronize() {},
  classifyError() {
    return { kind: "unknown", retryable: false };
  }
};

function withSandbox<T>(name: string, run: (sandbox: string) => T | Promise<T>) {
  const tmpRoot = path.join(process.cwd(), "tmp");
  fs.mkdirSync(tmpRoot, { recursive: true });
  const sandbox = fs.mkdtempSync(path.join(tmpRoot, name));
  return Promise.resolve(run(sandbox)).finally(() => fs.rmSync(sandbox, { recursive: true, force: true }));
}

test("runtime creates a missing rootPath recursively before initializing private state", async () => {
  await withSandbox("private-missing-root-", async (sandbox) => {
    const rootPath = path.join(sandbox, "parent", "nested", "root");
    const runtime = await createSyncRuntime({ backend, rootPath });

    assert.equal(fs.statSync(rootPath).isDirectory(), true);
    assert.equal(fs.statSync(rootPath).mode & 0o777, 0o700);
    assert.equal(runtime.getSyncStatus().status, "healthy");
    assert.equal(fs.statSync(path.join(rootPath, ".sync-core")).isDirectory(), true);
  });
});

test("runtime preserves permissions on an existing rootPath", async () => {
  await withSandbox("private-existing-root-mode-", async (sandbox) => {
    const rootPath = path.join(sandbox, "root");
    fs.mkdirSync(rootPath, { mode: 0o750 });
    fs.chmodSync(rootPath, 0o750);

    await createSyncRuntime({ backend, rootPath });

    assert.equal(fs.statSync(rootPath).mode & 0o777, 0o750);
  });
});

test("private state uses the fixed path, restrictive permissions and complete JSON", async () => {
  await withSandbox("private-state-", async (rootPath) => {
    const runtime = await createSyncRuntime({ backend, rootPath });
    await runtime.sync({ action: "save" });
    const directory = path.join(rootPath, ".sync-core");
    const statePath = path.join(directory, "state.json");

    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).status, "healthy");
    assert.deepEqual(fs.readdirSync(directory), ["state.json"]);
  });
});

test("runtime rejects a symlinked private state directory", async () => {
  await withSandbox("private-symlink-", async (sandbox) => {
    const rootPath = path.join(sandbox, "root");
    const targetPath = path.join(sandbox, "target");
    fs.mkdirSync(rootPath);
    fs.mkdirSync(targetPath);
    fs.symlinkSync(targetPath, path.join(rootPath, ".sync-core"));

    await assert.rejects(createSyncRuntime({ backend, rootPath }), /symbolic link/i);
  });
});

test("runtime rejects a symlinked state file", async () => {
  await withSandbox("private-state-symlink-", async (sandbox) => {
    const rootPath = path.join(sandbox, "root");
    const directory = path.join(rootPath, ".sync-core");
    const targetPath = path.join(sandbox, "target.json");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(targetPath, "{}", { mode: 0o600 });
    fs.symlinkSync(targetPath, path.join(directory, "state.json"));

    await assert.rejects(createSyncRuntime({ backend, rootPath }), /symbolic link/i);
  });
});

test("state persistence flushes the file and containing directory", async () => {
  await withSandbox("private-state-fsync-", async (rootPath) => {
    const originalFsyncSync = fs.fsyncSync;
    let flushCount = 0;
    fs.fsyncSync = (fileDescriptor) => {
      flushCount += 1;
      originalFsyncSync(fileDescriptor);
    };
    try {
      const runtime = await createSyncRuntime({ backend, rootPath });
      await runtime.sync({ action: "save" });
    } finally {
      fs.fsyncSync = originalFsyncSync;
    }

    assert.ok(flushCount >= 4, `expected file and directory flushes for both writes, received ${flushCount}`);
  });
});

for (const code of ["EINVAL", "ENOTSUP", "ENOSYS"] as const) {
  test(`state persistence tolerates unsupported directory fsync (${code})`, { concurrency: false }, async () => {
    await withSandbox(`private-state-fsync-${code}-`, async (rootPath) => {
      const originalFsyncSync = fs.fsyncSync;
      fs.fsyncSync = (fileDescriptor) => {
        if (fs.fstatSync(fileDescriptor).isDirectory()) {
          throw Object.assign(new Error("directory fsync unsupported"), { code });
        }
        originalFsyncSync(fileDescriptor);
      };
      try {
        const runtime = await createSyncRuntime({ backend, rootPath });
        assert.equal((await runtime.sync()).status, "healthy");
      } finally {
        fs.fsyncSync = originalFsyncSync;
      }
    });
  });
}

test("state persistence propagates real directory fsync errors", { concurrency: false }, async () => {
  await withSandbox("private-state-fsync-io-", async (rootPath) => {
    const originalFsyncSync = fs.fsyncSync;
    fs.fsyncSync = (fileDescriptor) => {
      if (fs.fstatSync(fileDescriptor).isDirectory()) {
        throw Object.assign(new Error("controlled IO failure"), { code: "EIO" });
      }
      originalFsyncSync(fileDescriptor);
    };
    try {
      await assert.rejects(createSyncRuntime({ backend, rootPath }), /controlled IO failure/);
    } finally {
      fs.fsyncSync = originalFsyncSync;
    }
  });
});

test("runtime rejects malformed private JSON", async () => {
  await withSandbox("private-json-", async (rootPath) => {
    const directory = path.join(rootPath, ".sync-core");
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(path.join(directory, "state.json"), "{", { mode: 0o600 });

    await assert.rejects(createSyncRuntime({ backend, rootPath }), /invalid persisted sync state/i);
  });
});

test("runtime fails clearly when its private state directory is read-only", async () => {
  await withSandbox("private-readonly-", async (rootPath) => {
    const directory = path.join(rootPath, ".sync-core");
    fs.mkdirSync(directory, { mode: 0o500 });
    fs.chmodSync(directory, 0o500);
    try {
      await assert.rejects(createSyncRuntime({ backend, rootPath }), /not writable|read-only/i);
    } finally {
      fs.chmodSync(directory, 0o700);
    }
  });
});
