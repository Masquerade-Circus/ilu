#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

require('tsx/cjs');
await tsImport('../cli.ts', {
  parentURL: import.meta.url,
  tsconfig: path.join(repoRoot, 'tsconfig.json')
});
