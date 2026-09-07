import { MAX_VISIBLE_FILES } from '../limits.js';
import { isVisibleFilePath, dirname } from '../shell/paths.js';
import type { Store, TreeEntry, HeadInfo } from './types.js';

export interface ViewFile {
  path: string;
  sha: string;
  size: number;
}

/**
 * The visible slice of one tree: text files with no hidden segment, plus the
 * directories implied by them. Built once per tool call and never kept.
 */
export class StoreView {
  readonly files = new Map<string, ViewFile>();
  readonly dirs = new Set<string>();
  /** True when the file limit (or the host's tree limit) cut the listing short. */
  readonly truncated: boolean;

  constructor(entries: TreeEntry[], hostTruncated = false) {
    const visible = entries
      .filter((e) => e.type === 'blob' && isVisibleFilePath(e.path))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const overLimit = visible.length > MAX_VISIBLE_FILES;
    for (const entry of visible.slice(0, MAX_VISIBLE_FILES)) {
      this.files.set(entry.path, { path: entry.path, sha: entry.sha, size: entry.size ?? 0 });
      let dir = dirname(entry.path);
      while (dir !== '') {
        if (this.dirs.has(dir)) break;
        this.dirs.add(dir);
        dir = dirname(dir);
      }
    }
    this.truncated = overLimit || hostTruncated;
  }

  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  hasDir(path: string): boolean {
    return path === '' || this.dirs.has(path);
  }

  exists(path: string): boolean {
    return this.hasFile(path) || this.hasDir(path);
  }

  file(path: string): ViewFile | undefined {
    return this.files.get(path);
  }

  /** Every visible file path, sorted. */
  allPaths(): string[] {
    return [...this.files.keys()];
  }

  /** Visible files at or below `dir` ('' = whole store), sorted. */
  under(dir: string): ViewFile[] {
    const prefix = dir === '' ? '' : `${dir}/`;
    const out: ViewFile[] = [];
    for (const file of this.files.values()) {
      if (prefix === '' || file.path.startsWith(prefix)) out.push(file);
    }
    return out;
  }

  /** Immediate children of `dir`, sorted by name. */
  children(dir: string): { name: string; path: string; isDir: boolean }[] {
    const prefix = dir === '' ? '' : `${dir}/`;
    const seen = new Map<string, { name: string; path: string; isDir: boolean }>();
    const add = (path: string, isDir: boolean) => {
      if (prefix !== '' && !path.startsWith(prefix)) return;
      const rest = path.slice(prefix.length);
      if (rest === '' || rest.includes('/')) return;
      seen.set(rest, { name: rest, path, isDir });
    };
    for (const dirPath of this.dirs) add(dirPath, true);
    for (const file of this.files.values()) add(file.path, false);
    return [...seen.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
}

export interface Snapshot {
  head: HeadInfo;
  view: StoreView;
}

/** Resolves head and builds the visible view: the start of every tool call. */
export async function snapshot(store: Store): Promise<Snapshot> {
  const head = await store.head();
  const tree = await store.tree(head.tree);
  return { head, view: new StoreView(tree.entries, tree.truncated) };
}
