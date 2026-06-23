const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {setTestHome, withTempHome} = require('../../support/home-sandbox');

test('setTestHome rechaza usar el HOME real', () => {
  assert.throws(() => setTestHome(os.homedir()), /real home/i);
});

test('withTempHome usa HOME aislado y lo restaura al finalizar', async () => {
  const originalHome = process.env.HOME;
  const realHome = os.homedir();

  await withTempHome(async tempHome => {
    assert.notEqual(tempHome, realHome);
    assert.equal(process.env.HOME, tempHome);
    assert.equal(fs.existsSync(tempHome), true);
  });

  assert.equal(process.env.HOME, originalHome);
});

test('withTempHome limpia el directorio temporal al terminar', async () => {
  let tempHomePath;

  await withTempHome(async tempHome => {
    tempHomePath = tempHome;
    fs.writeFileSync(path.join(tempHome, 'sentinel.txt'), 'ok', 'utf8');
  });

  assert.equal(fs.existsSync(tempHomePath), false);
});

test('setTestHome permite reinstalar el mismo HOME temporal sin confundirlo con el HOME real', async () => {
  await withTempHome(async tempHome => {
    const restoreHome = setTestHome(tempHome);
    restoreHome();
    assert.equal(process.env.HOME, tempHome);
  });
});
