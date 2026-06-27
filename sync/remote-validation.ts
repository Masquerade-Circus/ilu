function cleanText(value: any) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasEmbeddedUrlUserinfo(value: any) {
  try {
    const parsedUrl = new URL(value);

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return false;
    }

    return parsedUrl.username.length > 0 || parsedUrl.password.length > 0;
  } catch (_error: any) {
    return false;
  }
}

function validateSyncRemoteUrl(value: any) {
  const remoteUrl = cleanText(value);

  if (remoteUrl.length === 0) {
    throw new Error('A remote URL is required for sync init');
  }

  if (hasEmbeddedUrlUserinfo(remoteUrl)) {
    throw new Error('Remote URL must not include embedded credentials');
  }

  return remoteUrl;
}

function validateSyncBranch(value: any) {
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
    || branch.split('/').some((part: any) => part.startsWith('.') || part.endsWith('.'))
  ) {
    throw new Error('Invalid sync branch name');
  }

  return branch;
}

module.exports = {
  hasEmbeddedUrlUserinfo,
  validateSyncBranch,
  validateSyncRemoteUrl
};
