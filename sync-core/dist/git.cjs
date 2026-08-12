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

// src/git.ts
var git_exports = {};
__export(git_exports, {
  classifyError: () => classifyError,
  createGitBackend: () => createGitBackend
});
module.exports = __toCommonJS(git_exports);

// src/backends/git-cli.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var __cjsImport37 = __toESM(require("node:child_process"), 1);
var { execFileSync } = __cjsImport37;
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function classifyError(error, request) {
  void request;
  const message = getErrorMessage(error).toLowerCase();
  if (message.includes("authentication failed") || message.includes("permission denied") || message.includes("could not authenticate") || message.includes("could not read from remote repository")) {
    return { kind: "auth", retryable: false, safeMessage: "Remote authentication failed" };
  }
  if (message.includes("remote rejected") || message.includes("non-fast-forward")) {
    return { kind: "conflict", retryable: false, safeMessage: "Remote changes conflict with local data" };
  }
  if (message.includes("resolve host") || message.includes("connection timed out") || message.includes("connection reset") || message.includes("network is unreachable")) {
    return { kind: "network", retryable: true, safeMessage: "The remote service is unavailable" };
  }
  if (message.includes("conflict") || message.includes("failed to push some refs")) {
    return { kind: "conflict", retryable: false, safeMessage: "Remote changes conflict with local data" };
  }
  if (message.includes("not a git repository") || message.includes("unknown revision") || message.includes("no such remote") || message.includes("missing repo path")) {
    return { kind: "config", retryable: false, safeMessage: "Git synchronization is not configured correctly" };
  }
  return { kind: "unknown", retryable: false, safeMessage: "Git synchronization failed" };
}
function normalizeIgnorePatterns(ignorePatterns = []) {
  if (!Array.isArray(ignorePatterns)) {
    return [];
  }
  return ignorePatterns.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}
function normalizeRelativePath(value) {
  return value.split(import_node_path.default.sep).join("/");
}
function createIgnoreMatcher(ignorePatterns = []) {
  const normalizedPatterns = normalizeIgnorePatterns(ignorePatterns).map((pattern) => normalizeRelativePath(pattern));
  return function isIgnored(relativePath) {
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
function collectFiles(rootPath, { isIgnored = () => false, includeGitFiles = false } = {}) {
  const collected = [];
  if (!rootPath || !import_node_fs.default.existsSync(rootPath)) {
    return collected;
  }
  const basePath = rootPath;
  function walk(currentPath) {
    const entries = import_node_fs.default.readdirSync(currentPath, { withFileTypes: true });
    entries.forEach((entry) => {
      if (!includeGitFiles && entry.name === ".git") {
        return;
      }
      if (entry.isSymbolicLink()) {
        return;
      }
      const absolutePath = import_node_path.default.join(currentPath, entry.name);
      const relativePath = normalizeRelativePath(import_node_path.default.relative(basePath, absolutePath));
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
  describeChange = (context) => `sync(${typeof context.domain === "string" ? context.domain : "data"}): ${typeof context.action === "string" ? context.action : "save"} local data snapshot`
} = {}) {
  function ensureIgnoreFile(excludePatterns) {
    if (excludePatterns.length === 0) {
      return;
    }
    if (!repoPath) {
      throw new Error("Missing repo path");
    }
    const ignoreFile = import_node_path.default.join(repoPath, ".gitignore");
    let lines = [];
    if (import_node_fs.default.existsSync(ignoreFile)) {
      lines = import_node_fs.default.readFileSync(ignoreFile, "utf8").split(/\r?\n/).filter(Boolean);
    }
    excludePatterns.forEach((entry) => {
      if (!lines.includes(entry)) {
        lines.push(entry);
      }
    });
    import_node_fs.default.writeFileSync(ignoreFile, `${lines.join("\n")}
`, "utf8");
  }
  function run(args, options = {}) {
    const cwd = repoPath && import_node_fs.default.existsSync(repoPath) ? repoPath : process.cwd();
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
  function ensureDir(filePath) {
    import_node_fs.default.mkdirSync(import_node_path.default.dirname(filePath), { recursive: true });
  }
  function isTracked(entry) {
    try {
      run(["ls-files", "--error-unmatch", "--", entry]);
      return true;
    } catch {
      return false;
    }
  }
  function refExists(ref) {
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
  function positionConfiguredBranch(receiveRemote2) {
    const localRef = `refs/heads/${branch}`;
    const remoteRef = `refs/remotes/${remote}/${branch}`;
    const currentBranch = getCurrentBranch();
    if (refExists(localRef)) {
      if (currentBranch !== branch) {
        run(["checkout", branch]);
      }
      return false;
    }
    if (receiveRemote2) {
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
  function ensureReady({ excludePatterns }) {
    if (!repoPath) {
      throw new Error("Missing repo path");
    }
    import_node_fs.default.mkdirSync(repoPath, { recursive: true });
    if (!import_node_fs.default.existsSync(import_node_path.default.join(repoPath, ".git"))) {
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
  function syncWorkingTree({ rootPath, excludePatterns = [] }) {
    if (!repoPath) {
      throw new Error("Missing repo path");
    }
    const isIgnored = createIgnoreMatcher(excludePatterns);
    const sourceFiles = collectFiles(rootPath, { isIgnored });
    const sourceRootPath = rootPath ? import_node_path.default.resolve(rootPath) : null;
    const repoRootPath = repoPath ? import_node_path.default.resolve(repoPath) : null;
    sourceFiles.forEach((entry) => {
      const sourceFile = import_node_path.default.join(rootPath, entry);
      const targetFile = import_node_path.default.join(repoPath, entry);
      if (import_node_fs.default.lstatSync(sourceFile).isSymbolicLink()) {
        return;
      }
      ensureDir(targetFile);
      if (sourceRootPath === repoRootPath && import_node_path.default.resolve(sourceFile) === import_node_path.default.resolve(targetFile)) {
        return;
      }
      import_node_fs.default.copyFileSync(sourceFile, targetFile);
    });
    collectFiles(repoPath, { isIgnored }).forEach((entry) => {
      if (entry === ".gitignore" || sourceFiles.includes(entry)) {
        return;
      }
      import_node_fs.default.rmSync(import_node_path.default.join(repoPath, entry), { force: true });
    });
  }
  function syncIntegratedTreeToRoot({
    rootPath,
    excludePatterns = []
  }) {
    if (!repoPath || import_node_path.default.resolve(repoPath) === import_node_path.default.resolve(rootPath)) {
      return;
    }
    const isIgnored = createIgnoreMatcher(excludePatterns);
    const repoFiles = collectFiles(repoPath, { isIgnored }).filter((entry) => entry !== ".gitignore");
    repoFiles.forEach((entry) => {
      const sourceFile = import_node_path.default.join(repoPath, entry);
      const targetFile = import_node_path.default.join(rootPath, entry);
      ensureDir(targetFile);
      import_node_fs.default.copyFileSync(sourceFile, targetFile);
    });
    collectFiles(rootPath, { isIgnored }).forEach((entry) => {
      if (entry === ".gitignore" || repoFiles.includes(entry)) {
        return;
      }
      import_node_fs.default.rmSync(import_node_path.default.join(rootPath, entry), { force: true });
    });
  }
  function hasChanges() {
    return run(["status", "--porcelain"]).length > 0;
  }
  function commit(message, { entries = [] } = {}) {
    const trackedEntries = entries.length > 0 ? entries : ["."];
    if (trackedEntries.length === 1 && trackedEntries[0] === ".") {
      run(["add", "--all", "--", "."]);
    } else {
      trackedEntries.forEach((entry) => {
        if (!repoPath) {
          throw new Error("Missing repo path");
        }
        if (import_node_fs.default.existsSync(import_node_path.default.join(repoPath, entry)) || isTracked(entry)) {
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
  function hydrateEmptyRoot(request) {
    if (!repoPath || import_node_path.default.resolve(repoPath) === import_node_path.default.resolve(request.rootPath) || !import_node_fs.default.existsSync(repoPath)) {
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
          typeof description === "string" && description.trim().length > 0 ? description : "sync(data): save local data snapshot"
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
    inspectBootstrap({ rootPath, excludePatterns = [] }) {
      const isIgnored = createIgnoreMatcher(excludePatterns);
      const localHasData = collectFiles(rootPath, { isIgnored }).length > 0;
      let remoteHasHistory = false;
      remoteHasHistory = run(["ls-remote", "--heads", remoteUrl || remote]).length > 0;
      return { localHasData, remoteHasHistory };
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  classifyError,
  createGitBackend
});
