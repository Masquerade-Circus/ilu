require('colors');

const {Option} = require('commander');

function configureProgram(program, deps) {
  const {
    pkg,
    updateNotifier,
    Todos,
    Notes,
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

  program
    .name('ilu')
    .version(pkg.version)
    .description('Cli tools for productivity');

  program
    .command('todo')
    .alias('t')
    .description('Manage Todo tasks for the current active list')
    .option('-a, --add', 'Add a new task')
    .option('-d, --details <position>', 'Show details  of the task at <position>', value => parseInt(value, 10))
    .option('-e, --edit <position>', 'Edit the task at <position>', value => parseInt(value, 10))
    .option('-s, --show', 'Show all tasks')
    .option('-c, --check', 'Check/uncheck finished tasks')
    .option('-r, --remove [position]', 'Remove the task at [position], if no position, remove all tasks', optionalInt)
    .action(createActionAdapter(Todos.Tasks.actions));

  program
    .command('todo-list')
    .alias('tl')
    .description('Manage Todo lists')
    .option('-a, --add', 'Add new list')
    .option('-d, --details <position>', 'Show details of the list at <position>', value => parseInt(value, 10))
    .option('-e, --edit <position>', 'Edit the list at <position>', value => parseInt(value, 10))
    .option('-s, --show', 'Show all lists')
    .option('-u, --use <position>', 'Use the list at <position>', value => parseInt(value, 10))
    .option('-r, --remove [position]', 'Remove the list at [position], if no position, remove all the lists', optionalInt)
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
    .option('-d, --details <position>', 'Show details of the note at <postion>', value => parseInt(value, 10))
    .option('-e, --edit <position>', 'Edit the note at <position>', value => parseInt(value, 10))
    .option('-s, --show', 'Show all notes')
    .option('-r, --remove [position]', 'Remove the note at [position], if no position, remove all the notes', optionalInt)
    .action(createActionAdapter(Notes.Notes.actions));

  program
    .command('note-list')
    .alias('nl')
    .description('Manage Note Lists')
    .option('-a, --add', 'Add new list')
    .option('-d, --details <position>', 'Show details of the list at <position>', value => parseInt(value, 10))
    .option('-e, --edit <position>', 'Edit the list at <position>', value => parseInt(value, 10))
    .option('-s, --show', 'Show all lists')
    .option('-u, --use <position>', 'Use the list at <position>', value => parseInt(value, 10))
    .option('-r, --remove [position]', 'Remove the list at [position], if no position, remove all the lists', optionalInt)
    .option('-c, --current', 'Show the details of the current list')
    .option('-A, --add-label', 'Add new label to the current list')
    .option('-E, --edit-label <position>', 'Edit the label at <position>', value => parseInt(value, 10))
    .option('-R, --remove-label [position]', 'Remove the label at [position], if no position, remove all labels', optionalInt)
    .action(createActionAdapter(Notes.Lists.actions));

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
