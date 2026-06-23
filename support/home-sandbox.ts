const fs = require('node:fs');
const path = require('node:path');

const REAL_HOME = path.resolve(require('node:os').userInfo().homedir);
const REPO_ROOT = path.resolve(__dirname, '..');
const TEST_TMP_ROOT = path.join(REPO_ROOT, 'tmp');

function setTestHome(tempHome: any) {
  const resolvedTempHome = path.resolve(tempHome);

  if (resolvedTempHome === REAL_HOME) {
    throw new Error('Test HOME must not point to the real home directory');
  }

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

async function withTempHome(run: any, options: any = {}) {
  const prefix = options.prefix || 'ilu-test-home-';
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

module.exports = {
  setTestHome,
  withTempHome
};
