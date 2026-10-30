import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createGitBackend as createCoreGitBackend } from "sync-core/git";
import type { GitBackend, GitCliBackendOptions } from "sync-core/git";

export { classifyError } from "sync-core/git";

export function createGitBackend(options: GitCliBackendOptions = {}): GitBackend {
  const repoPath = options.repoPath;
  if (typeof repoPath !== "string" || repoPath.trim().length === 0) {
    throw new Error("Missing repo path");
  }
  const backend = createCoreGitBackend(options);
  const hasRebase = () => {
    if (!fs.existsSync(path.join(repoPath, ".git"))) {
      return false;
    }
    const gitDirectory = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: repoPath,
      encoding: "utf8",
      stdio: "pipe"
    }).trim();
    return ["rebase-merge", "rebase-apply"].some((name) => fs.existsSync(path.join(gitDirectory, name)));
  };
  return {
    ...backend,
    async synchronize(request) {
      if (hasRebase()) {
        throw new Error("Sync conflict: resolve the existing Git rebase before synchronizing");
      }
      try {
        await backend.synchronize(request);
      } catch (error: unknown) {
        if (hasRebase()) {
          try {
            execFileSync("git", ["rebase", "--abort"], { cwd: repoPath, stdio: "pipe" });
          } catch (recoveryError: unknown) {
            throw new AggregateError(
              [error, recoveryError],
              "Sync conflict: failed to restore local data after the Git rebase",
              { cause: error }
            );
          }
        }
        throw error;
      }
    }
  };
}
