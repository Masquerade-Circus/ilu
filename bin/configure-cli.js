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
    Sync = {
      init: async () => {},
      status: async () => {},
      retry: async () => {},
      enable: async () => {},
      disable: async () => {}
    },
    Translate,
    Clocks,
    Tts = {
      action: async () => {},
      voiceAction: async () => {}
    }
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

  function createTodoActionAdapter() {
    return async (...actionArgs) => {
      const command = actionArgs[actionArgs.length - 1];
      const opts = command.opts();

      if (opts.lists) {
        return Todos.Lists.actions([], {show: true});
      }

      if (opts.useList) {
        return Todos.Lists.actions([], {use: true});
      }

      if (opts.addList) {
        return Todos.Lists.actions([], {add: true});
      }

      if (opts.editList) {
        return Todos.Lists.actions([], {edit: true});
      }

      if (opts.removeList) {
        return Todos.Lists.actions([], {remove: true});
      }

      return Todos.Tasks.actions([], opts);
    };
  }

  function createNoteActionAdapter() {
    return async (...actionArgs) => {
      const command = actionArgs[actionArgs.length - 1];
      const opts = command.opts();

      if (opts.lists) {
        return Notes.Lists.actions([], {show: true});
      }

      if (opts.useList) {
        return Notes.Lists.actions([], {use: true});
      }

      if (opts.addList) {
        return Notes.Lists.actions([], {add: true});
      }

      if (opts.editList) {
        return Notes.Lists.actions([], {edit: true});
      }

      if (opts.removeList) {
        return Notes.Lists.actions([], {remove: true});
      }

      return Notes.Notes.actions([], opts);
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
    .option('--lists', 'Show all todo lists')
    .option('--use-list', 'Use the selected todo list interactively')
    .option('--add-list', 'Add a new todo list')
    .option('--edit-list', 'Edit the selected todo list interactively')
    .option('--remove-list', 'Remove selected todo lists interactively')
    .action(createTodoActionAdapter());

  program
    .command('note')
    .alias('n')
    .description('Manage Notes and note lists for the current active list')
    .option('-a, --add', 'Add a new note')
    .option('-d, --details', 'Show details of a note via interactive selection')
    .option('-e, --edit', 'Edit the selected note interactively')
    .option('-s, --show', 'Show all notes')
    .option('-r, --remove', 'Remove selected notes interactively')
    .option('--lists', 'Show all note lists')
    .option('--use-list', 'Use the selected note list interactively')
    .option('--add-list', 'Add a new note list')
    .option('--edit-list', 'Edit the selected note list interactively')
    .option('--remove-list', 'Remove selected note lists interactively')
    .action(createNoteActionAdapter());

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

  const syncCommand = program
    .command('sync')
    .description('Manage personal data sync');

  syncCommand
    .command('init')
    .description('Initialize sync against a remote repository')
    .requiredOption('--remote <url>', 'Remote repository URL')
    .option('--branch <name>', 'Remote branch', 'main')
    .action(createActionAdapter(Sync.init));

  syncCommand
    .command('status')
    .description('Show sync status')
    .action(createActionAdapter(Sync.status));

  syncCommand
    .command('retry')
    .description('Retry pending sync work')
    .action(createActionAdapter(Sync.retry));

  syncCommand
    .command('enable')
    .description('Enable sync')
    .action(createActionAdapter(Sync.enable));

  syncCommand
    .command('disable')
    .description('Disable sync')
    .action(createActionAdapter(Sync.disable));

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

  const ttsCommand = program
    .command('tts')
    .description('Convert a text or markdown file to audio')
    .argument('<inputFile>', 'Input .txt or .md file')
    .argument('<outputFile>', 'Output audio file path');

  ttsCommand
    .command('voice')
    .description('Select or persist the default TTS voice')
    .action(createActionAdapter(Tts.voiceAction, () => ({})));

  ttsCommand.action(createActionAdapter(
    Tts.action,
    ([inputFile, outputFile]) => ({inputFile, outputFile})
  ));

  return program;
}

module.exports = configureProgram;
