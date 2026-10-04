const FILE_URI_PREFIX = 'file://';

export function pathToUri(filePath: string): string {
  if (isFileUri(filePath)) {
    return filePath;
  }

  if (isWindowsPath(filePath)) {
    const normalized = filePath.replace(/\\/g, '/');
    return `${FILE_URI_PREFIX}/${encodePath(normalized)}`;
  }

  if (!filePath.startsWith('/')) {
    throw new Error('Expected an absolute file path');
  }

  return `${FILE_URI_PREFIX}${encodePath(filePath)}`;
}

export function uriToPath(uri: string): string {
  if (!isFileUri(uri)) {
    throw new Error('Expected a file URI');
  }

  const decoded = decodeURIComponent(uri.slice(FILE_URI_PREFIX.length));

  if (/^\/[A-Za-z]:\//.test(decoded)) {
    return decoded.slice(1).replace(/\//g, '\\');
  }

  return decoded;
}

/**
 * Converts a location URI into a path for display. File URIs under `root` become
 * root-relative; other URIs (e.g. `jar:` entries for library sources) are returned
 * unchanged instead of throwing, since servers may point into archives.
 */
export function uriToDisplayPath(uri: string, root?: string | null): string {
  if (!isFileUri(uri)) {
    return uri;
  }

  const filePath = uriToPath(uri);
  if (!root) {
    return filePath;
  }

  const relative = relativeToRoot(filePath, root);
  return relative ?? filePath;
}

/**
 * True when the URI's file, or for a `jar:` URI the archive holding it, lies in a
 * `build` directory inside `root` — compiled or generated output that duplicates
 * the project's sources.
 */
export function isInProjectBuildDirectory(uri: string, root?: string | null): boolean {
  if (!root) {
    return false;
  }

  const filePath = uriToFileSystemPath(uri);
  const relative = filePath === null ? null : relativeToRoot(filePath, root);
  return relative !== null && relative.split(/[\\/]/).includes('build');
}

/** The file behind a `file:` URI, or the archive behind a `jar:` URI; null otherwise. */
function uriToFileSystemPath(uri: string): string | null {
  if (isFileUri(uri)) {
    return uriToPath(uri);
  }

  if (!uri.startsWith('jar:')) {
    return null;
  }

  // Both "jar:///a/b.jar!/x" and "jar:file:///a/b.jar!/x" occur in practice.
  const archive = uri.slice('jar:'.length).split('!/')[0] ?? '';
  return isFileUri(archive)
    ? uriToPath(archive)
    : archive.startsWith('///')
      ? decodeURIComponent(archive.slice(2))
      : null;
}

function relativeToRoot(filePath: string, root: string): string | null {
  const separator = root.includes('\\') ? '\\' : '/';
  const prefix = root.endsWith(separator) ? root : `${root}${separator}`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : null;
}

function isFileUri(value: string): boolean {
  return value.startsWith(`${FILE_URI_PREFIX}/`);
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function encodePath(value: string): string {
  return value
    .split('/')
    .map((segment, index) => {
      const encoded = encodeURIComponent(segment);
      return index === 0 && /^[A-Za-z]:$/.test(segment) ? encoded.replace('%3A', ':') : encoded;
    })
    .join('/');
}
