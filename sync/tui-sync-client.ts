import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as __cjsImport33 from 'node:events';
const { EventEmitter } = __cjsImport33;
import * as __cjsImport34 from 'node:child_process';
const { fork: defaultFork } = __cjsImport34;
function createTuiSyncClient(options: any = {}) {
  const fork = options.fork || defaultFork;
  const runnerPath = options.runnerPath || path.join(path.dirname(fileURLToPath(import.meta.url)), 'tui-sync-runner.ts');
  const events = new EventEmitter();
  const pending = new Map();
  let nextId = 1;
  let disposed = false;
  let pendingMutations = 0;

  const child = fork(runnerPath, [], {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });

  function settle(id: any, settleFn: any, value: any) {
    const entry = pending.get(id);

    if (!entry) {
      return;
    }

    pending.delete(id);
    settleFn.call(entry, value);
  }

  function rejectAll(error: any) {
    for (const [id, entry] of pending.entries()) {
      pending.delete(id);
      entry.reject(error);
    }
  }

  function send(type: any, payload: any = {}) {
    if (disposed) {
      return Promise.resolve({status: 'disabled', hasPendingRemote: false});
    }

    const id = payload.id || `tui-sync-${nextId++}`;

    return new Promise((resolve: any, reject: any) => {
      pending.set(id, {resolve, reject});
      const message = {type, payload: {...payload, id}};

      try {
        if (!child.connected || child.send(message) === false) {
          pending.delete(id);
          reject(new Error('Sync runner is not available'));
        }
      } catch (error: any) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  if (typeof child.on === 'function') {
    child.on('message', (message: any) => {
      if (!message || typeof message !== 'object') {
        return;
      }

      const payload = message.payload || {};

      if (message.type === 'sync:event') {
        events.emit('event', payload);
        return;
      }

      if (message.type === 'sync:result' && typeof payload.id === 'string') {
        settle(payload.id, function settleResolve(this: any, value: any) { this.resolve(value.status || value); }, payload);
        return;
      }

      if (message.type === 'sync:error' && typeof payload.id === 'string') {
        settle(payload.id, function settleReject(this: any, value: any) { this.reject(new Error(value.message || 'Sync failed')); }, payload);
      }
    });

    child.on('exit', () => {
      disposed = true;
      rejectAll(new Error('Sync runner exited'));
    });

    child.on('error', (error: any) => {
      rejectAll(error);
    });
  }

  return {
    notifyLocalMutation(context: any) {
      pendingMutations += 1;
      return send('sync:mutation', {context})
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
    onEvent(listener: any) {
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
