import 'colors';
import * as __cjsImport6 from './commands/board.ts';
import * as __cjsImport7 from './commands/todo-note.ts';
import * as __cjsImport8 from './commands/sync.ts';
import * as __cjsImport9 from './commands/utilities.ts';

const { registerBoardCommands, wrapBoardParseAliases } = __cjsImport6;
const { registerNoteCommands, registerTodoCommands } = __cjsImport7;
const { registerSyncCommands } = __cjsImport8;
const { registerUiCommand, registerUtilityCommands } = __cjsImport9;
function configureProgram(program: any, deps: any) {
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

  program
    .name('ilu')
    .version(pkg.version)
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
