function lazyAction(load: any, select: any) {
  return async (...args: any[]) => select(load())(...args);
}

function loadUiApp() {
  return require('../ui/app.tsx');
}

function createCliDeps(pkg: any) {
  return {
    pkg,
    Todos: {
      Tasks: {
        actions: lazyAction(() => require('../todos'), (module: any) => module.Tasks.actions)
      },
      Lists: {
        actions: lazyAction(() => require('../todos'), (module: any) => module.Lists.actions)
      }
    },
    Notes: {
      Notes: {
        actions: lazyAction(() => require('../notes'), (module: any) => module.Notes.actions)
      },
      Lists: {
        actions: lazyAction(() => require('../notes'), (module: any) => module.Lists.actions)
      }
    },
    Scrumban: {
      Board: {
        actions: lazyAction(() => require('../scrumban'), (module: any) => module.Board.actions)
      },
      BoardLists: {
        actions: lazyAction(() => require('../scrumban'), (module: any) => module.BoardLists.actions)
      }
    },
    Sync: {
      init: lazyAction(() => require('../sync/commands'), (module: any) => module.init),
      status: lazyAction(() => require('../sync/commands'), (module: any) => module.status),
      retry: lazyAction(() => require('../sync/commands'), (module: any) => module.retry),
      enable: lazyAction(() => require('../sync/commands'), (module: any) => module.enable),
      disable: lazyAction(() => require('../sync/commands'), (module: any) => module.disable)
    },
    Translate: require('../translate'),
    Clocks: {
      actions: lazyAction(() => require('../clocks'), (module: any) => module.actions)
    },
    Tts: {
      action: lazyAction(() => require('../tts'), (module: any) => module.action),
      voiceAction: lazyAction(() => require('../tts'), (module: any) => module.voiceAction)
    },
    Ui: {
      action: lazyAction(loadUiApp, (module: any) => module.action)
    }
  };
}

module.exports = { createCliDeps, lazyAction };
