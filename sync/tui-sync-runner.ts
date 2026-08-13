import { fileURLToPath } from 'node:url';
import defaultSyncIndex from './index.ts';
import * as __cjsImport35 from './tui-sync-status.ts';
const { isSyncSetupError, syncSetupStatus, syncStatusFromResult } = __cjsImport35;
const VALID_TYPES = new Set(['sync:mutation', 'sync:reconcile', 'sync:flush', 'sync:status', 'sync:shutdown']);
const INVALID_SYNC_MESSAGE = 'Invalid sync message';

type SyncContext = Record<string, unknown>;
type SyncStatus = Record<string, unknown>;
type SyncMessageType = 'sync:mutation' | 'sync:reconcile' | 'sync:flush' | 'sync:status' | 'sync:shutdown';
type IpcMessage = {type?: unknown; payload?: unknown};
type IpcPayload = {id?: unknown; context?: unknown; filePath?: unknown; snapshot?: unknown};
type SendMessage = {type: string; payload: Record<string, unknown>};
type Send = (message: SendMessage) => void;
type Waiter = {id: string; resolve: (status: SyncStatus) => void};
type SyncIndex = {
  sync: (context: SyncContext) => Promise<SyncStatus>;
  reconcileFile?: (input: {filePath: string; snapshot: string; context: SyncContext}) => Promise<SyncStatus>;
  getSyncStatus?: () => SyncStatus;
};
type TuiSyncRunnerOptions = {
  syncIndex?: SyncIndex;
  send?: Send;
  close?: () => void;
  onCloseError?: (error: unknown) => void;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidContext(value: unknown): value is SyncContext {
  return isObject(value);
}

function safeSend(send: Send, message: SendMessage) {
  try {
    send(message);
  } catch (_error: unknown) {
    void _error;
  }
}

function createTuiSyncRunner(options: TuiSyncRunnerOptions = {}) {
  const syncIndex = options.syncIndex || defaultSyncIndex;
  const send = typeof options.send === 'function'
    ? options.send
    : (message: SendMessage) => {
      if (typeof process.send === 'function') {
        process.send(message);
      }
    };
  const close = typeof options.close === 'function'
    ? options.close
    : () => {};
  const onCloseError = typeof options.onCloseError === 'function'
    ? options.onCloseError
    : () => {};

  let active = false;
  let pendingContext: SyncContext | null = null;
  let activeWaiters: Waiter[] = [];
  let pendingWaiters: Waiter[] = [];
  let backendIdleWaiters: Array<() => void> = [];
  let idleWaiters: Array<() => void> = [];
  let lastStatus: SyncStatus | null = null;
  let recoveryQueue: Promise<void> = Promise.resolve();
  let pendingRecoveries = 0;
  let deferredContext: SyncContext | null = null;
  let deferredWaiters: Waiter[] = [];

  function emit(type: string, payload: Record<string, unknown>) {
    safeSend(send, {type, payload});
  }

  function emitInvalid(payload: IpcPayload) {
    const id = isValidId(payload.id) ? payload.id : null;
    const body: Record<string, unknown> = {ok: false, message: INVALID_SYNC_MESSAGE};

    if (id !== null) {
      body.id = id;
    }

    emit('sync:error', body);
  }

  function finishWaiters(waiters: Waiter[], result: SyncStatus) {
    for (const waiter of waiters) {
      emit('sync:result', {id: waiter.id, ok: true, status: result});
      waiter.resolve(result);
    }
  }

  function failWaiters(waiters: Waiter[], error: unknown) {
    const message = isSyncSetupError(error) ? syncSetupStatus().message : 'Sync failed';

    for (const waiter of waiters) {
      emit('sync:error', {id: waiter.id, ok: false, message});
      waiter.resolve({status: 'failed', hasPendingRemote: true});
    }
  }

  function backendIsIdle() {
    return active === false && pendingContext === null;
  }

  function isIdle() {
    return backendIsIdle()
      && pendingRecoveries === 0
      && deferredContext === null
      && deferredWaiters.length === 0;
  }

  function notifyIdleWaiters() {
    if (backendIsIdle() && backendIdleWaiters.length > 0) {
      const ready = backendIdleWaiters;
      backendIdleWaiters = [];
      ready.forEach((resolve) => resolve());
    }

    if (isIdle() && idleWaiters.length > 0) {
      const ready = idleWaiters;
      idleWaiters = [];
      ready.forEach((resolve) => resolve());
    }
  }

  async function run(context: SyncContext, waiters: Waiter[], options: {emitStart?: boolean} = {}) {
    const shouldEmitStart = options.emitStart !== false;

    active = true;
    activeWaiters = waiters;

    if (shouldEmitStart) {
      emit('sync:event', {state: 'syncing', message: 'Syncing...', context});
    }

    try {
      const result = await syncIndex.sync(context);
      lastStatus = result;
      const hasQueuedMutation = pendingContext !== null;

      if (!hasQueuedMutation) {
        const event = syncStatusFromResult(result);
        emit('sync:event', {...event, context});
      }

      finishWaiters(activeWaiters, result);
    } catch (error: unknown) {
      const event = isSyncSetupError(error) ? syncSetupStatus() : {state: 'failed', message: 'Sync failed'};
      const failedStatus = {status: 'failed', hasPendingRemote: true};
      const queuedWaiters = pendingWaiters;

      lastStatus = failedStatus;
      pendingContext = null;
      pendingWaiters = [];
      emit('sync:event', {...event, context});
      failWaiters(activeWaiters, error);
      failWaiters(queuedWaiters, error);
    } finally {
      activeWaiters = [];
      active = false;
    }

    if (pendingContext !== null) {
      const nextContext = pendingContext;
      const nextWaiters = pendingWaiters;
      pendingContext = null;
      pendingWaiters = [];
      await run(nextContext, nextWaiters, {emitStart: false});
      return;
    }

    notifyIdleWaiters();
  }

  function waitForBackendIdle(): Promise<void> {
    if (backendIsIdle()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => backendIdleWaiters.push(resolve));
  }

  function waitForIdle(): Promise<void> {
    if (isIdle()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  async function readStatus() {
    if (syncIndex && typeof syncIndex.getSyncStatus === 'function') {
      return await syncIndex.getSyncStatus();
    }

    return lastStatus || {status: 'disabled', hasPendingRemote: false};
  }

  function enqueueMutation(id: string, context: SyncContext) {
    return new Promise<SyncStatus>((resolve) => {
      const waiter = {id, resolve};

      if (pendingRecoveries > 0) {
        deferredContext = context;
        deferredWaiters.push(waiter);
        return;
      }

      if (active) {
        pendingContext = context;
        pendingWaiters.push(waiter);
        return;
      }

      run(context, [waiter]);
    });
  }

  function enqueueRecovery(input: {id: string; filePath: string; snapshot: string; context: SyncContext}): Promise<void> {
    pendingRecoveries += 1;
    const operation = recoveryQueue.then(async () => {
      await waitForBackendIdle();
      if (typeof syncIndex.reconcileFile !== 'function') {
        throw new Error('Sync recovery is unavailable');
      }
      const status = await syncIndex.reconcileFile({
        filePath: input.filePath,
        snapshot: input.snapshot,
        context: input.context
      });
      lastStatus = status;
      emit('sync:result', {id: input.id, ok: true, status});
    }).catch(() => {
      emit('sync:error', {id: input.id, ok: false, message: 'Sync failed'});
    }).finally(() => {
      pendingRecoveries -= 1;
      if (pendingRecoveries === 0 && deferredContext !== null) {
        const context = deferredContext;
        const waiters = deferredWaiters;
        deferredContext = null;
        deferredWaiters = [];
        void run(context, waiters);
      }
      notifyIdleWaiters();
    });
    recoveryQueue = operation;
    return operation;
  }

  async function flush(id: string) {
    await waitForIdle();
    const status = lastStatus || (await readStatus());
    emit('sync:result', {id, ok: true, status});
    return status;
  }

  async function shutdown(id: string) {
    await flush(id);
    try {
      close();
    } catch (error: unknown) {
      onCloseError(error);
    }
  }

  async function handleMessage(message: unknown) {
    const typedMessage: IpcMessage = isObject(message) ? message : {};
    const payload: IpcPayload = isObject(typedMessage.payload) ? typedMessage.payload : {};
    const type = typedMessage.type;

    if (typeof type !== 'string' || !VALID_TYPES.has(type) || !isValidId(payload.id)) {
      emitInvalid(payload);
      return;
    }

    const messageType = type as SyncMessageType;

    if (messageType === 'sync:mutation') {
      if (!isValidContext(payload.context)) {
        emitInvalid(payload);
        return;
      }

      await enqueueMutation(payload.id, payload.context);
      return;
    }

    if (messageType === 'sync:reconcile') {
      if (
        typeof payload.filePath !== 'string'
        || payload.filePath.trim().length === 0
        || typeof payload.snapshot !== 'string'
        || !isValidContext(payload.context)
        || typeof syncIndex.reconcileFile !== 'function'
      ) {
        emitInvalid(payload);
        return;
      }

      await enqueueRecovery({
        id: payload.id,
        filePath: payload.filePath,
        snapshot: payload.snapshot,
        context: payload.context
      });
      return;
    }

    if (messageType === 'sync:flush') {
      await flush(payload.id);
      return;
    }

    if (messageType === 'sync:status') {
      try {
        const status = await readStatus();
        emit('sync:result', {id: payload.id, ok: true, status});
      } catch (error: unknown) {
        void error;
        emit('sync:error', {id: payload.id, ok: false, message: 'Sync failed'});
      }
      return;
    }

    if (messageType === 'sync:shutdown') {
      await shutdown(payload.id);
    }
  }

  return {handleMessage};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const runner = createTuiSyncRunner({
    close() {
      process.exit(0);
    }
  });
  process.on('message', (message: unknown) => {
    runner.handleMessage(message).catch(() => {
      if (typeof process.send === 'function') {
        process.send({type: 'sync:error', payload: {ok: false, message: 'Sync failed'}});
      }
    });
  });
}

export { createTuiSyncRunner };
export default {
  createTuiSyncRunner
};
