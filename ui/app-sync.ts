import type { TerminalSession } from "@valyrianjs/terminal";
import type { AppRuntimeState, NotifySyncHook, SyncStatusEvent, TuiSyncRunnerClient } from "./app-runtime";
import { normalizeSyncStatus } from "./app-runtime";

type AppSyncLifecycleDeps = {
  notifySyncHook: NotifySyncHook;
  createTuiSyncClient: (options?: Record<string, unknown>) => TuiSyncRunnerClient;
  syncIndex: {
    getSyncConfig?: () => unknown;
  } | null;
};

function applySyncStatus(state: AppRuntimeState, event: SyncStatusEvent): boolean {
  const nextStatus = normalizeSyncStatus(event.state);

  if (state.syncStatus === nextStatus) {
    return false;
  }

  state.syncStatus = nextStatus;
  return true;
}

function subscribeToSyncStatus(notifySyncHook: NotifySyncHook, state: AppRuntimeState, getSession: () => TerminalSession | null): () => void {
  if (typeof notifySyncHook.onSyncStatus !== "function") {
    return () => {};
  }

  return notifySyncHook.onSyncStatus((event: SyncStatusEvent) => {
    const changed = applySyncStatus(state, event);
    const session = getSession();

    if (changed && session && typeof session.update === "function") {
      session.update();
    }
  });
}

function flushPendingSync(notifySyncHook: NotifySyncHook): false | Promise<unknown> {
  if (typeof notifySyncHook.flushPending !== "function") {
    return false;
  }

  try {
    const result = notifySyncHook.flushPending();

    if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
      return Promise.resolve(result).catch(() => false);
    }
  } catch (_error: unknown) {
    void _error;
    return false;
  }

  return false;
}

function enableSyncStatusUpdates(notifySyncHook: NotifySyncHook, session: TerminalSession, state: AppRuntimeState, cleanupSyncRunner?: () => void | Promise<unknown>): TerminalSession {
  let destroyRequested = false;
  let unsubscribed = false;
  const unsubscribe = subscribeToSyncStatus(notifySyncHook, state, () => session);
  const destroySession = session.destroy.bind(session);

  function unsubscribeStatus(): void {
    if (!unsubscribed) {
      unsubscribed = true;
      unsubscribe();
    }
  }

  function finishDestroy(): void | Promise<void> {
    if (typeof cleanupSyncRunner !== "function") {
      unsubscribeStatus();
      destroySession();
      return;
    }

    let cleanupResult: void | Promise<unknown>;

    try {
      cleanupResult = cleanupSyncRunner();
    } catch (_error: unknown) {
      void _error;
      cleanupResult = void 0;
    }

    if (cleanupResult && typeof cleanupResult === "object" && "then" in cleanupResult && typeof cleanupResult.then === "function") {
      return Promise.resolve(cleanupResult)
        .then(() => undefined)
        .catch(() => undefined)
        .finally(() => {
          unsubscribeStatus();
          destroySession();
        });
    }

    unsubscribeStatus();
    destroySession();
  }

  session.destroy = () => {
    if (destroyRequested) {
      return;
    }

    destroyRequested = true;
    const pendingFlush = flushPendingSync(notifySyncHook);

    if (pendingFlush && typeof pendingFlush.then === "function") {
      return pendingFlush.finally(finishDestroy);
    }

    return finishDestroy();
  };

  return session;
}

function shouldUseTuiSyncRunner(syncIndex: AppSyncLifecycleDeps["syncIndex"]): boolean {
  try {
    const config = syncIndex && typeof syncIndex.getSyncConfig === "function" ? syncIndex.getSyncConfig() : null;
    const configRecord = config && typeof config === "object" ? config as Record<string, unknown> : null;
    return Boolean(
      configRecord
        && configRecord.enabled === true
        && configRecord.autoSync !== false
        && typeof configRecord.remoteUrl === "string"
        && configRecord.remoteUrl.trim().length > 0
    );
  } catch (_error: unknown) {
    void _error;
    return false;
  }
}

function createTuiSyncRunnerCleanup(deps: AppSyncLifecycleDeps): () => void | Promise<unknown> {
  const { createTuiSyncClient, notifySyncHook, syncIndex } = deps;

  if (typeof notifySyncHook.configureSyncRunner !== "function" || !shouldUseTuiSyncRunner(syncIndex)) {
    return () => {};
  }

  const client = createTuiSyncClient();
  const restoreRunner = notifySyncHook.configureSyncRunner(client);

  return () => {
    restoreRunner();

    if (typeof client.shutdown === "function") {
      return client.shutdown().catch(() => {
        if (typeof client.dispose === "function") {
          client.dispose();
        }
      });
    }

    if (typeof client.dispose === "function") {
      client.dispose();
    }
  };
}

export function createAppSyncLifecycle(deps: AppSyncLifecycleDeps): {
  createTuiSyncRunnerCleanup: () => () => void | Promise<unknown>;
  enableSyncStatusUpdates: (session: TerminalSession, state: AppRuntimeState, cleanupSyncRunner?: () => void | Promise<unknown>) => TerminalSession;
} {
  return {
    createTuiSyncRunnerCleanup: () => createTuiSyncRunnerCleanup(deps),
    enableSyncStatusUpdates: (session, state, cleanupSyncRunner) => enableSyncStatusUpdates(deps.notifySyncHook, session, state, cleanupSyncRunner)
  };
}
