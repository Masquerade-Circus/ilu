require('colors');

const {registerBoardCommands, wrapBoardParseAliases} = require('./commands/board');
const {registerNoteCommands, registerTodoCommands} = require('./commands/todo-note');
const {registerSyncCommands} = require('./commands/sync');
const {registerUiCommand, registerUtilityCommands} = require('./commands/utilities');

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

module.exports = configureProgram;
