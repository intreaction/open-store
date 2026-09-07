import { ShellError } from '../errors.js';
import { parseFlags } from '../shell/argv.js';
import { normalizePath } from '../shell/paths.js';
import { diffViews, ok, viewOfCommit, withFlagErrors, type CommandRun } from './common.js';

/** `git_diff <sha1> [sha2] [-- path]` — `sha2` defaults to the branch head. */
export const gitDiff: CommandRun = async (ctx, argv) => {
  const args = withFlagErrors('git_diff', () => parseFlags(argv, {}, { pathspec: true }));
  const from = args.positional[0];
  if (from === undefined) {
    throw new ShellError('git_diff: missing commit');
  }
  if (args.positional.length > 2) {
    throw new ShellError(`fatal: ambiguous argument '${args.positional[2]}'`);
  }
  const filter = args.pathspec[0] !== undefined ? normalizePath('git_diff', args.pathspec[0]) : undefined;

  const beforeDetail = await ctx.store.commitDetail(from);
  const toRef = args.positional[1];
  const afterTree = toRef
    ? (await ctx.store.commitDetail(toRef)).tree
    : (await ctx.store.head()).tree;

  const before = await viewOfCommit(ctx.store, beforeDetail.tree);
  const after = await viewOfCommit(ctx.store, afterTree);

  const diff = await diffViews(ctx.store, before, after, filter);
  return ok(diff.length > 0 ? `${diff.join('\n')}\n` : '');
};
