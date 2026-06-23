const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Try again.';

function isUnsafeErrorMessage(value: any) {
  if (typeof value !== 'string') {
    return true;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return true;
  }

  return /(?:^|\s)(?:at\s+|file:\/\/|\/home\/|\.ssh|\.config|[A-Za-z]:\\|token\s*=|api[_-]?key|secret|password|stack|trace|provider|internal|\n)/i.test(trimmed);
}

function safeErrorMessage(value: any, fallback: any = DEFAULT_ERROR_MESSAGE) {
  if (!isUnsafeErrorMessage(fallback)) {
    return fallback.trim();
  }

  if (!isUnsafeErrorMessage(value)) {
    return value.trim();
  }

  return DEFAULT_ERROR_MESSAGE;
}

function createUiErrorResult(_error: any, fallback: any = DEFAULT_ERROR_MESSAGE) {
  return {ok: false, error: safeErrorMessage(null, fallback)};
}

function createUiSuccessResult(values: any = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return {ok: true};
  }

  return {ok: true, ...values};
}

module.exports = {
  createUiErrorResult,
  createUiSuccessResult,
  safeErrorMessage
};
