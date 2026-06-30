import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const repoRoot = path.resolve(import.meta.dirname, '..');

function runHelp(entrypoint) {
  return spawnSync(process.execPath, [entrypoint, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function runCli(entrypoint, ...args) {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

test('node bin/cli.js --help arranca correctamente', () => {
  const result = runHelp(path.join(repoRoot, 'bin/cli.js'));

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}${result.stderr}`, /Cli tools for productivity/);
});

test('node bin/cli.js --version imprime la versión del paquete', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), '--version');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), '1.0.4');
});

test('node bin/cli.js resuelve tsx desde un layout instalado con dependencias hoisted', () => {
  const installRoot = fs.mkdtempSync(path.join(repoRoot, 'tmp', 'ilu-cli-hoisted-'));
  const packageRoot = path.join(installRoot, 'package');

  try {
    fs.mkdirSync(packageRoot);

    for (const entryName of fs.readdirSync(repoRoot)) {
      if (entryName === '.git' || entryName === 'node_modules' || entryName === 'tmp') {
        continue;
      }

      fs.cpSync(path.join(repoRoot, entryName), path.join(packageRoot, entryName), {
        recursive: true
      });
    }

    fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(installRoot, 'node_modules'), 'dir');

    const result = spawnSync(process.execPath, [path.join(packageRoot, 'bin/cli.js'), '--version'], {
      cwd: installRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), '1.0.4');
  } finally {
    fs.rmSync(installRoot, {recursive: true, force: true});
  }
});

test('node bin/cli.js rechaza flags desconocidos sin stack trace', () => {
  const result = runCli(path.join(repoRoot, 'bin/cli.js'), '--unknown-startup-flag');

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stderr, /unknown option/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /at .*\(/);
});

test('node bin/cli.js preserva cwd externo del usuario al resolver rutas relativas de tts', () => {
  const externalCwd = path.dirname(repoRoot);
  const homeDir = fs.mkdtempSync(path.join(repoRoot, 'tmp', 'ilu-cli-cwd-home-'));

  try {
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'bin/cli.js'), 'tts', 'ilu/README.md', 'ilu/README.md'],
      {
        cwd: externalCwd,
        encoding: 'utf8',
        env: {...process.env, HOME: homeDir}
      }
    );

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /output file must be different from input file/i);
    assert.doesNotMatch(result.stderr, /Input file not found/i);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/i);
  } finally {
    fs.rmSync(homeDir, {recursive: true, force: true});
  }
});
