import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const REAL_HOME = path.resolve(os.userInfo().homedir);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_TMP_ROOT = path.join(REPO_ROOT, 'tmp');

function isInsidePath(childPath: string, parentPath: string) {
  const relativePath = path.relative(parentPath, childPath);

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function assertNotRealHome(homePath: unknown, label = 'Test HOME') {
  if (typeof homePath !== 'string' || homePath.trim() === '') {
    throw new Error(`${label} must be a non-empty path`);
  }

  const resolvedHome = path.resolve(homePath);

  if (resolvedHome === REAL_HOME) {
    throw new Error(`${label} must not point to the real home directory`);
  }

  return resolvedHome;
}

function assertRepoTempHome(homePath: unknown, label = 'Test HOME') {
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
    if (typeof originalHome === 'undefined') {
      delete process.env.HOME;
      return;
    }

    process.env.HOME = originalHome;
  };
}

async function withTempHome<T>(run: (tempHome: string) => T | Promise<T>, options: { prefix?: string } = {}) {
  const prefix = typeof options.prefix === 'string' && options.prefix.length > 0 ? options.prefix : 'ilu-test-home-';
  fs.mkdirSync(TEST_TMP_ROOT, {recursive: true});
  const tempHome = fs.mkdtempSync(path.join(TEST_TMP_ROOT, prefix));
  const restoreHome = setTestHome(tempHome);

  try {
    return await run(tempHome);
  } finally {
    restoreHome();
    fs.rmSync(tempHome, {recursive: true, force: true});
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
