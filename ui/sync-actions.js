const {safeErrorMessage} = require('./action-results');

const FALLBACK_ERROR = 'Sync failed. Check your setup and try again.';
const NOT_SET_UP = 'Not set up';
const SYNC_OFF = 'Sync off';
const PENDING_SYNC = 'Pending sync';
const SYNCED = 'Synced';
const SYNC_FAILED = 'Sync failed';

function defaultCommands() {
  return require('../sync/commands');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function withoutConsoleLog(action) {
  const originalLog = console.log;
  console.log = () => {};

  return Promise.resolve()
    .then(action)
    .finally(() => {
      console.log = originalLog;
    });
}

function labelFromStatus(status) {
  if (!isObject(status)) {
    return SYNC_FAILED;
  }

  if (status.status === 'disabled' || status.enabled === false) {
    return SYNC_OFF;
  }

  if (status.status === 'misconfigured') {
    return NOT_SET_UP;
  }

  if (status.status === 'pending_remote') {
    return PENDING_SYNC;
  }

  if (status.status === 'healthy') {
    return status.hasPendingRemote === true ? PENDING_SYNC : SYNCED;
  }

  return SYNC_FAILED;
}

function detailsFromStatus(status) {
  const label = labelFromStatus(status);
  const details = [`Status: ${label}`];

  if (isObject(status) && status.hasPendingRemote === true) {
    details.push('Pending sync: yes');
  }

  return details;
}

function resultFromStatus(status, values = {}) {
  const label = labelFromStatus(status);

  return {
    ok: true,
    label,
    details: detailsFromStatus(status),
    ...values
  };
}

function setupResult(error) {
  return {
    ok: false,
    error,
    label: NOT_SET_UP,
    details: [`Status: ${NOT_SET_UP}`]
  };
}

function knownFailureResult(error = null) {
  const message = error && typeof error.message === 'string' ? error.message : '';

  if (/remoteUrl when sync is enabled|requires remoteUrl/i.test(message)) {
    return setupResult('Set up sync before trying again.');
  }

  if (/Initialization stopped to avoid overwriting data|avoid overwriting data/i.test(message)) {
    return setupResult('Setup stopped to protect your files.');
  }

  return {
    ok: false,
    error: safeErrorMessage(message, FALLBACK_ERROR),
    label: SYNC_FAILED,
    details: [`Status: ${SYNC_FAILED}`]
  };
}

function failureResult(error = null) {
  return knownFailureResult(error);
}

function validationResult(error) {
  return {
    ok: false,
    error,
    label: NOT_SET_UP,
    details: [`Status: ${NOT_SET_UP}`]
  };
}

function normalizeBranch(value) {
  const branch = cleanText(value);
  return branch.length > 0 ? branch : 'main';
}

function createSyncActions(options = {}) {
  const commands = options.commands || defaultCommands();

  async function readStatus() {
    try {
      const status = await withoutConsoleLog(() => commands.status());
      return resultFromStatus(status);
    } catch (error) {
      return failureResult(error);
    }
  }

  async function runCommand(name) {
    try {
      const status = await commands[name]();
      return resultFromStatus(status);
    } catch (error) {
      return failureResult(error);
    }
  }

  return {
    status: readStatus,
    retry() {
      return runCommand('retry');
    },
    enable() {
      return runCommand('enable');
    },
    disable() {
      return runCommand('disable');
    },
    async init(values = {}) {
      const remoteUrl = cleanText(values.remoteUrl);
      const branch = cleanText(values.branch);
      const confirmed = values.confirmed === true;

      if (remoteUrl.length === 0) {
        return validationResult('Remote URL is required.');
      }

      if (branch.length === 0) {
        return validationResult('Branch is required.');
      }

      if (confirmed !== true) {
        return validationResult('Confirm setup before starting sync.');
      }

      try {
        await commands.init([], {remote: remoteUrl, branch: normalizeBranch(branch)});
        const status = typeof commands.status === 'function'
          ? await withoutConsoleLog(() => commands.status())
          : {status: 'pending_remote', hasPendingRemote: true};

        return resultFromStatus(status);
      } catch (error) {
        return failureResult(error);
      }
    }
  };
}

module.exports = {
  FALLBACK_ERROR,
  createSyncActions,
  labelFromStatus,
  detailsFromStatus
};
