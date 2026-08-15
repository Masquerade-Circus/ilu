import 'colors';
import * as __cjsImport6 from './commands/board.ts';
import * as __cjsImport7 from './commands/todo-note.ts';
import * as __cjsImport8 from './commands/sync.ts';
import * as __cjsImport9 from './commands/utilities.ts';
import type { Command } from 'commander';
import type { ActionHandler } from './commands/adapters.ts';

const { registerBoardCommands, wrapBoardParseAliases } = __cjsImport6;
const { registerNoteCommands, registerTodoCommands } = __cjsImport7;
const { registerSyncCommands } = __cjsImport8;
const { registerUiCommand, registerUtilityCommands } = __cjsImport9;

type ConfigureDeps = {
  pkg: Record<string, unknown>;
  updateNotifier?: (input: { pkg: Record<string, unknown> }) => { notify: () => unknown };
  Todos: { Lists: { actions: ActionHandler }; Tasks: { actions: ActionHandler } };
  Notes: { Lists: { actions: ActionHandler }; Notes: { actions: ActionHandler } };
  Scrumban?: { Board: { actions: ActionHandler }; BoardLists: { actions: ActionHandler } };
  Sync?: {
    startup: () => unknown | Promise<unknown>;
  } & Record<'init' | 'status' | 'retry' | 'enable' | 'disable', ActionHandler>;
  Translate: { osLang: string; validate: (text: unknown) => unknown; action: ActionHandler };
  Clocks: { actions: ActionHandler };
  Tts?: { action: ActionHandler; voiceAction: ActionHandler };
  Ui?: { action: ActionHandler };
};

function configureProgram(program: Command, deps: ConfigureDeps) {
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
      startup: async () => {},
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
    },
    Ui = {
      action: async () => {}
    }
  } = deps;

  if (typeof updateNotifier === 'function') {
    updateNotifier({ pkg }).notify();
  }

  wrapBoardParseAliases(program);

  const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  const afterStartupSync = (action: ActionHandler): ActionHandler => async (...args) => {
    await Sync.startup();
    return action(...args);
  };
  const syncedTodos = {
    Tasks: {actions: afterStartupSync(Todos.Tasks.actions)},
    Lists: {actions: afterStartupSync(Todos.Lists.actions)}
  };
  const syncedNotes = {
    Notes: {actions: afterStartupSync(Notes.Notes.actions)},
    Lists: {actions: afterStartupSync(Notes.Lists.actions)}
  };
  const syncedScrumban = {
    Board: {actions: afterStartupSync(Scrumban.Board.actions)},
    BoardLists: {actions: afterStartupSync(Scrumban.BoardLists.actions)}
  };

  program
    .name('ilu')
    .version(version)
    .description('Cli tools for productivity');

  registerUiCommand(program, {Ui});
  registerTodoCommands(program, {Todos: syncedTodos});
  registerNoteCommands(program, {Notes: syncedNotes});
  registerBoardCommands(program, {Scrumban: syncedScrumban});
  registerSyncCommands(program, {Sync});
  registerUtilityCommands(program, {
    Translate,
    Clocks: {actions: afterStartupSync(Clocks.actions)},
    Tts
  });

  return program;
}

export { configureProgram };
export default configureProgram;
