const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REAL_HOME = path.resolve(os.userInfo().homedir);

function setTestHome(tempHome) {
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

async function withTempHome(run, options = {}) {
  const prefix = options.prefix || 'ilu-test-home-';
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
