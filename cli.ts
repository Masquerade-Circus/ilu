const { Command } = require('commander');
const pkg = require('./package.json');
// TODO use https://github.com/sindresorhus/terminal-link to parse content and convert links

const configureProgram = require('./bin/configure-cli');
const { createCliDeps } = require('./bin/cli-deps');

const program = new Command();

configureProgram(program, createCliDeps(pkg));

program.parse(process.argv);
