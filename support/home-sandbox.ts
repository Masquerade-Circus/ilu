import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { ensureTestDirectory, openReusableTestDirectory } from "./reusable-test-directory.ts";
const REAL_HOME = path.resolve(os.userInfo().homedir);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_TMP_ROOT = path.join(REPO_ROOT, "tmp");

function isInsidePath(childPath: string, parentPath: string) {
  const relativePath = path.relative(parentPath, childPath);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function assertNotRealHome(homePath: unknown, label = "Test HOME") {
  if (typeof homePath !== "string" || homePath.trim() === "") {
    throw new Error(`${label} must be a non-empty path`);
  }

  const resolvedHome = path.resolve(homePath);

  if (resolvedHome === REAL_HOME) {
    throw new Error(`${label} must not point to the real home directory`);
  }

  return resolvedHome;
}

function assertRepoTempHome(homePath: unknown, label = "Test HOME") {
  const resolvedHome = assertNotRealHome(homePath, label);
  const resolvedTmpRoot = path.resolve(TEST_TMP_ROOT);

  if (!isInsidePath(resolvedHome, resolvedTmpRoot)) {
    throw new Error(`${label} must live under ${resolvedTmpRoot}`);
  }

  return resolvedHome;
}

function setTestHome(tempHome: unknown) {
  const resolvedTempHome = assertNotRealHome(tempHome);

  const originalHome = process.env.HOME;
  process.env.HOME = resolvedTempHome;

  return function restoreHome() {
    if (typeof originalHome === "undefined") {
      delete process.env.HOME;
      return;
    }

    process.env.HOME = originalHome;
  };
}

async function withTempHome<T>(
  run: (tempHome: string) => T | Promise<T>,
  options: { prefix?: string; testName: string }
) {
  const prefix = typeof options.prefix === "string" && options.prefix.length > 0 ? options.prefix : "ilu-test-home-";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(prefix)) {
    throw new Error("Fixture HOME requires a safe directory prefix");
  }
  if (typeof options.testName !== "string" || options.testName.trim().length === 0) {
    throw new Error("Fixture HOME requires the original test name");
  }
  const name = options.testName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (name.length === 0 || name.length > 180) {
    throw new Error("Fixture HOME requires a test name with a stable directory slug");
  }
  const parent = path.join(TEST_TMP_ROOT, "test-fixture-homes", prefix);
  for (const directory of [TEST_TMP_ROOT, path.dirname(parent), parent]) {
    ensureTestDirectory(directory);
  }
  const tempHome = path.join(parent, name);
  const fd = openReusableTestDirectory({ directory: tempHome, markerName: ".ilu-fixture-home", owner: options.testName });
  let restoreHome: (() => void) | null = null;
  try {
    restoreHome = setTestHome(tempHome);
    return await run(tempHome);
  } finally {
    if (typeof restoreHome === "function") {
      restoreHome();
    }
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } finally {
      fs.closeSync(fd);
    }
  }
}

export { TEST_TMP_ROOT, assertNotRealHome, assertRepoTempHome, setTestHome, withTempHome };
export default {
  TEST_TMP_ROOT,
  assertNotRealHome,
  assertRepoTempHome,
  setTestHome,
  withTempHome
};
