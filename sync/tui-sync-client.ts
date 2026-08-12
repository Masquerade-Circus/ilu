import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as __cjsImport33 from 'node:events';
const { EventEmitter } = __cjsImport33;
import * as __cjsImport34 from 'node:child_process';
const { fork: defaultFork } = __cjsImport34;
type SyncStatus = Record<string, unknown>;
type SyncPayload = Record<string, unknown> & {id?: string; status?: SyncStatus; message?: string};
type PendingEntry = {
  resolve: (value: SyncStatus) => void;
  reject: (error: Error) => void;
};
type Fork = typeof defaultFork;
type TuiSyncClientOptions = {
  fork?: Fork;
  runnerPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};
type IpcMessage = {
  type?: unknown;
  payload?: unknown;
};
type EventListener = (payload: SyncPayload) => void;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asPayload(value: unknown): SyncPayload {
  return isObject(value) ? value : {};
}

function createTuiSyncClient(options: TuiSyncClientOptions = {}) {
  const fork = options.fork || defaultFork;
  const runnerPath = options.runnerPath || path.join(path.dirname(fileURLToPath(import.meta.url)), 'tui-sync-runner.ts');
  const events = new EventEmitter();
  const pending = new Map<string, PendingEntry>();
  let nextId = 1;
  let disposed = false;
  let pendingMutations = 0;

  const child = fork(runnerPath, [], {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });

  function settle(id: string, settleFn: (entry: PendingEntry, value: SyncPayload) => void, value: SyncPayload) {
    const entry = pending.get(id);

    if (!entry) {
      return;
    }

    pending.delete(id);
    settleFn(entry, value);
  }

  function rejectAll(error: Error) {
    for (const [id, entry] of pending.entries()) {
      pending.delete(id);
      entry.reject(error);
    }
  }

  function send(type: string, payload: SyncPayload = {}) {
    if (disposed) {
      return Promise.resolve({status: 'disabled', hasPendingRemote: false});
    }

    const id = payload.id || `tui-sync-${nextId++}`;

    return new Promise<SyncStatus>((resolve, reject) => {
      pending.set(id, {resolve, reject});
      const message = {type, payload: {...payload, id}};

      try {
        if (!child.connected || child.send(message) === false) {
          pending.delete(id);
          reject(new Error('Sync runner is not available'));
        }
      } catch (error: unknown) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  if (typeof child.on === 'function') {
    child.on('message', (message: IpcMessage) => {
      if (!isObject(message)) {
        return;
      }

      const payload = asPayload(message.payload);

      if (message.type === 'sync:event') {
        events.emit('event', payload);
        return;
      }

      if (message.type === 'sync:result' && typeof payload.id === 'string') {
        settle(payload.id, (entry, value) => entry.resolve(value.status || value), payload);
        return;
      }

      if (message.type === 'sync:error' && typeof payload.id === 'string') {
        settle(payload.id, (entry, value) => entry.reject(new Error(value.message || 'Sync failed')), payload);
      }
    });

    child.on('exit', () => {
      disposed = true;
      rejectAll(new Error('Sync runner exited'));
    });

    child.on('error', (error: Error) => {
      rejectAll(error);
    });
  }

  return {
    sync(context: unknown = {}) {
      const safeContext = isObject(context) ? context : {};
      pendingMutations += 1;
      return send('sync:mutation', {context: safeContext})
        .finally(() => {
          pendingMutations = Math.max(0, pendingMutations - 1);
        });
    },
    hasPendingWork() {
      return pendingMutations > 0;
    },
    flush() {
      return send('sync:flush');
    },
    status() {
      return send('sync:status');
    },
    shutdown() {
      return send('sync:shutdown').finally(() => {
        disposed = true;
      });
    },
    onEvent(listener: EventListener) {
      if (typeof listener !== 'function') {
        return () => {};
      }

      events.on('event', listener);
      return () => events.off('event', listener);
    },
    dispose() {
      disposed = true;
      rejectAll(new Error('Sync runner disposed'));
      if (child.connected && typeof child.disconnect === 'function') {
        child.disconnect();
      }
    }
  };
}

export { createTuiSyncClient };
export default {
  createTuiSyncClient
};
