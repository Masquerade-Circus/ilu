import * as __cjsImport3 from './adapters.ts';
const { createActionAdapter } = __cjsImport3;
function createTodoActionAdapter(Todos: any) {
  return async (...actionArgs: any[]) => {
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

function createNoteActionAdapter(Notes: any) {
  return async (...actionArgs: any[]) => {
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

function registerTodoCommands(program: any, deps: any) {
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
    .action(createTodoActionAdapter(deps.Todos));
}

function registerNoteCommands(program: any, deps: any) {
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
    .action(createNoteActionAdapter(deps.Notes));
}

export { registerNoteCommands, registerTodoCommands };
export default { registerNoteCommands, registerTodoCommands };
