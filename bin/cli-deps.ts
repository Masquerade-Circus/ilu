import Translate from '../translate/index.ts';

// Runtime imports are intentional here: command modules read HOME, configure sync,
// or mount TUI state. Loading them at CLI startup breaks sandboxed HOME tests and
// makes side effects run before Commander selects a command.
function lazyAction(load: any, select: any) {
  return async (...args: any[]) => select(await load())(...args);
}

function loadUiApp() {
  return import('../ui/app.tsx');
}

function createCliDeps(pkg: any) {
  return {
    pkg,
    Todos: {
      Tasks: {
        actions: lazyAction(() => import('../todos/index.ts'), (module: any) => module.Tasks.actions)
      },
      Lists: {
        actions: lazyAction(() => import('../todos/index.ts'), (module: any) => module.Lists.actions)
      }
    },
    Notes: {
      Notes: {
        actions: lazyAction(() => import('../notes/index.ts'), (module: any) => module.Notes.actions)
      },
      Lists: {
        actions: lazyAction(() => import('../notes/index.ts'), (module: any) => module.Lists.actions)
      }
    },
    Scrumban: {
      Board: {
        actions: lazyAction(() => import('../scrumban/index.ts'), (module: any) => module.Board.actions)
      },
      BoardLists: {
        actions: lazyAction(() => import('../scrumban/index.ts'), (module: any) => module.BoardLists.actions)
      }
    },
    Sync: {
      init: lazyAction(() => import('../sync/commands.ts'), (module: any) => module.init),
      status: lazyAction(() => import('../sync/commands.ts'), (module: any) => module.status),
      retry: lazyAction(() => import('../sync/commands.ts'), (module: any) => module.retry),
      enable: lazyAction(() => import('../sync/commands.ts'), (module: any) => module.enable),
      disable: lazyAction(() => import('../sync/commands.ts'), (module: any) => module.disable)
    },
    Translate,
    Clocks: {
      actions: lazyAction(() => import('../clocks/index.ts'), (module: any) => module.default.actions)
    },
    Tts: {
      action: lazyAction(() => import('../tts/index.ts'), (module: any) => module.action),
      voiceAction: lazyAction(() => import('../tts/index.ts'), (module: any) => module.voiceAction)
    },
    Ui: {
      action: lazyAction(loadUiApp, (module: any) => module.action)
    }
  };
}

export { createCliDeps, lazyAction };
export default { createCliDeps, lazyAction };
