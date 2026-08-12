import fs from "node:fs";
import path from "node:path";
import * as __cjsImport37 from "node:child_process";
const { execFileSync } = __cjsImport37;
import type { Awaitable, SyncBackend, SyncFailure, SyncMutationContext, SyncRequest } from "../types.js";
type IgnoreMatcher = (relativePath: string) => boolean;
type CollectFilesOptions = {
  isIgnored?: IgnoreMatcher;
  includeGitFiles?: boolean;
};
type GitCliBackendOptions = {
  repoPath?: string | null;
  branch?: string;
  remote?: string;
  remoteUrl?: string | null;
  receiveRemote?: boolean;
  publishLocal?: boolean;
  describeChange?: (context: SyncMutationContext) => Awaitable<string>;
};
type CommitOptions = {
  entries?: string[];
};
type InspectBootstrapOptions = {
  rootPath: string;
  excludePatterns?: string[];
};

type GitBackend = SyncBackend & {
  adoptRemote(): void;
  inspectBootstrap(options: InspectBootstrapOptions): { localHasData: boolean; remoteHasHistory: boolean };
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function classifyError(error: unknown, request: SyncRequest): SyncFailure {
  void request;
  const message = getErrorMessage(error).toLowerCase();

  if (
    message.includes("authentication failed") ||
    message.includes("permission denied") ||
    message.includes("could not authenticate") ||
    message.includes("could not read from remote repository")
  ) {
    return { kind: "auth", retryable: false, safeMessage: "Remote authentication failed" };
  }

  if (message.includes("remote rejected") || message.includes("non-fast-forward")) {
    return { kind: "conflict", retryable: false, safeMessage: "Remote changes conflict with local data" };
  }

  if (
    message.includes("resolve host") ||
    message.includes("connection timed out") ||
    message.includes("connection reset") ||
    message.includes("network is unreachable")
  ) {
    return { kind: "network", retryable: true, safeMessage: "The remote service is unavailable" };
  }

  if (message.includes("conflict") || message.includes("failed to push some refs")) {
    return { kind: "conflict", retryable: false, safeMessage: "Remote changes conflict with local data" };
  }

  if (
    message.includes("not a git repository") ||
    message.includes("unknown revision") ||
    message.includes("no such remote") ||
    message.includes("missing repo path")
  ) {
    return { kind: "config", retryable: false, safeMessage: "Git synchronization is not configured correctly" };
  }

  return { kind: "unknown", retryable: false, safeMessage: "Git synchronization failed" };
}

function normalizeIgnorePatterns(ignorePatterns: unknown = []) {
  if (!Array.isArray(ignorePatterns)) {
    return [];
  }

  return ignorePatterns
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeRelativePath(value: string) {
  return value.split(path.sep).join("/");
}

function createIgnoreMatcher(ignorePatterns: unknown = []) {
  const normalizedPatterns = normalizeIgnorePatterns(ignorePatterns).map((pattern) => normalizeRelativePath(pattern));

  return function isIgnored(relativePath: string) {
    const normalizedPath = normalizeRelativePath(relativePath);

    return normalizedPatterns.some((pattern) => {
      if (pattern.endsWith("/**")) {
        const prefix = pattern.slice(0, -3);
        return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
      }

      const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
      const regex = new RegExp(`^${escaped.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*")}$`);
      return regex.test(normalizedPath);
    });
  };
}

function collectFiles(
  rootPath: string | null | undefined,
  { isIgnored = () => false, includeGitFiles = false }: CollectFilesOptions = {}
) {
  const collected: string[] = [];

  if (!rootPath || !fs.existsSync(rootPath)) {
    return collected;
  }

  const basePath: string = rootPath;

  function walk(currentPath: string) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    entries.forEach((entry) => {
      if (!includeGitFiles && entry.name === ".git") {
        return;
      }

      if (entry.isSymbolicLink()) {
        return;
      }

      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = normalizeRelativePath(path.relative(basePath, absolutePath));

      if (isIgnored(relativePath)) {
        return;
      }

      if (entry.isDirectory()) {
        walk(absolutePath);
        return;
      }

      collected.push(relativePath);
    });
  }

  walk(rootPath);
  return collected;
}

function createGitBackend({
  repoPath,
  branch = "main",
  remote = "origin",
  remoteUrl = null,
  receiveRemote = true,
  publishLocal = true,
  describeChange = (context) =>
    `sync(${typeof context.domain === "string" ? context.domain : "data"}): ${
      typeof context.action === "string" ? context.action : "save"
    } local data snapshot`
}: GitCliBackendOptions = {}): GitBackend {
  function ensureIgnoreFile(excludePatterns: string[]) {
    if (excludePatterns.length === 0) {
      return;
    }

    if (!repoPath) {
      throw new Error("Missing repo path");
    }

    const ignoreFile = path.join(repoPath, ".gitignore");
    let lines: string[] = [];

    if (fs.existsSync(ignoreFile)) {
      lines = fs.readFileSync(ignoreFile, "utf8").split(/\r?\n/).filter(Boolean);
    }

    excludePatterns.forEach((entry) => {
      if (!lines.includes(entry)) {
        lines.push(entry);
      }
    });

    fs.writeFileSync(ignoreFile, `${lines.join("\n")}\n`, "utf8");
  }

  function run(args: string[], options: Parameters<typeof execFileSync>[2] = {}) {
    const cwd = repoPath && fs.existsSync(repoPath) ? repoPath : process.cwd();

    return String(
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
          GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "sync-core",
          GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "sync@sync-core.local",
          GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "sync-core",
          GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "sync@sync-core.local"
        },
        ...options
      })
    ).trim();
  }

  function ensureDir(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  function isTracked(entry: string) {
    try {
      run(["ls-files", "--error-unmatch", "--", entry]);
      return true;
    } catch {
      return false;
    }
  }

  function refExists(ref: string) {
    try {
      run(["show-ref", "--verify", ref]);
      return true;
    } catch {
      return false;
    }
  }

  function getCurrentBranch() {
    try {
      return run(["symbolic-ref", "--short", "HEAD"]);
    } catch {
      return "";
    }
  }

  function hasCommit() {
    try {
      run(["rev-parse", "--verify", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  function positionConfiguredBranch(receiveRemote: boolean) {
    const localRef = `refs/heads/${branch}`;
    const remoteRef = `refs/remotes/${remote}/${branch}`;
    const currentBranch = getCurrentBranch();

    if (refExists(localRef)) {
      if (currentBranch !== branch) {
        run(["checkout", branch]);
      }
      return false;
    }

    if (receiveRemote) {
      let hasRemote = false;

      try {
        run(["remote", "get-url", remote]);
        hasRemote = true;
      } catch {
        hasRemote = false;
      }

      if (hasRemote) {
        run(["fetch", remote]);
        if (refExists(remoteRef)) {
          run(["checkout", "-B", branch, "--track", `${remote}/${branch}`]);
          return true;
        }
      }
    }

    if (hasCommit()) {
      run(["checkout", "-b", branch]);
      return false;
    }

    if (currentBranch !== branch) {
      run(["symbolic-ref", "HEAD", localRef]);
    }
    return false;
  }

  function ensureReady({ excludePatterns }: Pick<SyncRequest, "excludePatterns">) {
    if (!repoPath) {
      throw new Error("Missing repo path");
    }

    fs.mkdirSync(repoPath, { recursive: true });

    if (!fs.existsSync(path.join(repoPath, ".git"))) {
      run(["init", "-b", branch]);
    }

    if (remoteUrl) {
      let currentRemoteUrl = "";

      try {
        currentRemoteUrl = run(["remote", "get-url", remote]);
      } catch {
        currentRemoteUrl = "";
      }

      if (!currentRemoteUrl) {
        run(["remote", "add", remote, remoteUrl]);
      } else if (currentRemoteUrl !== remoteUrl) {
        run(["remote", "set-url", remote, remoteUrl]);
      }
    }

    const checkedOutRemoteBranch = positionConfiguredBranch(receiveRemote);
    ensureIgnoreFile(excludePatterns);
    return checkedOutRemoteBranch;
  }

  function syncWorkingTree({ rootPath, excludePatterns = [] }: Pick<SyncRequest, "rootPath" | "excludePatterns">) {
    if (!repoPath) {
      throw new Error("Missing repo path");
    }

    const isIgnored = createIgnoreMatcher(excludePatterns);
    const sourceFiles = collectFiles(rootPath, { isIgnored });
    const sourceRootPath = rootPath ? path.resolve(rootPath) : null;
    const repoRootPath = repoPath ? path.resolve(repoPath) : null;

    sourceFiles.forEach((entry) => {
      const sourceFile = path.join(rootPath, entry);
      const targetFile = path.join(repoPath, entry);

      if (fs.lstatSync(sourceFile).isSymbolicLink()) {
        return;
      }

      ensureDir(targetFile);

      if (sourceRootPath === repoRootPath && path.resolve(sourceFile) === path.resolve(targetFile)) {
        return;
      }

      fs.copyFileSync(sourceFile, targetFile);
    });

    collectFiles(repoPath, { isIgnored }).forEach((entry) => {
      if (entry === ".gitignore" || sourceFiles.includes(entry)) {
        return;
      }

      fs.rmSync(path.join(repoPath, entry), { force: true });
    });
  }

  function syncIntegratedTreeToRoot({
    rootPath,
    excludePatterns = []
  }: Pick<SyncRequest, "rootPath" | "excludePatterns">) {
    if (!repoPath || path.resolve(repoPath) === path.resolve(rootPath)) {
      return;
    }

    const isIgnored = createIgnoreMatcher(excludePatterns);
    const repoFiles = collectFiles(repoPath, { isIgnored }).filter((entry) => entry !== ".gitignore");

    repoFiles.forEach((entry) => {
      const sourceFile = path.join(repoPath, entry);
      const targetFile = path.join(rootPath, entry);
      ensureDir(targetFile);
      fs.copyFileSync(sourceFile, targetFile);
    });

    collectFiles(rootPath, { isIgnored }).forEach((entry) => {
      if (entry === ".gitignore" || repoFiles.includes(entry)) {
        return;
      }

      fs.rmSync(path.join(rootPath, entry), { force: true });
    });
  }

  function hasChanges() {
    return run(["status", "--porcelain"]).length > 0;
  }

  function commit(message: string, { entries = [] }: CommitOptions = {}) {
    const trackedEntries = entries.length > 0 ? entries : ["."];

    if (trackedEntries.length === 1 && trackedEntries[0] === ".") {
      run(["add", "--all", "--", "."]);
    } else {
      trackedEntries.forEach((entry) => {
        if (!repoPath) {
          throw new Error("Missing repo path");
        }
        if (fs.existsSync(path.join(repoPath, entry)) || isTracked(entry)) {
          run(["add", "--all", "--", entry]);
        }
      });
    }

    run(["commit", "-m", message]);
  }

  function fetch() {
    run(["fetch", remote]);
  }

  function integrate() {
    if (run(["ls-remote", "--heads", remote, branch]).length === 0) {
      return;
    }

    run(["pull", "--rebase", remote, branch]);
  }

  function push() {
    run(["push", remote, branch]);
  }

  function hasUnpublishedCommits() {
    if (!hasCommit()) {
      return false;
    }

    try {
      run(["show-ref", "--verify", `refs/remotes/${remote}/${branch}`]);
    } catch {
      return true;
    }

    return Number(run(["rev-list", "--count", `${remote}/${branch}..HEAD`])) > 0;
  }

  function hydrateEmptyRoot(request: SyncRequest) {
    if (!repoPath || path.resolve(repoPath) === path.resolve(request.rootPath) || !fs.existsSync(repoPath)) {
      return false;
    }

    const isIgnored = createIgnoreMatcher(request.excludePatterns);
    const rootFiles = collectFiles(request.rootPath, { isIgnored });
    const repoFiles = collectFiles(repoPath, { isIgnored }).filter((entry) => entry !== ".gitignore");
    if (rootFiles.length > 0 || repoFiles.length === 0) {
      return false;
    }

    syncIntegratedTreeToRoot(request);
    return true;
  }

  return {
    async synchronize(request) {
      if (hydrateEmptyRoot(request)) {
        return;
      }

      ensureReady(request);

      if (hydrateEmptyRoot(request)) {
        return;
      }
      syncWorkingTree(request);
      const localChanges = hasChanges();

      if (localChanges) {
        const description = await describeChange(request.context);
        commit(
          typeof description === "string" && description.trim().length > 0
            ? description
            : "sync(data): save local data snapshot"
        );
      }

      if (receiveRemote) {
        fetch();
        integrate();
        syncIntegratedTreeToRoot(request);
      }

      if (publishLocal && hasUnpublishedCommits()) {
        push();
      }
    },
    classifyError,
    adoptRemote() {
      ensureReady({ excludePatterns: [] });
      fetch();
      run(["checkout", "-B", branch, `${remote}/${branch}`]);
    },
    inspectBootstrap({ rootPath, excludePatterns = [] }: InspectBootstrapOptions) {
      const isIgnored = createIgnoreMatcher(excludePatterns);
      const localHasData = collectFiles(rootPath, { isIgnored }).length > 0;
      let remoteHasHistory = false;

      remoteHasHistory = run(["ls-remote", "--heads", remoteUrl || remote]).length > 0;

      return { localHasData, remoteHasHistory };
    }
  };
}

export { createGitBackend, classifyError };
export type { GitBackend, GitCliBackendOptions };
export default {
  createGitBackend,
  classifyError
};
