import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TEST_TMP_ROOT } from './home-sandbox.ts';

const realHome = path.resolve(os.userInfo().homedir);
const currentHome = process.env.HOME;

if (typeof currentHome !== 'string' || currentHome.trim() === '' || path.resolve(currentHome) === realHome) {
  fs.mkdirSync(TEST_TMP_ROOT, {recursive: true});
  process.env.HOME = fs.mkdtempSync(path.join(TEST_TMP_ROOT, 'ilu-test-suite-home-'));
}
