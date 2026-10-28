import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export async function captureIluScenario(options) {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const artifacts = path.join(root, 'tmp', 'terminal-captures');
  fs.mkdirSync(artifacts, {recursive: true});
  const directory = fs.mkdtempSync(path.join(artifacts, 'case-'));
  const home = path.join(directory, 'controller-home');
  fs.mkdirSync(home, {mode: 0o700});
  const request = path.join(directory, 'request.json');
  const response = path.join(directory, 'response.json');
  fs.writeFileSync(request, JSON.stringify(options), {mode: 0o600});
  const stdout = fs.openSync(path.join(directory, 'controller.stdout.log'), 'w', 0o600);
  const stderr = fs.openSync(path.join(directory, 'controller.stderr.log'), 'w', 0o600);
  let child;
  try {
    child = spawn('bun', [path.join(import.meta.dirname, 'terminal-capture-worker.ts'), request, response], {
      cwd: root,
      env: {PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', HOME: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0'},
      stdio: ['ignore', stdout, stderr]
    });
  } finally {
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }
  // The external controller is outside the cleanup permission. Await its own
  // finally/normal exit rather than adding a timeout that kills the process.
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (!fs.existsSync(response)) {
    throw new Error(`Capture controller exited (${code}) without a result. Diagnostics: ${directory}`);
  }
  const result = JSON.parse(fs.readFileSync(response, 'utf8'));
  if (code !== 0 || result.ok !== true) {
    throw new Error(`Physical capture failed. Diagnostics: ${directory}\n${result.error}`);
  }
  return result.value;
}
