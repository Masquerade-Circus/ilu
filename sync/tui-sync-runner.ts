import { fileURLToPath } from 'node:url';
import defaultSyncIndex from './index.ts';
import * as __cjsImport35 from './tui-sync-status.ts';
const { isSyncSetupError, syncSetupStatus, syncStatusFromResult } = __cjsImport35;
const VALID_TYPES = new Set(['sync:mutation', 'sync:flush', 'sync:status', 'sync:shutdown']);
const INVALID_SYNC_MESSAGE = 'Invalid sync message';

type SyncContext = Record<string, unknown>;
type SyncStatus = Record<string, unknown>;
type SyncMessageType = 'sync:mutation' | 'sync:flush' | 'sync:status' | 'sync:shutdown';
type IpcMessage = {type?: unknown; payload?: unknown};
type IpcPayload = {id?: unknown; context?: unknown};
type SendMessage = {type: string; payload: Record<string, unknown>};
type Send = (message: SendMessage) => void;
type Waiter = {id: string; resolve: (status: SyncStatus) => void};
type SyncIndex = {
  notifyLocalMutation: (context: SyncContext) => Promise<SyncStatus>;
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
  let flushWaiters: Waiter[] = [];
  let lastStatus: SyncStatus | null = null;

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

  async function run(context: SyncContext, waiters: Waiter[], options: {emitStart?: boolean} = {}) {
    const shouldEmitStart = options.emitStart !== false;

    active = true;
    activeWaiters = waiters;

    if (shouldEmitStart) {
      emit('sync:event', {state: 'syncing', message: 'Syncing...', context});
    }

    try {
      const result = await syncIndex.notifyLocalMutation(context);
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

    if (flushWaiters.length > 0) {
      const waitersToFlush = flushWaiters;
      flushWaiters = [];
      const status = lastStatus || readStatus();
      finishWaiters(waitersToFlush, status);
    }
  }

  function readStatus() {
    if (syncIndex && typeof syncIndex.getSyncStatus === 'function') {
      return syncIndex.getSyncStatus();
    }

    return lastStatus || {status: 'disabled', hasPendingRemote: false};
  }

  function enqueueMutation(id: string, context: SyncContext) {
    return new Promise<SyncStatus>((resolve) => {
      const waiter = {id, resolve};

      if (active) {
        pendingContext = context;
        pendingWaiters.push(waiter);
        return;
      }

      run(context, [waiter]);
    });
  }

  function flush(id: string) {
    return new Promise<SyncStatus>((resolve) => {
      const waiter = {id, resolve};

      if (active || pendingContext !== null) {
        flushWaiters.push(waiter);
        return;
      }

      const status = lastStatus || readStatus();
      emit('sync:result', {id, ok: true, status});
      resolve(status);
    });
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

    if (messageType === 'sync:flush') {
      await flush(payload.id);
      return;
    }

    if (messageType === 'sync:status') {
      try {
        const status = readStatus();
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
