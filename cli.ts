import * as __cjsImport10 from 'commander';
import pkg from './package.json';
// TODO use https://github.com/sindresorhus/terminal-link to parse content and convert links

import configureProgram from './bin/configure-cli.ts';
import * as __cjsImport11 from './bin/cli-deps.ts';

const { Command } = __cjsImport10;
const { createCliDeps } = __cjsImport11;
const program = new Command();

configureProgram(program, createCliDeps(pkg));

program.parse(process.argv);
