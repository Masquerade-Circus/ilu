#!/usr/bin/env node
process.env.TSX_TSCONFIG_PATH = require('node:path').resolve(__dirname, '..', 'tsconfig.json');
require('tsx/cjs');
require('../cli.ts');
