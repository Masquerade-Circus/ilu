function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasEmbeddedUrlUserinfo(value: string) {
  try {
    const parsedUrl = new URL(value);

    if (parsedUrl.protocol === 'ssh:') {
      return parsedUrl.password.length > 0;
    }

    if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
      return parsedUrl.username.length > 0 || parsedUrl.password.length > 0;
    }

    return false;
  } catch {
    return false;
  }
}

function isSupportedRemoteUrl(value: string) {
  if (/^[\x21-\x7e]+@[A-Za-z0-9.-]+:.+/.test(value)) {
    return !value.endsWith(':') && !/\s/.test(value);
  }

  if (value.startsWith('/') || value.startsWith('./')) {
    return !/[\s\x00-\x1f]/.test(value);
  }

  try {
    const parsedUrl = new URL(value);
    const supportedProtocols = new Set(['file:', 'http:', 'https:', 'ssh:']);

    if (!supportedProtocols.has(parsedUrl.protocol)) {
      return false;
    }

    if ((parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'ssh:') && parsedUrl.hostname.length === 0) {
      return false;
    }

    if (parsedUrl.protocol === 'file:' && parsedUrl.pathname.trim().length === 0) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function validateSyncRemoteUrl(value: unknown) {
  const remoteUrl = cleanText(value);

  if (remoteUrl.length === 0) {
    throw new Error('A remote URL is required for sync init');
  }

  if (hasEmbeddedUrlUserinfo(remoteUrl)) {
    throw new Error('Remote URL must not include embedded credentials');
  }

  if (!isSupportedRemoteUrl(remoteUrl)) {
    throw new Error('Invalid sync remote URL');
  }

  return remoteUrl;
}

function validateSyncBranch(value: unknown) {
  const branch = cleanText(value);

  if (branch.length === 0) {
    throw new Error('A branch is required for sync init');
  }

  if (
    branch.startsWith('-')
    || branch.startsWith('/')
    || branch.endsWith('/')
    || branch.endsWith('.')
    || branch.endsWith('.lock')
    || branch.includes('//')
    || branch.includes('..')
    || branch.includes('@{')
    || /[\s\x00-\x1f~^:?*[\\\]]/.test(branch)
    || branch.split('/').some((part: string) => part.startsWith('.') || part.endsWith('.'))
  ) {
    throw new Error('Invalid sync branch name');
  }

  return branch;
}

export { hasEmbeddedUrlUserinfo, isSupportedRemoteUrl, validateSyncBranch, validateSyncRemoteUrl };
export default {
  hasEmbeddedUrlUserinfo,
  isSupportedRemoteUrl,
  validateSyncBranch,
  validateSyncRemoteUrl
};
