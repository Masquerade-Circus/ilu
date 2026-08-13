import type { UiActionResult } from "./action-contracts";
import { DataConflictError } from '../sync/iludb-recovery.ts';

const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Try again.';

function isUnsafeErrorMessage(value: unknown): boolean {
  if (typeof value !== 'string') {
    return true;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return true;
  }

  return /(?:^|\s)(?:at\s+|file:\/\/|\/home\/|\.ssh|\.config|[A-Za-z]:\\|token\s*=|api[_-]?key|secret|password|stack|trace|provider|internal|\n)/i.test(trimmed);
}

function safeErrorMessage(value: unknown, fallback: unknown = DEFAULT_ERROR_MESSAGE): string {
  if (!isUnsafeErrorMessage(fallback)) {
    return (fallback as string).trim();
  }

  if (!isUnsafeErrorMessage(value)) {
    return (value as string).trim();
  }

  return DEFAULT_ERROR_MESSAGE;
}

function createUiErrorResult(error: unknown, fallback: unknown = DEFAULT_ERROR_MESSAGE): UiActionResult {
  if (error instanceof DataConflictError) {
    void error.reconciliation.catch(() => undefined);
    return {ok: false, error: 'Data changed elsewhere. Ilu is recovering it. Try the action again after recovery finishes.'};
  }
  return {ok: false, error: safeErrorMessage(null, fallback)};
}

function createUiSuccessResult(values: unknown = {}): UiActionResult {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return {ok: true};
  }

  return {ok: true, ...values};
}

export { createUiErrorResult, createUiSuccessResult, safeErrorMessage };
export default {
  createUiErrorResult,
  createUiSuccessResult,
  safeErrorMessage
};
