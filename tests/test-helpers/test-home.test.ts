import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as __cjsImport70 from 'node:child_process';
import * as __cjsImport69 from '../../support/home-sandbox';

const { spawnSync } = __cjsImport70;
const { TEST_TMP_ROOT, assertRepoTempHome, setTestHome, withTempHome } = __cjsImport69;
const repoRoot = path.resolve(import.meta.dirname, '..', '..');

test('setTestHome rechaza usar el HOME real', () => {
  assert.throws(() => setTestHome(os.userInfo().homedir), /real home/i);
});

test('assertRepoTempHome rechaza paths fuera de tmp del repo', () => {
  assert.throws(() => assertRepoTempHome(os.tmpdir(), 'Helper HOME'), /must live under/);
});

test('assertRepoTempHome acepta paths bajo tmp del repo', () => {
  assert.equal(assertRepoTempHome(path.join(TEST_TMP_ROOT, 'allowed'), 'Helper HOME'), path.join(TEST_TMP_ROOT, 'allowed'));
});

test('test-home-guard reemplaza HOME real por un sandbox bajo tmp del repo', () => {
  const result = spawnSync(process.execPath, [
    '--import',
    'tsx',
    '--import',
    './support/test-home-guard.ts',
    '-e',
    'process.stdout.write(process.env.HOME || "")'
  ], {
    cwd: repoRoot,
    env: {...process.env, HOME: os.userInfo().homedir},
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assertRepoTempHome(result.stdout, 'Guarded HOME');
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
