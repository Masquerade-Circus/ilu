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

type PreparedTuiSyncRunner = {
  state: AppRuntimeState["syncStatus"];
  activate: () => () => void | Promise<unknown>;
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
        && configRecord.autoPull !== false
        && typeof configRecord.remoteUrl === "string"
        && configRecord.remoteUrl.trim().length > 0
    );
  } catch (_error: unknown) {
    void _error;
    return false;
  }
}

function cleanupTuiSyncClient(client: TuiSyncRunnerClient): () => void | Promise<unknown> {
  return () => {
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

function syncStateFromResult(result: unknown): AppRuntimeState["syncStatus"] {
  const record = result && typeof result === "object" ? result as Record<string, unknown> : null;
  if (record?.status === "healthy" && record.hasPendingRemote !== true) {
    return "synced";
  }
  if (record?.status === "pending_remote") {
    return "pending";
  }
  if (record?.status === "misconfigured") {
    return "setup";
  }
  return "failed";
}

async function prepareTuiSyncRunner(deps: AppSyncLifecycleDeps): Promise<PreparedTuiSyncRunner | null> {
  const { createTuiSyncClient, notifySyncHook, syncIndex } = deps;

  if (typeof notifySyncHook.configureSyncRunner !== "function" || !shouldUseTuiSyncRunner(syncIndex)) {
    return null;
  }

  const client = createTuiSyncClient();
  const cleanupClient = cleanupTuiSyncClient(client);
  let result: unknown;

  try {
    result = await client.sync({reason: "startup"});
  } catch (error: unknown) {
    await cleanupClient();
    throw error;
  }

  const record = result && typeof result === "object" ? result as Record<string, unknown> : null;
  if (record?.status === "conflict" || record?.lastErrorKind === "conflict") {
    await cleanupClient();
    throw new Error("Sync conflict must be resolved before opening the workspace");
  }

  return {
    state: syncStateFromResult(result),
    activate() {
      const restoreRunner = notifySyncHook.configureSyncRunner!(client);
      return () => {
        restoreRunner();
        return cleanupClient();
      };
    }
  };
}

export function createAppSyncLifecycle(deps: AppSyncLifecycleDeps): {
  prepareTuiSyncRunner: () => Promise<PreparedTuiSyncRunner | null>;
  enableSyncStatusUpdates: (session: TerminalSession, state: AppRuntimeState, cleanupSyncRunner?: () => void | Promise<unknown>) => TerminalSession;
} {
  return {
    prepareTuiSyncRunner: () => prepareTuiSyncRunner(deps),
    enableSyncStatusUpdates: (session, state, cleanupSyncRunner) => enableSyncStatusUpdates(deps.notifySyncHook, session, state, cleanupSyncRunner)
  };
}
