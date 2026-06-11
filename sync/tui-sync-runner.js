const defaultSyncIndex = require('./index');
const {isSyncSetupError, syncSetupStatus, syncStatusFromResult} = require('./tui-sync-status');

const VALID_TYPES = new Set(['sync:mutation', 'sync:flush', 'sync:status', 'sync:shutdown']);
const INVALID_SYNC_MESSAGE = 'Invalid sync message';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidContext(value) {
  return isObject(value);
}

function safeSend(send, message) {
  try {
    send(message);
  } catch (_) {}
}

function createTuiSyncRunner(options = {}) {
  const syncIndex = options.syncIndex || defaultSyncIndex;
  const send = typeof options.send === 'function'
    ? options.send
    : (message) => {
      if (typeof process.send === 'function') {
        process.send(message);
      }
    };
  const close = typeof options.close === 'function'
    ? options.close
    : () => process.exit(0);

  let active = false;
  let pendingContext = null;
  let activeWaiters = [];
  let pendingWaiters = [];
  let flushWaiters = [];
  let lastStatus = null;

  function emit(type, payload) {
    safeSend(send, {type, payload});
  }

  function emitInvalid(payload) {
    const id = payload && isValidId(payload.id) ? payload.id : undefined;
    const body = {ok: false, message: INVALID_SYNC_MESSAGE};

    if (id) {
      body.id = id;
    }

    emit('sync:error', body);
  }

  function finishWaiters(waiters, result) {
    for (const waiter of waiters) {
      emit('sync:result', {id: waiter.id, ok: true, status: result});
      waiter.resolve(result);
    }
  }

  function failWaiters(waiters, error) {
    const message = isSyncSetupError(error) ? syncSetupStatus().message : 'Sync failed';

    for (const waiter of waiters) {
      emit('sync:error', {id: waiter.id, ok: false, message});
      waiter.resolve({status: 'failed', hasPendingRemote: true});
    }
  }

  async function run(context, waiters, options = {}) {
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
    } catch (error) {
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

  function enqueueMutation(id, context) {
    return new Promise((resolve) => {
      const waiter = {id, resolve};

      if (active) {
        pendingContext = context;
        pendingWaiters.push(waiter);
        return;
      }

      run(context, [waiter]);
    });
  }

  function flush(id) {
    return new Promise((resolve) => {
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

  async function shutdown(id) {
    await flush(id);
    close();
  }

  async function handleMessage(message) {
    const payload = isObject(message) && isObject(message.payload) ? message.payload : {};
    const type = isObject(message) ? message.type : null;

    if (!VALID_TYPES.has(type) || !isValidId(payload.id)) {
      emitInvalid(payload);
      return;
    }

    if (type === 'sync:mutation') {
      if (!isValidContext(payload.context)) {
        emitInvalid(payload);
        return;
      }

      await enqueueMutation(payload.id, payload.context);
      return;
    }

    if (type === 'sync:flush') {
      await flush(payload.id);
      return;
    }

    if (type === 'sync:status') {
      try {
        const status = readStatus();
        emit('sync:result', {id: payload.id, ok: true, status});
      } catch (error) {
        emit('sync:error', {id: payload.id, ok: false, message: 'Sync failed'});
      }
      return;
    }

    if (type === 'sync:shutdown') {
      await shutdown(payload.id);
    }
  }

  return {handleMessage};
}

if (require.main === module) {
  const runner = createTuiSyncRunner();
  process.on('message', (message) => {
    runner.handleMessage(message).catch(() => {
      if (typeof process.send === 'function') {
        process.send({type: 'sync:error', payload: {ok: false, message: 'Sync failed'}});
      }
    });
  });
}

module.exports = {
  createTuiSyncRunner
};
