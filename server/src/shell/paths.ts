import { ShellError } from '../errors.js';

/** The only file types a store holds. Everything else is invisible. */
export const VISIBLE_EXTENSIONS = ['.md', '.markdown', '.txt', '.yml', '.yaml', '.json', '.csv'];

export const VISIBLE_EXTENSIONS_HELP = VISIBLE_EXTENSIONS.join(' ');

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** True when `path` names a file type the store can show or write. */
export function hasVisibleExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return VISIBLE_EXTENSIONS.some((ext) => lower.endsWith(ext) && lower.length > ext.length);
}

/** True when any segment is a dot-file or dot-directory (`.git`, `.github`, ...). */
export function hasHiddenSegment(path: string): boolean {
  return path.split('/').some((seg) => seg.length > 1 && seg.startsWith('.'));
}

/**
 * True when a repository blob path is visible through the tools: no hidden
 * segments and a text extension.
 */
export function isVisibleFilePath(path: string): boolean {
  if (path.length === 0) return false;
  if (hasHiddenSegment(path)) return false;
  return hasVisibleExtension(path);
}

/**
 * Normalizes a user-supplied repo-relative path.
 *
 * Escapes (`..`, absolute paths, `//`, backslashes) are rejected outright with
 * `Permission denied`. Hidden paths are invisible rather than forbidden, so
 * they report `No such file or directory` exactly as a missing file would.
 *
 * Returns `''` for the store root.
 */
export function normalizePath(cmd: string, raw: string): string {
  if (raw.length === 0) {
    throw new ShellError(`${cmd}: '': No such file or directory`);
  }
  if (
    CONTROL_CHARS.test(raw) ||
    raw.includes('\\') ||
    raw.startsWith('/') ||
    raw.includes('//') ||
    raw.startsWith('~')
  ) {
    throw new ShellError(`${cmd}: ${raw}: Permission denied`);
  }

  const segments: string[] = [];
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      throw new ShellError(`${cmd}: ${raw}: Permission denied`);
    }
    segments.push(seg);
  }
  const path = segments.join('/');
  if (hasHiddenSegment(path)) {
    throw new ShellError(`${cmd}: ${raw}: No such file or directory`);
  }
  return path;
}

/**
 * Normalizes a path that is about to be written. Adds the "must be a text
 * file" rule; a non-text target is reported as missing, never as forbidden.
 */
export function normalizeWritablePath(cmd: string, raw: string): string {
  const path = normalizePath(cmd, raw);
  if (path === '') {
    throw new ShellError(`${cmd}: ${raw}: Is a directory`);
  }
  if (!hasVisibleExtension(path)) {
    throw new ShellError(`${cmd}: ${raw}: No such file or directory`);
  }
  return path;
}

/** `home/network.md` -> `home`; top-level files -> `''`. */
export function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

/** `home/network.md` -> `network.md`. */
export function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Joins a normalized directory and a name. */
export function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`;
}
