import Translate from '../translate/index.ts';
import type * as ClocksModule from '../clocks/index.ts';
import type * as NotesModule from '../notes/index.ts';
import type * as ScrumbanModule from '../scrumban/index.ts';
import type * as SyncCommandsModule from '../sync/commands.ts';
import type * as TodosModule from '../todos/index.ts';
import type * as TtsModule from '../tts/index.ts';
import type * as UiAppModule from '../ui/app.tsx';

type Action = (...args: never[]) => unknown;
type PackageInfo = Record<string, unknown>;

// Runtime imports are intentional here: command modules read HOME, configure sync,
// or mount TUI state. Loading them at CLI startup breaks sandboxed HOME tests and
// makes side effects run before Commander selects a command.
function lazyAction<TModule, TAction extends Action>(load: () => Promise<TModule>, select: (module: TModule) => TAction) {
  return async (...args: Parameters<TAction>) => select(await load())(...args);
}

function loadUiApp() {
  return import('../ui/app.tsx');
}

function createCliDeps(pkg: PackageInfo) {
  return {
    pkg,
    Todos: {
      Tasks: {
        actions: lazyAction(() => import('../todos/index.ts'), (module: typeof TodosModule) => module.Tasks.actions)
      },
      Lists: {
        actions: lazyAction(() => import('../todos/index.ts'), (module: typeof TodosModule) => module.Lists.actions)
      }
    },
    Notes: {
      Notes: {
        actions: lazyAction(() => import('../notes/index.ts'), (module: typeof NotesModule) => module.Notes.actions)
      },
      Lists: {
        actions: lazyAction(() => import('../notes/index.ts'), (module: typeof NotesModule) => module.Lists.actions)
      }
    },
    Scrumban: {
      Board: {
        actions: lazyAction(() => import('../scrumban/index.ts'), (module: typeof ScrumbanModule) => module.Board.actions)
      },
      BoardLists: {
        actions: lazyAction(() => import('../scrumban/index.ts'), (module: typeof ScrumbanModule) => module.BoardLists.actions)
      }
    },
    Sync: {
      init: lazyAction(() => import('../sync/commands.ts'), (module: typeof SyncCommandsModule) => module.init),
      status: lazyAction(() => import('../sync/commands.ts'), (module: typeof SyncCommandsModule) => module.status),
      retry: lazyAction(() => import('../sync/commands.ts'), (module: typeof SyncCommandsModule) => module.retry),
      enable: lazyAction(() => import('../sync/commands.ts'), (module: typeof SyncCommandsModule) => module.enable),
      disable: lazyAction(() => import('../sync/commands.ts'), (module: typeof SyncCommandsModule) => module.disable)
    },
    Translate,
    Clocks: {
      actions: lazyAction(() => import('../clocks/index.ts'), (module: typeof ClocksModule) => module.default.actions)
    },
    Tts: {
      action: lazyAction(() => import('../tts/index.ts'), (module: typeof TtsModule) => module.action),
      voiceAction: lazyAction(() => import('../tts/index.ts'), (module: typeof TtsModule) => module.voiceAction)
    },
    Ui: {
      action: lazyAction(loadUiApp, (module: typeof UiAppModule) => module.action)
    }
  };
}

export { createCliDeps, lazyAction };
export default { createCliDeps, lazyAction };
