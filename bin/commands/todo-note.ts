import type { Command } from 'commander';
import type { ActionHandler } from './adapters.ts';

type CommandOptions = Record<string, unknown>;
type CommandLike = { opts: () => CommandOptions };
type ActionGroup = { actions: ActionHandler };
type TodoDeps = { Todos: { Lists: ActionGroup; Tasks: ActionGroup } };
type NoteDeps = { Notes: { Lists: ActionGroup; Notes: ActionGroup } };

function createTodoActionAdapter(Todos: TodoDeps['Todos']) {
  return async (...actionArgs: unknown[]): Promise<void> => {
    const command = actionArgs[actionArgs.length - 1] as CommandLike;
    const opts = command.opts();

    if (opts.lists) {
      await Todos.Lists.actions([], {show: true});
      return;
    }

    if (opts.useList) {
      await Todos.Lists.actions([], {use: true});
      return;
    }

    if (opts.addList) {
      await Todos.Lists.actions([], {add: true});
      return;
    }

    if (opts.editList) {
      await Todos.Lists.actions([], {edit: true});
      return;
    }

    if (opts.removeList) {
      await Todos.Lists.actions([], {remove: true});
      return;
    }

    await Todos.Tasks.actions([], opts);
  };
}

function createNoteActionAdapter(Notes: NoteDeps['Notes']) {
  return async (...actionArgs: unknown[]): Promise<void> => {
    const command = actionArgs[actionArgs.length - 1] as CommandLike;
    const opts = command.opts();

    if (opts.lists) {
      await Notes.Lists.actions([], {show: true});
      return;
    }

    if (opts.useList) {
      await Notes.Lists.actions([], {use: true});
      return;
    }

    if (opts.addList) {
      await Notes.Lists.actions([], {add: true});
      return;
    }

    if (opts.editList) {
      await Notes.Lists.actions([], {edit: true});
      return;
    }

    if (opts.removeList) {
      await Notes.Lists.actions([], {remove: true});
      return;
    }

    await Notes.Notes.actions([], opts);
  };
}

function registerTodoCommands(program: Command, deps: TodoDeps) {
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

function registerNoteCommands(program: Command, deps: NoteDeps) {
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
