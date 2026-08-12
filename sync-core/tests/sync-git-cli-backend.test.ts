import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { classifyError, createGitBackend } from "../src/git.ts";
import { createSyncRuntime } from "../src/index.ts";
import type { SyncBackend, SyncRequest } from "../src/index.ts";

function withSandbox<T>(prefix: string, callback: (sandbox: string) => Promise<T> | T) {
  const tempRoot = path.join(process.cwd(), "tmp");
  fs.mkdirSync(tempRoot, { recursive: true });
  const sandbox = fs.mkdtempSync(path.join(tempRoot, prefix));

  return Promise.resolve(callback(sandbox)).finally(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
    try {
      fs.rmdirSync(tempRoot);
    } catch (_error: unknown) {
      void _error;
    }
  });
}

function request(rootPath: string, overrides: Partial<SyncRequest> = {}): SyncRequest {
  return {
    operationId: "operation_1",
    rootPath,
    excludePatterns: [".config/**"],
    context: { domain: "todos", action: "save" },
    ...overrides
  };
}

function seedRemote({
  remotePath,
  workPath,
  files
}: {
  remotePath: string;
  workPath: string;
  files: Record<string, string>;
}) {
  execFileSync("git", ["init", "--bare", "--initial-branch=main", remotePath], { stdio: "pipe" });
  execFileSync("git", ["clone", remotePath, workPath], { stdio: "pipe" });
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(workPath, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
  execFileSync("git", ["-C", workPath, "add", "."], { stdio: "pipe" });
  execFileSync(
    "git",
    ["-C", workPath, "-c", "user.name=sync test", "-c", "user.email=sync@example.test", "commit", "-m", "seed"],
    { stdio: "pipe" }
  );
  execFileSync("git", ["-C", workPath, "push", "origin", "main"], { stdio: "pipe" });
}

function gitHead(repoPath: string) {
  return String(execFileSync("git", ["-C", repoPath, "rev-parse", "HEAD"])).trim();
}

function remoteHead(remotePath: string) {
  return String(execFileSync("git", ["--git-dir", remotePath, "rev-parse", "main"])).trim();
}

test("Git backend explicitly satisfies the neutral SyncBackend contract", () => {
  const backend: SyncBackend = createGitBackend({ repoPath: "./tmp/git-contract" });

  assert.deepEqual(Object.keys(backend).sort(), ["adoptRemote", "classifyError", "inspectBootstrap", "synchronize"]);
});

test("Git backend preserves explicit Git identity and uses sync-core defaults", { concurrency: false }, async () => {
  await withSandbox("git-identity-", async (sandbox) => {
    const repoPath = path.join(sandbox, "repo");
    const identityKeys = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"] as const;
    const originalIdentity = Object.fromEntries(identityKeys.map((key) => [key, process.env[key]]));
    const backend = createGitBackend({ repoPath, receiveRemote: false, publishLocal: false });

    try {
      Object.assign(process.env, {
        GIT_AUTHOR_NAME: "Explicit Author",
        GIT_AUTHOR_EMAIL: "author@example.test",
        GIT_COMMITTER_NAME: "Explicit Committer",
        GIT_COMMITTER_EMAIL: "committer@example.test"
      });
      fs.mkdirSync(repoPath, { recursive: true });
      fs.writeFileSync(path.join(repoPath, "data.txt"), "explicit\n", "utf8");

      await backend.synchronize(request(repoPath, { excludePatterns: [] }));

      assert.equal(
        String(execFileSync("git", ["-C", repoPath, "log", "-1", "--format=%an|%ae|%cn|%ce"])).trim(),
        "Explicit Author|author@example.test|Explicit Committer|committer@example.test"
      );

      identityKeys.forEach((key) => delete process.env[key]);
      fs.writeFileSync(path.join(repoPath, "data.txt"), "default\n", "utf8");

      await backend.synchronize(request(repoPath, { excludePatterns: [] }));

      assert.equal(
        String(execFileSync("git", ["-C", repoPath, "log", "-1", "--format=%an|%ae|%cn|%ce"])).trim(),
        "sync-core|sync@sync-core.local|sync-core|sync@sync-core.local"
      );
    } finally {
      identityKeys.forEach((key) => {
        const value = originalIdentity[key];
        if (typeof value === "string") {
          process.env[key] = value;
        } else {
          delete process.env[key];
        }
      });
    }
  });
});

test("Git error classification is neutral, actionable and safe", () => {
  const cases = [
    { error: new Error("Could not resolve host example.test"), kind: "network", retryable: true },
    { error: new Error("Authentication failed"), kind: "auth", retryable: false },
    { error: new Error("Permission denied; could not read from remote repository"), kind: "auth", retryable: false },
    { error: new Error("CONFLICT in notes.json"), kind: "conflict", retryable: false },
    { error: new Error("remote rejected main; failed to push some refs"), kind: "conflict", retryable: false },
    { error: new Error("Connection reset by peer; failed to push some refs"), kind: "network", retryable: true },
    { error: new Error("Authentication failed after network negotiation"), kind: "auth", retryable: false },
    {
      error: new Error("Authentication failed; remote rejected main; failed to push some refs"),
      kind: "auth",
      retryable: false
    },
    { error: new Error("fatal: not a git repository"), kind: "config", retryable: false },
    { error: new Error("provider exploded"), kind: "unknown", retryable: false }
  ] as const;

  for (const entry of cases) {
    const failure = classifyError(entry.error, request("./tmp/data"));
    assert.equal(failure.kind, entry.kind);
    assert.equal(failure.retryable, entry.retryable);
    assert.equal(typeof failure.safeMessage, "string");
    assert.doesNotMatch(failure.safeMessage ?? "", /example\.test|notes\.json|provider exploded/i);
  }
});

test("a server-side push rejection is terminal instead of a network retry", async () => {
  await withSandbox("git-rejected-push-", async (sandbox) => {
    const rootPath = path.join(sandbox, "data");
    const remotePath = path.join(sandbox, "remote.git");
    fs.mkdirSync(rootPath);
    fs.writeFileSync(path.join(rootPath, "data.json"), "{}\n");
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remotePath], { stdio: "pipe" });
    const hookPath = path.join(remotePath, "hooks", "pre-receive");
    fs.writeFileSync(hookPath, "#!/bin/sh\necho 'policy rejected' >&2\nexit 1\n", { mode: 0o700 });
    const backend = createGitBackend({ repoPath: rootPath, remoteUrl: remotePath, receiveRemote: false });

    let rejected: unknown;
    try {
      await backend.synchronize(request(rootPath, { excludePatterns: [] }));
    } catch (error) {
      rejected = error;
    }
    const failure = backend.classifyError(rejected, request(rootPath));
    assert.equal(failure.kind, "conflict");
    assert.equal(failure.retryable, false);
  });
});

test("Git backend owns snapshot, commit, fetch, integration and push", async () => {
  await withSandbox("git-backend-", async (sandbox) => {
    const home = path.join(sandbox, "home");
    const rootPath = path.join(sandbox, "data");
    const remotePath = path.join(sandbox, "remote.git");
    const env = { ...process.env, HOME: home };
    fs.mkdirSync(path.join(rootPath, ".config"), { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(rootPath, "todos.json"), "[]\n", "utf8");
    fs.writeFileSync(path.join(rootPath, ".config", "state.json"), "{}\n", "utf8");
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remotePath], { env, stdio: "pipe" });

    const backend: SyncBackend = createGitBackend({
      repoPath: rootPath,
      remoteUrl: remotePath,
      branch: "main"
    });
    await backend.synchronize(request(rootPath));

    assert.equal(fs.existsSync(path.join(rootPath, ".git")), true);
    assert.equal(fs.existsSync(path.join(rootPath, ".config", "state.json")), true);
    assert.match(fs.readFileSync(path.join(rootPath, ".gitignore"), "utf8"), /^\.config\/\*\*$/m);
    assert.equal(
      String(execFileSync("git", ["--git-dir", remotePath, "log", "-1", "--format=%s"], { env })).trim(),
      "sync(todos): save local data snapshot"
    );
  });
});

test("runtime creates a shared Git rootPath before the first publish", async () => {
  await withSandbox("git-missing-shared-root-", async (sandbox) => {
    const rootPath = path.join(sandbox, "missing", "data");
    const remotePath = path.join(sandbox, "remote.git");
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remotePath], { stdio: "pipe" });
    const runtime = await createSyncRuntime({
      backend: createGitBackend({ repoPath: rootPath, remoteUrl: remotePath }),
      rootPath
    });
    fs.writeFileSync(path.join(rootPath, "data.json"), "{}\n");

    await runtime.sync({ domain: "data", action: "save" });

    assert.equal(fs.statSync(rootPath).isDirectory(), true);
    assert.equal(fs.statSync(path.join(rootPath, ".git")).isDirectory(), true);
    assert.match(String(execFileSync("git", ["ls-remote", "--heads", remotePath, "main"])), /refs\/heads\/main/);
  });
});

test("Git bootstrap inspection ignores excluded files and symlinks", async () => {
  await withSandbox("git-bootstrap-", (sandbox) => {
    const rootPath = path.join(sandbox, "data");
    const repoPath = path.join(sandbox, "repo");
    const remotePath = path.join(sandbox, "remote.git");
    const outsidePath = path.join(sandbox, "outside.txt");
    fs.mkdirSync(path.join(rootPath, ".config"), { recursive: true });
    fs.writeFileSync(path.join(rootPath, ".config", "state.json"), "{}\n", "utf8");
    fs.writeFileSync(outsidePath, "canary", "utf8");
    fs.symlinkSync(outsidePath, path.join(rootPath, "linked.txt"));
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remotePath], { stdio: "pipe" });
    const backend = createGitBackend({ repoPath, remoteUrl: remotePath });

    assert.equal(backend.inspectBootstrap({ rootPath, excludePatterns: [".config/**"] }).localHasData, false);
  });
});

test("runtime automatic retry publishes with the same operationId after a transport failure", async () => {
  await withSandbox("git-retry-push-", async (sandbox) => {
    const rootPath = path.join(sandbox, "data");
    const remotePath = path.join(sandbox, "remote.git");
    fs.mkdirSync(rootPath, { recursive: true });
    fs.writeFileSync(path.join(rootPath, "todos.json"), "[]\n", "utf8");
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remotePath], { stdio: "pipe" });
    const gitBackend = createGitBackend({ repoPath: rootPath, remoteUrl: remotePath, branch: "main" });
    const operationIds: string[] = [];
    let firstFailure = true;
    const runtime = await createSyncRuntime({
      backend: {
        async synchronize(syncRequest) {
          operationIds.push(syncRequest.operationId);
          if (firstFailure) {
            firstFailure = false;
            throw new Error("Could not resolve host controlled.test");
          }
          await gitBackend.synchronize(syncRequest);
        },
        classifyError: gitBackend.classifyError
      },
      rootPath,
      retryDelayMs: 1,
      maxRetryDelayMs: 1
    });

    await runtime.sync({ domain: "todos", action: "save" });

    assert.deepEqual(operationIds, [operationIds[0], operationIds[0]]);
    assert.equal(runtime.getSyncStatus().status, "healthy");
    assert.equal(
      String(execFileSync("git", ["--git-dir", remotePath, "log", "-1", "--format=%s"])).trim(),
      "sync(todos): save local data snapshot"
    );
  });
});

test("Git backend copies integrated remote data back when repoPath differs from rootPath", async () => {
  await withSandbox("git-separated-paths-", async (sandbox) => {
    const rootPath = path.join(sandbox, "data");
    const repoPath = path.join(sandbox, "working-repo");
    const remotePath = path.join(sandbox, "remote.git");
    const seedPath = path.join(sandbox, "seed");
    fs.mkdirSync(path.join(rootPath, ".config"), { recursive: true });
    fs.writeFileSync(path.join(rootPath, ".config", "local.json"), "local\n", "utf8");
    seedRemote({
      remotePath,
      workPath: seedPath,
      files: {
        "notes.json": "remote\n",
        ".config/remote.json": "excluded\n"
      }
    });
    const backend = createGitBackend({ repoPath, remoteUrl: remotePath, branch: "main", publishLocal: false });

    await backend.synchronize(
      request(rootPath, {
        excludePatterns: [".config/**"]
      })
    );

    assert.equal(fs.readFileSync(path.join(rootPath, "notes.json"), "utf8"), "remote\n");
    assert.equal(fs.readFileSync(path.join(rootPath, ".config", "local.json"), "utf8"), "local\n");
    assert.equal(fs.existsSync(path.join(rootPath, ".config", "remote.json")), false);
    assert.equal(fs.existsSync(path.join(rootPath, ".git")), false);
  });
});

test("runtime creates a missing rootPath before remote adoption into a separate repoPath", async () => {
  await withSandbox("git-missing-separated-root-", async (sandbox) => {
    const rootPath = path.join(sandbox, "missing", "data");
    const repoPath = path.join(sandbox, "working-repo");
    const remotePath = path.join(sandbox, "remote.git");
    const seedPath = path.join(sandbox, "seed");
    seedRemote({ remotePath, workPath: seedPath, files: { "notes.json": "remote\n" } });
    const backend = createGitBackend({ repoPath, remoteUrl: remotePath });

    const bootstrap = backend.inspectBootstrap({ rootPath, excludePatterns: [".sync-core/**"] });
    assert.deepEqual(bootstrap, { localHasData: false, remoteHasHistory: true });
    backend.adoptRemote();
    const runtime = await createSyncRuntime({ backend, rootPath });
    await runtime.sync({ domain: "notes", action: "adopt" });

    assert.equal(fs.readFileSync(path.join(rootPath, "notes.json"), "utf8"), "remote\n");
    assert.equal(fs.existsSync(path.join(rootPath, ".git")), false);
  });
});

test("separate initialized repo hydrates a missing root without manual remote adoption", async () => {
  await withSandbox("git-existing-repo-missing-root-", async (sandbox) => {
    const rootPath = path.join(sandbox, "missing", "data");
    const repoPath = path.join(sandbox, "repo");
    const remotePath = path.join(sandbox, "remote.git");
    const excludedPath = path.join(repoPath, ".sync-core");
    const outsidePath = path.join(sandbox, "outside.txt");
    seedRemote({ remotePath, workPath: repoPath, files: { "notes.json": "repo data\n" } });
    fs.mkdirSync(excludedPath);
    fs.writeFileSync(path.join(excludedPath, "state.json"), "private\n");
    fs.writeFileSync(outsidePath, "outside\n");
    fs.symlinkSync(outsidePath, path.join(repoPath, "linked.txt"));
    const localHeadBefore = gitHead(repoPath);
    const remoteHeadBefore = remoteHead(remotePath);
    const runtime = await createSyncRuntime({
      backend: createGitBackend({ repoPath, remoteUrl: remotePath }),
      rootPath
    });

    await runtime.sync({ domain: "notes", action: "bootstrap" });

    assert.equal(fs.readFileSync(path.join(rootPath, "notes.json"), "utf8"), "repo data\n");
    assert.equal(fs.existsSync(path.join(rootPath, "linked.txt")), false);
    assert.equal(fs.readFileSync(path.join(rootPath, ".sync-core", "state.json"), "utf8").includes("private"), false);
    assert.equal(gitHead(repoPath), localHeadBefore);
    assert.equal(remoteHead(remotePath), remoteHeadBefore);
  });
});

test("separate initialized repo hydrates a missing root when receiveRemote is false", async () => {
  await withSandbox("git-existing-repo-no-receive-", async (sandbox) => {
    const rootPath = path.join(sandbox, "missing", "data");
    const repoPath = path.join(sandbox, "repo");
    const remotePath = path.join(sandbox, "remote.git");
    seedRemote({ remotePath, workPath: repoPath, files: { "notes.json": "repo data\n" } });
    const localHeadBefore = gitHead(repoPath);
    const remoteHeadBefore = remoteHead(remotePath);
    const runtime = await createSyncRuntime({
      backend: createGitBackend({ repoPath, remoteUrl: remotePath, receiveRemote: false }),
      rootPath
    });

    await runtime.sync({ domain: "notes", action: "bootstrap" });

    assert.equal(fs.readFileSync(path.join(rootPath, "notes.json"), "utf8"), "repo data\n");
    assert.equal(gitHead(repoPath), localHeadBefore);
    assert.equal(remoteHead(remotePath), remoteHeadBefore);
  });
});

test("separate local repo hydrates a missing root without an accessible remote", async () => {
  await withSandbox("git-local-repo-missing-root-", async (sandbox) => {
    const rootPath = path.join(sandbox, "missing", "data");
    const repoPath = path.join(sandbox, "repo");
    fs.mkdirSync(repoPath);
    execFileSync("git", ["init", "-b", "main", repoPath], { stdio: "pipe" });
    fs.writeFileSync(path.join(repoPath, "notes.json"), "local history\n");
    execFileSync("git", ["-C", repoPath, "add", "notes.json"], { stdio: "pipe" });
    execFileSync(
      "git",
      ["-C", repoPath, "-c", "user.name=sync test", "-c", "user.email=sync@example.test", "commit", "-m", "local"],
      { stdio: "pipe" }
    );
    const localHeadBefore = gitHead(repoPath);
    const runtime = await createSyncRuntime({
      backend: createGitBackend({ repoPath, receiveRemote: false, publishLocal: false }),
      rootPath
    });

    await runtime.sync({ domain: "notes", action: "bootstrap" });

    assert.equal(fs.readFileSync(path.join(rootPath, "notes.json"), "utf8"), "local history\n");
    assert.equal(gitHead(repoPath), localHeadBefore);
  });
});

test("bootstrap inspection preserves divergent root and repo data for an explicit conflict decision", async () => {
  await withSandbox("git-divergent-bootstrap-", async (sandbox) => {
    const rootPath = path.join(sandbox, "data");
    const repoPath = path.join(sandbox, "repo");
    const remotePath = path.join(sandbox, "remote.git");
    fs.mkdirSync(rootPath);
    fs.writeFileSync(path.join(rootPath, "notes.json"), "root data\n");
    seedRemote({ remotePath, workPath: repoPath, files: { "notes.json": "repo data\n" } });
    const localHeadBefore = gitHead(repoPath);
    const remoteHeadBefore = remoteHead(remotePath);
    const backend = createGitBackend({ repoPath, remoteUrl: remotePath });

    assert.deepEqual(backend.inspectBootstrap({ rootPath, excludePatterns: [".sync-core/**"] }), {
      localHasData: true,
      remoteHasHistory: true
    });
    assert.equal(fs.readFileSync(path.join(rootPath, "notes.json"), "utf8"), "root data\n");
    assert.equal(fs.readFileSync(path.join(repoPath, "notes.json"), "utf8"), "repo data\n");
    assert.equal(gitHead(repoPath), localHeadBefore);
    assert.equal(remoteHead(remotePath), remoteHeadBefore);
  });
});

test("Git backend receives remote changes when the local tree is clean", async () => {
  await withSandbox("git-receive-clean-", async (sandbox) => {
    const rootPath = path.join(sandbox, "data");
    const remotePath = path.join(sandbox, "remote.git");
    const seedPath = path.join(sandbox, "seed");
    fs.mkdirSync(rootPath, { recursive: true });
    seedRemote({ remotePath, workPath: seedPath, files: { "notes.json": "first\n" } });
    const backend = createGitBackend({
      repoPath: rootPath,
      remoteUrl: remotePath,
      branch: "main",
      publishLocal: false
    });

    await backend.synchronize(request(rootPath));
    fs.writeFileSync(path.join(seedPath, "notes.json"), "second\n", "utf8");
    execFileSync("git", ["-C", seedPath, "add", "notes.json"], { stdio: "pipe" });
    execFileSync(
      "git",
      ["-C", seedPath, "-c", "user.name=sync test", "-c", "user.email=sync@example.test", "commit", "-m", "update"],
      { stdio: "pipe" }
    );
    execFileSync("git", ["-C", seedPath, "push", "origin", "main"], { stdio: "pipe" });

    await backend.synchronize(request(rootPath));

    assert.equal(fs.readFileSync(path.join(rootPath, "notes.json"), "utf8"), "second\n");
  });
});

test("Git backend integrates remote changes while preserving a new local commit", async () => {
  await withSandbox("git-receive-local-", async (sandbox) => {
    const rootPath = path.join(sandbox, "data");
    const remotePath = path.join(sandbox, "remote.git");
    const seedPath = path.join(sandbox, "seed");
    fs.mkdirSync(rootPath, { recursive: true });
    seedRemote({ remotePath, workPath: seedPath, files: { "notes.json": "first\n" } });
    const backend = createGitBackend({
      repoPath: rootPath,
      remoteUrl: remotePath,
      branch: "main",
      publishLocal: false
    });
    await backend.synchronize(request(rootPath));

    fs.writeFileSync(path.join(rootPath, "todos.json"), "local\n", "utf8");
    fs.writeFileSync(path.join(seedPath, "notes.json"), "remote update\n", "utf8");
    execFileSync("git", ["-C", seedPath, "add", "notes.json"], { stdio: "pipe" });
    execFileSync(
      "git",
      [
        "-C",
        seedPath,
        "-c",
        "user.name=sync test",
        "-c",
        "user.email=sync@example.test",
        "commit",
        "-m",
        "remote update"
      ],
      { stdio: "pipe" }
    );
    execFileSync("git", ["-C", seedPath, "push", "origin", "main"], { stdio: "pipe" });

    await backend.synchronize(request(rootPath));

    assert.equal(fs.readFileSync(path.join(rootPath, "notes.json"), "utf8"), "remote update\n");
    assert.equal(fs.readFileSync(path.join(rootPath, "todos.json"), "utf8"), "local\n");
  });
});

test("Git backend checks out an existing configured local branch", async () => {
  await withSandbox("git-local-branch-", async (sandbox) => {
    const repoPath = path.join(sandbox, "repo");
    fs.mkdirSync(repoPath, { recursive: true });
    execFileSync("git", ["init", "-b", "other", repoPath], { stdio: "pipe" });
    fs.writeFileSync(path.join(repoPath, "base.txt"), "base\n", "utf8");
    execFileSync("git", ["-C", repoPath, "add", "base.txt"], { stdio: "pipe" });
    execFileSync(
      "git",
      ["-C", repoPath, "-c", "user.name=sync test", "-c", "user.email=sync@example.test", "commit", "-m", "base"],
      { stdio: "pipe" }
    );
    execFileSync("git", ["-C", repoPath, "branch", "configured"], { stdio: "pipe" });
    const backend = createGitBackend({ repoPath, branch: "configured", receiveRemote: false, publishLocal: false });

    await backend.synchronize(request(repoPath, { excludePatterns: [] }));

    assert.equal(String(execFileSync("git", ["-C", repoPath, "branch", "--show-current"])).trim(), "configured");
  });
});

test("Git backend creates and checks out a missing configured branch in an existing repo", async () => {
  await withSandbox("git-missing-local-branch-", async (sandbox) => {
    const repoPath = path.join(sandbox, "repo");
    fs.mkdirSync(repoPath, { recursive: true });
    execFileSync("git", ["init", "-b", "other", repoPath], { stdio: "pipe" });
    fs.writeFileSync(path.join(repoPath, "base.txt"), "base\n", "utf8");
    execFileSync("git", ["-C", repoPath, "add", "base.txt"], { stdio: "pipe" });
    execFileSync(
      "git",
      ["-C", repoPath, "-c", "user.name=sync test", "-c", "user.email=sync@example.test", "commit", "-m", "base"],
      { stdio: "pipe" }
    );
    const backend = createGitBackend({ repoPath, branch: "configured", receiveRemote: false, publishLocal: false });

    await backend.synchronize(request(repoPath, { excludePatterns: [] }));

    assert.equal(String(execFileSync("git", ["-C", repoPath, "branch", "--show-current"])).trim(), "configured");
  });
});

test("Git backend tracks a configured remote branch when no local branch exists", async () => {
  await withSandbox("git-remote-branch-", async (sandbox) => {
    const repoPath = path.join(sandbox, "repo");
    const remotePath = path.join(sandbox, "remote.git");
    const seedPath = path.join(sandbox, "seed");
    seedRemote({ remotePath, workPath: seedPath, files: { "remote.txt": "remote\n" } });
    fs.mkdirSync(repoPath, { recursive: true });
    execFileSync("git", ["init", "-b", "other", repoPath], { stdio: "pipe" });
    const backend = createGitBackend({ repoPath, remoteUrl: remotePath, branch: "main", publishLocal: false });

    await backend.synchronize(request(repoPath, { excludePatterns: [] }));

    assert.equal(String(execFileSync("git", ["-C", repoPath, "branch", "--show-current"])).trim(), "main");
    assert.equal(fs.readFileSync(path.join(repoPath, "remote.txt"), "utf8"), "remote\n");
    assert.equal(
      String(
        execFileSync("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
      ).trim(),
      "origin/main"
    );
  });
});

test("Git backend creates the configured remote branch on first publish", async () => {
  await withSandbox("git-first-branch-publish-", async (sandbox) => {
    const repoPath = path.join(sandbox, "repo");
    const remotePath = path.join(sandbox, "remote.git");
    fs.mkdirSync(repoPath, { recursive: true });
    execFileSync("git", ["init", "-b", "other", repoPath], { stdio: "pipe" });
    fs.writeFileSync(path.join(repoPath, "data.txt"), "data\n", "utf8");
    execFileSync("git", ["-C", repoPath, "add", "data.txt"], { stdio: "pipe" });
    execFileSync(
      "git",
      ["-C", repoPath, "-c", "user.name=sync test", "-c", "user.email=sync@example.test", "commit", "-m", "base"],
      { stdio: "pipe" }
    );
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remotePath], { stdio: "pipe" });
    const backend = createGitBackend({ repoPath, remoteUrl: remotePath, branch: "configured" });

    await backend.synchronize(request(repoPath, { excludePatterns: [] }));

    assert.equal(String(execFileSync("git", ["-C", repoPath, "branch", "--show-current"])).trim(), "configured");
    assert.match(
      String(execFileSync("git", ["ls-remote", "--heads", remotePath, "configured"])),
      /refs\/heads\/configured/
    );
  });
});
