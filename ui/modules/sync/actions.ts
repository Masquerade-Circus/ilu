import type { SyncActionFactoryOptions, SyncActionResult, SyncActions } from "../../action-contracts";

const {safeErrorMessage} = require('../../action-results');
const {validateSyncBranch, validateSyncRemoteUrl} = require('../../../sync/remote-validation');

const FALLBACK_ERROR = 'Sync failed. Check your setup and try again.';
const NOT_SET_UP = 'Not set up';
const SYNC_OFF = 'Sync off';
const PENDING_SYNC = 'Pending sync';
const SYNCED = 'Synced';
const SYNC_FAILED = 'Sync failed';

type SyncStatus = {
  status?: unknown;
  enabled?: unknown;
  hasPendingRemote?: unknown;
};

type SyncInitValues = {
  remoteUrl?: unknown;
  branch?: unknown;
  confirmed?: unknown;
};
type SyncCommandName = 'retry' | 'enable' | 'disable';
type CommandAction = () => Promise<SyncStatus> | SyncStatus;
type SyncCommands = Record<SyncCommandName, CommandAction> & {
  status: CommandAction;
  init: (args: string[], options: {remote: string; branch: string}) => Promise<unknown> | unknown;
};

function defaultCommands() {
  return require('../../../sync/commands');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function withoutConsoleLog<T>(action: () => Promise<T> | T): Promise<T> {
  const originalLog = console.log;
  console.log = () => {};

  return Promise.resolve()
    .then(action)
    .finally(() => {
      console.log = originalLog;
    });
}

function labelFromStatus(status: unknown) {
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

function detailsFromStatus(status: unknown) {
  const label = labelFromStatus(status);
  const details = [`Status: ${label}`];

  if (isObject(status) && status.hasPendingRemote === true) {
    details.push('Pending sync: yes');
  }

  return details;
}

function resultFromStatus(status: unknown, values: Record<string, unknown> = {}): SyncActionResult {
  const label = labelFromStatus(status);

  return {
    ok: true as const,
    label,
    details: detailsFromStatus(status),
    ...values
  };
}

function setupResult(error: string): SyncActionResult {
  return {
    ok: false as const,
    error,
    label: NOT_SET_UP,
    details: [`Status: ${NOT_SET_UP}`]
  };
}

function knownFailureResult(error: unknown = null): SyncActionResult {
  const message = error instanceof Error ? error.message : '';

  if (/remoteUrl when sync is enabled|requires remoteUrl/i.test(message)) {
    return setupResult('Set up sync before trying again.');
  }

  if (/Initialization stopped to avoid overwriting data|avoid overwriting data/i.test(message)) {
    return setupResult('Setup stopped to protect your files.');
  }

  return {
    ok: false as const,
    error: safeErrorMessage(message, FALLBACK_ERROR),
    label: SYNC_FAILED,
    details: [`Status: ${SYNC_FAILED}`]
  };
}

function failureResult(error: unknown = null): SyncActionResult {
  return knownFailureResult(error);
}

function validationResult(error: string): SyncActionResult {
  return {
    ok: false as const,
    error,
    label: NOT_SET_UP,
    details: [`Status: ${NOT_SET_UP}`]
  };
}

function createSyncActions(options: SyncActionFactoryOptions = {}): SyncActions {
  const commands = (options.commands || defaultCommands()) as SyncCommands;

  async function readStatus() {
    try {
      const status = await withoutConsoleLog(() => commands.status());
      return resultFromStatus(status);
    } catch (error: unknown) {
      return failureResult(error);
    }
  }

  async function runCommand(name: SyncCommandName) {
    try {
      const status = await commands[name]();
      return resultFromStatus(status);
    } catch (error: unknown) {
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
    async init(values: SyncInitValues = {}) {
      const remoteUrlInput = cleanText(values.remoteUrl);
      const branch = cleanText(values.branch);
      const confirmed = values.confirmed === true;

      if (remoteUrlInput.length === 0) {
        return validationResult('Remote URL is required.');
      }

      try {
        validateSyncRemoteUrl(remoteUrlInput);
      } catch (_error: unknown) {
        void _error;
        return validationResult('Remote URL must not include embedded credentials.');
      }

      if (branch.length === 0) {
        return validationResult('Branch is required.');
      }

      if (confirmed !== true) {
        return validationResult('Confirm setup before starting sync.');
      }

      try {
        await commands.init([], {remote: remoteUrlInput, branch: validateSyncBranch(branch)});
        const status = typeof commands.status === 'function'
          ? await withoutConsoleLog(() => commands.status())
          : {status: 'pending_remote', hasPendingRemote: true};

        return resultFromStatus(status);
      } catch (error: unknown) {
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
