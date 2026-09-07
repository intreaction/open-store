import { diffLines, structuredPatch } from 'diff';
import { RefConflictError, ShellError } from '../errors.js';
import { snapshot, StoreView, type Snapshot } from '../store/view.js';
import type { Change, CommitInfo, Store } from '../store/types.js';
import { normalizePath } from '../shell/paths.js';
import { FlagError, TokenizeError, tokenize } from '../shell/argv.js';

export interface CommandContext {
  store: Store;
  /** Label for the `OpenStore-Client:` commit trailer. */
  client: string;
}

export interface CommandResult {
  stdout: string;
  exitCode: number;
}

export type CommandRun = (
  ctx: CommandContext,
  argv: string[],
  content?: string
) => Promise<CommandResult>;

export const ok = (stdout: string): CommandResult => ({ stdout, exitCode: 0 });

/** Splits the `args` string, reporting tokenizer problems as `<cmd>: ...`. */
export function argvFor(cmd: string, args: string | undefined): string[] {
  try {
    return tokenize(args ?? '');
  } catch (error) {
    if (error instanceof TokenizeError) throw new ShellError(`${cmd}: ${error.message}`);
    throw error;
  }
}

/** Runs `fn`, turning flag-parser problems into `<cmd>: ...` shell errors. */
export function withFlagErrors<T>(cmd: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof FlagError) throw new ShellError(`${cmd}: ${error.message}`);
    throw error;
  }
}

export const shortSha = (sha: string): string => sha.slice(0, 7);

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Sat Sep 6 16:22:01 2026 +0000`, the way `git log` prints dates. */
export function gitDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ` +
    `${d.getUTCFullYear()} +0000`
  );
}

/** `2026-09-06` for `ls -l`. */
export function shortDate(iso: string | null): string {
  if (!iso) return '          ';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '          ';
  return d.toISOString().slice(0, 10);
}

/** First line of a commit message. */
export function subjectOf(message: string): string {
  const line = message.split('\n', 1)[0] ?? '';
  return line.trim();
}

export function bodyLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Reads one visible file, with bash-style errors for missing paths and dirs. */
export async function readVisibleFile(
  store: Store,
  view: StoreView,
  cmd: string,
  raw: string
): Promise<{ path: string; content: string }> {
  const path = normalizePath(cmd, raw);
  if (view.hasFile(path)) {
    const entry = view.file(path)!;
    return { path, content: await store.readBlob(entry.sha) };
  }
  if (view.hasDir(path)) {
    throw new ShellError(`${cmd}: ${raw || '.'}: Is a directory`);
  }
  throw new ShellError(`${cmd}: ${raw}: No such file or directory`);
}

export interface LineDelta {
  added: number;
  removed: number;
}

/** Counts added/removed lines between two file bodies. */
export function countLines(oldText: string, newText: string): LineDelta {
  if (oldText === newText) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const part of diffLines(oldText, newText)) {
    if (part.added) added += part.count ?? 0;
    else if (part.removed) removed += part.count ?? 0;
  }
  return { added, removed };
}

/** Renders one file's change as a `git diff` style unified patch. */
export function renderFileDiff(
  path: string,
  before: string | null,
  after: string | null
): string[] {
  if (before === after) return [];
  const lines: string[] = [`diff --git a/${path} b/${path}`];
  if (before === null) lines.push('new file mode 100644');
  if (after === null) lines.push('deleted file mode 100644');
  lines.push(`--- ${before === null ? '/dev/null' : `a/${path}`}`);
  lines.push(`+++ ${after === null ? '/dev/null' : `b/${path}`}`);

  const patch = structuredPatch(path, path, before ?? '', after ?? '', '', '', { context: 3 });
  for (const hunk of patch.hunks) {
    lines.push(
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
    );
    for (const line of hunk.lines) lines.push(line);
  }
  return lines;
}

/** Builds the commit message with the OpenStore client trailer. */
export function commitMessage(subject: string, client: string): string {
  return `${subject.replace(/\s+$/, '')}\n\nOpenStore-Client: ${client}\n`;
}

export interface WriteOutcome {
  commit: CommitInfo;
  snapshot: Snapshot;
}

/**
 * The one and only write path: read head, build the change set, commit with the
 * head as parent, update the ref without forcing. If the branch advanced under
 * us, redo the whole cycle; give up after three attempts.
 */
export async function commitCycle(
  ctx: CommandContext,
  subject: string | ((snap: Snapshot) => string),
  build: (snap: Snapshot) => Promise<Change[]> | Change[]
): Promise<WriteOutcome> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const snap = await snapshot(ctx.store);
    const changes = await build(snap);
    const line = typeof subject === 'function' ? subject(snap) : subject;
    try {
      const commit = await ctx.store.commit({
        parent: snap.head.commit,
        changes,
        message: commitMessage(line, ctx.client)
      });
      return { commit, snapshot: snap };
    } catch (error) {
      if (error instanceof RefConflictError) continue;
      throw error;
    }
  }
  throw new ShellError('error: failed to push: branch advanced concurrently, retry');
}

/** True when `path` is inside (or equal to) the pathspec filter. */
export function underFilter(path: string, filter: string | undefined): boolean {
  if (filter === undefined || filter === '') return true;
  return path === filter || path.startsWith(`${filter}/`);
}

/**
 * Unified diff between two visible views, restricted to an optional pathspec.
 * Only text files that the store shows are ever diffed.
 */
export async function diffViews(
  store: Store,
  before: StoreView,
  after: StoreView,
  filter?: string
): Promise<string[]> {
  const paths = [...new Set([...before.allPaths(), ...after.allPaths()])]
    .filter((path) => underFilter(path, filter))
    .sort();

  const out: string[] = [];
  for (const path of paths) {
    const oldEntry = before.file(path);
    const newEntry = after.file(path);
    if (oldEntry && newEntry && oldEntry.sha === newEntry.sha) continue;
    const oldText = oldEntry ? await store.readBlob(oldEntry.sha) : null;
    const newText = newEntry ? await store.readBlob(newEntry.sha) : null;
    out.push(...renderFileDiff(path, oldText, newText));
  }
  return out;
}

/** Builds the visible view of an arbitrary commit. */
export async function viewOfCommit(store: Store, treeSha: string): Promise<StoreView> {
  const { entries, truncated } = await store.tree(treeSha);
  return new StoreView(entries, truncated);
}
