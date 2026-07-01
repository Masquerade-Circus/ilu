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
  Sync?: Record<'init' | 'status' | 'retry' | 'enable' | 'disable', ActionHandler>;
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

  program
    .name('ilu')
    .version(version)
    .description('Cli tools for productivity');

  registerUiCommand(program, {Ui});
  registerTodoCommands(program, {Todos});
  registerNoteCommands(program, {Notes});
  registerBoardCommands(program, {Scrumban});
  registerSyncCommands(program, {Sync});
  registerUtilityCommands(program, {Translate, Clocks, Tts});

  return program;
}

export { configureProgram };
export default configureProgram;
