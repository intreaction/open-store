/**
 * The whole storage surface OpenStore needs. Two implementations exist: the
 * real GitHub Git Data API store and an in-memory fake used by the tests.
 *
 * Nothing here caches across calls. A store object is created for a single tool
 * call and thrown away when the call returns.
 */

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface TreeResult {
  entries: TreeEntry[];
  /** The host refused to return the whole tree. */
  truncated: boolean;
}

export interface HeadInfo {
  branch: string;
  /** Commit sha the branch points at. */
  commit: string;
  /** Tree sha of that commit. */
  tree: string;
}

/** One file change in a commit. `content === null` deletes the path. */
export interface Change {
  path: string;
  content: string | null;
}

export interface CommitInput {
  /** Commit sha the new commit must be built on. */
  parent: string;
  changes: Change[];
  message: string;
}

export interface CommitInfo {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  /** ISO-8601 timestamp. */
  date: string;
}

export interface CommitDetail extends CommitInfo {
  parents: string[];
  tree: string;
}

export interface LogOptions {
  limit: number;
  author?: string;
  since?: string;
  path?: string;
}

export interface Store {
  readonly owner: string;
  readonly repo: string;

  /** Resolves the configured branch (or the repo default) to a commit + tree. */
  head(): Promise<HeadInfo>;
  /** Recursive listing of one tree. */
  tree(treeSha: string): Promise<TreeResult>;
  /** UTF-8 contents of one blob. */
  readBlob(sha: string): Promise<string>;
  /**
   * Creates exactly one commit on the branch with `parent` as its parent and
   * moves the ref without forcing. Throws RefConflictError if the ref moved.
   */
  commit(input: CommitInput): Promise<CommitInfo>;
  log(options: LogOptions): Promise<CommitInfo[]>;
  /** Full metadata for a commit; accepts abbreviated shas. */
  commitDetail(ref: string): Promise<CommitDetail>;
  /** ISO date of the last commit touching `path`, or null. */
  lastCommitDate(path: string): Promise<string | null>;
}
