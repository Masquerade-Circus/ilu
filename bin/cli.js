#!/usr/bin/node --harmony
let {Command} = require('commander');
let pkg = require('../package.json');
// TODO use https://github.com/sindresorhus/terminal-link to parse content and convert links
// TODO use https://github.com/Automattic/cli-table to kanban

let Todos = require('../todos');
let Notes = require('../notes');
let Translate = require('../translate');
let configureProgram = require('./configure-cli');

let program = new Command();

configureProgram(program, {
    pkg,
    Todos,
    Notes,
    Translate
});

program.parse(process.argv);
