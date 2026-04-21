require('colors');

const {Option} = require('commander');

const boardManagementAliases = new Map([
  ['-ab', '--add-board'],
  ['-eb', '--edit-board'],
  ['-rb', '--remove-board']
]);

function configureProgram(program, deps) {
  const {
    pkg,
    updateNotifier,
    Todos,
    Notes,
    Scrumban = {
      Board: {actions: async () => {}},
      BoardLists: {actions: async () => {}}
    },
    Translate,
    Clocks
  } = deps;

  if (typeof updateNotifier === 'function') {
    updateNotifier({ pkg }).notify();
  }

  function optionalInt(opt) {
    return typeof opt === 'boolean' ? opt : parseInt(opt, 10);
  }

  function createActionAdapter(handler, mapArgs = () => []) {
    return async (...actionArgs) => {
      const command = actionArgs[actionArgs.length - 1];
      const positionalArgs = actionArgs.slice(0, -2);
      const opts = command.opts();

      return handler(mapArgs(positionalArgs), opts);
    };
  }

  function normalizeArgv(argv) {
    if (!Array.isArray(argv)) {
      return argv;
    }

    return argv.map(value => boardManagementAliases.get(value) || value);
  }

  function wrapParseMethod(methodName) {
    if (typeof program[methodName] !== 'function') {
      return;
    }

    const original = program[methodName].bind(program);

    program[methodName] = function patchedParse(argv, ...rest) {
      return original(normalizeArgv(argv), ...rest);
    };
  }

  function registerBoardManagementOption(command, shortFlag, longFlag, description) {
    command.option(longFlag, description);

    if (Array.isArray(command.options) && command.options.length > 0) {
      command.options[command.options.length - 1].flags = `${shortFlag}, ${longFlag}`;
    }

    return command;
  }

  wrapParseMethod('parse');
  wrapParseMethod('parseAsync');

  program
    .name('ilu')
    .version(pkg.version)
    .description('Cli tools for productivity');

  program
    .command('todo')
    .alias('t')
    .description('Manage Todo tasks for the current active list')
    .option('-a, --add', 'Add a new task')
    .option('-d, --details', 'Show details of a task via interactive selection')
    .option('-e, --edit', 'Edit the selected task interactively')
    .option('-s, --show', 'Show all tasks')
    .option('-c, --check', 'Check/uncheck finished tasks')
    .option('-r, --remove', 'Remove selected tasks interactively')
    .action(createActionAdapter(Todos.Tasks.actions));

  program
    .command('todo-list')
    .alias('tl')
    .description('Manage Todo lists')
    .option('-a, --add', 'Add new list')
    .option('-d, --details', 'Show details of the selected list interactively')
    .option('-e, --edit', 'Edit the selected list interactively')
    .option('-s, --show', 'Show all lists')
    .option('-u, --use', 'Use the selected list interactively')
    .option('-r, --remove', 'Remove selected lists interactively')
    .option('-c, --current', 'Show the details of the current list')
    .option('-A, --add-label', 'Add new label to the current list')
    .option('-E, --edit-label <position>', 'Edit the label at <position>', value => parseInt(value, 10))
    .option('-R, --remove-label [position]', 'Remove the label at [position], if no position, remove all labels', optionalInt)
    .action(createActionAdapter(Todos.Lists.actions));

  program
    .command('note')
    .alias('n')
    .description('Manage Notes for the current active list')
    .option('-a, --add', 'Add a new note')
    .option('-d, --details', 'Show details of a note via interactive selection')
    .option('-e, --edit', 'Edit the selected note interactively')
    .option('-s, --show', 'Show all notes')
    .option('-r, --remove', 'Remove selected notes interactively')
    .action(createActionAdapter(Notes.Notes.actions));

  program
    .command('note-list')
    .alias('nl')
    .description('Manage Note Lists')
    .option('-a, --add', 'Add new list')
    .option('-d, --details', 'Show details of the selected list interactively')
    .option('-e, --edit', 'Edit the selected list interactively')
    .option('-s, --show', 'Show all lists')
    .option('-u, --use', 'Use the selected list interactively')
    .option('-r, --remove', 'Remove selected lists interactively')
    .option('-c, --current', 'Show the details of the current list')
    .option('-A, --add-label', 'Add new label to the current list')
    .option('-E, --edit-label <position>', 'Edit the label at <position>', value => parseInt(value, 10))
    .option('-R, --remove-label [position]', 'Remove the label at [position], if no position, remove all labels', optionalInt)
    .action(createActionAdapter(Notes.Lists.actions));

  const boardCommand = program
    .command('board')
    .alias('bd')
    .description('Manage the current board and board collection')
    .option('-s, --show', 'Show the current board as an adaptive ASCII view')
    .option('-a, --add', 'Add a new card to the default column')
    .option('-d, --details', 'Show details of the selected card interactively')
    .option('-e, --edit', 'Edit the selected card interactively')
    .option('-m, --move', 'Move the selected card interactively')
    .option('-p, --priority', 'Reorder cards within a selected column interactively')
    .option('-r, --remove', 'Remove selected cards interactively')
    .option('-c, --columns', 'Manage columns for the current board')
    .option('-l, --list-boards', 'Show all boards')
    .option('-u, --use-board', 'Use the selected board interactively');

  registerBoardManagementOption(boardCommand, '-ab', '--add-board', 'Add new board');
  registerBoardManagementOption(boardCommand, '-eb', '--edit-board', 'Edit the selected board interactively');
  registerBoardManagementOption(boardCommand, '-rb', '--remove-board', 'Remove selected boards interactively');

  boardCommand
    .action(createActionAdapter(Scrumban.Board.actions));

  program
    .command('babel')
    .alias('b')
    .description('Translate text')
    .addOption(new Option('-s, --source [source]', 'Source language').default('auto'))
    .addOption(new Option('-t, --target [target]', 'Target language').default(Translate.osLang))
    .argument('<text...>', 'Text to translate')
    .action(createActionAdapter(
      Translate.action,
      ([text]) => ({text: Translate.validate(text)})
    ));

  program
    .command('clock')
    .alias('c')
    .description('Manage saved clocks')
    .option('-a, --add', 'Add a new clock')
    .option('-s, --show', 'Show all saved clocks')
    .option('-r, --remove [position]', 'Remove the clock at [position], if no position, remove all clocks', optionalInt)
    .action(createActionAdapter(Clocks.actions));

  return program;
}

module.exports = configureProgram;
