#!/usr/bin/node --harmony
require('colors');
let updateNotifier = require('update-notifier');
let program = require('caporal');
let pkg = require('../package.json');
updateNotifier({pkg}).notify();
// TODO use https://github.com/sindresorhus/terminal-link to parse content and convert links
// TODO use https://github.com/Automattic/cli-table to kanban

let Todos = require('../todos');
let Notes = require('../notes');
let Translate = require('../translate');
let optionalInt = (opt) => typeof opt === 'boolean' ? opt : parseInt(opt);

program.version(pkg.version).description('Cli tools for productivity');

program
    .command('todo')
    .alias('t')
    .help('ilu'.italic + ' t')
    .description('Manage Todo tasks for the current active list')
    .option('-a, --add', 'Add a new task')
    .option('-d, --details <position>', 'Show details  of the task at <position>', program.INT)
    .option('-e, --edit <position>', 'Edit the task at <position>', program.INT)
    .option('-s, --show', 'Show all tasks')
    .option('-c, --check', 'Check/uncheck finished tasks')
    .option('-r, --remove [position]', 'Remove the task at [position], if no position, remove all tasks', optionalInt)
    .action(Todos.Tasks.actions);

program
    .command('todo-list')
    .alias('tl')
    .help('ilu'.italic + ' tl')
    .description('Manage Todo lists')
    .option('-a, --add', 'Add new list')
    .option('-d, --details <position>', 'Show details of the list at <position>', program.INT)
    .option('-e, --edit <position>', 'Edit the list at <position>', program.INT)
    .option('-s, --show', 'Show all lists')
    .option('-u, --use <position>', 'Use the list at <position>', program.INT)
    .option('-r, --remove [position]', 'Remove the list at [position], if no position, remove all the lists', optionalInt)
    .option('-c, --current', 'Show the details of the current list')
    .option('-A, --add-label', 'Add new label to the current list')
    .option('-E, --edit-label <position>', 'Edit the label at <position>', program.INT)
    .option('-R, --remove-label [position]', 'Remove the label at [position], if no position, remove all labels', optionalInt)
    .action(Todos.Lists.actions);

program
    .command('note')
    .alias('n')
    .help('ilu'.italic + ' n')
    .description('Manage Notes for the current active list')
    .option('-a, --add', 'Add a new note')
    .option('-d, --details <position>', 'Show details of the note at <postion>', program.INT)
    .option('-e, --edit <position>', 'Edit the note at <position>', program.INT)
    .option('-s, --show', 'Show all notes')
    .option('-r, --remove [position]', 'Remove the note at [position], if no position, remove all the notes', optionalInt)
    .action(Notes.Notes.actions);

program
    .command('note-list')
    .alias('nl')
    .help('ilu'.italic + ' nl')
    .description('Manage Note Lists')
    .option('-a, --add', 'Add new list')
    .option('-d, --details <position>', 'Show details of the list at <position>', program.INT)
    .option('-e, --edit <position>', 'Edit the list at <position>', program.INT)
    .option('-s, --show', 'Show all lists')
    .option('-u, --use <position>', 'Use the list at <position>', program.INT)
    .option('-r, --remove [position]', 'Remove the list at [position], if no position, remove all the lists', optionalInt)
    .option('-c, --current', 'Show the details of the current list')
    .option('-A, --add-label', 'Add new label to the current list')
    .option('-E, --edit-label <position>', 'Edit the label at <position>', program.INT)
    .option('-R, --remove-label [position]', 'Remove the label at [position], if no position, remove all labels', optionalInt)
    .action(Notes.Lists.actions);

program
    .command('babel')
    .alias('b')
    .help('ilu'.italic + ' b ' + '<text...>'.blue)
    .description('Translate text')
    .option('-s, --source [source]', 'Source language', null, 'auto')
    .option('-t, --target [target]', 'Target language', null, Translate.osLang)
    .argument('<text...>', 'Text to translate', Translate.validate)
    .action(Translate.action);

program.parse(process.argv);
