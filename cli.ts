const { Command } = require('commander');
const pkg = require('./package.json');
// TODO use https://github.com/sindresorhus/terminal-link to parse content and convert links

const Translate = require('./translate');
const configureProgram = require('./bin/configure-cli');

function lazyAction(load: any, select: any) {
  return async (...args: any[]) => select(load())(...args);
}

function loadUiApp() {
  return require('./ui/app.tsx');
}

const Todos = {
  Tasks: {
    actions: lazyAction(() => require('./todos'), (module: any) => module.Tasks.actions)
  },
  Lists: {
    actions: lazyAction(() => require('./todos'), (module: any) => module.Lists.actions)
  }
};

const Notes = {
  Notes: {
    actions: lazyAction(() => require('./notes'), (module: any) => module.Notes.actions)
  },
  Lists: {
    actions: lazyAction(() => require('./notes'), (module: any) => module.Lists.actions)
  }
};

const Scrumban = {
  Board: {
    actions: lazyAction(() => require('./scrumban'), (module: any) => module.Board.actions)
  },
  BoardLists: {
    actions: lazyAction(() => require('./scrumban'), (module: any) => module.BoardLists.actions)
  }
};

const Sync = {
  init: lazyAction(() => require('./sync/commands'), (module: any) => module.init),
  status: lazyAction(() => require('./sync/commands'), (module: any) => module.status),
  retry: lazyAction(() => require('./sync/commands'), (module: any) => module.retry),
  enable: lazyAction(() => require('./sync/commands'), (module: any) => module.enable),
  disable: lazyAction(() => require('./sync/commands'), (module: any) => module.disable)
};

const Clocks = {
  actions: lazyAction(() => require('./clocks'), (module: any) => module.actions)
};

const Tts = {
  action: lazyAction(() => require('./tts'), (module: any) => module.action),
  voiceAction: lazyAction(() => require('./tts'), (module: any) => module.voiceAction)
};

const Ui = {
  action: lazyAction(loadUiApp, (module: any) => module.action)
};

const program = new Command();

configureProgram(program, {
  pkg,
  Todos,
  Notes,
  Scrumban,
  Sync,
  Translate,
  Clocks,
  Tts,
  Ui
});

program.parse(process.argv);
