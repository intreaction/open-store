import { ShellError } from '../errors.js';
import { parseFlags } from '../shell/argv.js';
import { normalizePath } from '../shell/paths.js';
import { StoreView } from '../store/view.js';
import {
  diffViews,
  gitDate,
  ok,
  viewOfCommit,
  withFlagErrors,
  type CommandRun
} from './common.js';

/** `git_show <sha> [-- path]` — commit header plus diffs of visible files. */
export const gitShow: CommandRun = async (ctx, argv) => {
  const args = withFlagErrors('git_show', () => parseFlags(argv, {}, { pathspec: true }));
  const ref = args.positional[0];
  if (ref === undefined) {
    throw new ShellError('git_show: missing commit');
  }
  if (args.positional.length > 1) {
    throw new ShellError(`fatal: ambiguous argument '${args.positional[1]}'`);
  }
  const filter = args.pathspec[0] !== undefined ? normalizePath('git_show', args.pathspec[0]) : undefined;

  const detail = await ctx.store.commitDetail(ref);
  const after = await viewOfCommit(ctx.store, detail.tree);
  const parent = detail.parents[0];
  const before = parent
    ? await viewOfCommit(ctx.store, (await ctx.store.commitDetail(parent)).tree)
    : new StoreView([]);

  const who = detail.authorEmail ? `${detail.authorName} <${detail.authorEmail}>` : detail.authorName;
  const message = detail.message
    .replace(/\s+$/, '')
    .split('\n')
    .map((line) => (line === '' ? '' : `    ${line}`))
    .join('\n');

  const header = [
    `commit ${detail.sha}`,
    `Author: ${who}`,
    `Date:   ${gitDate(detail.date)}`,
    '',
    message,
    ''
  ];

  const diff = await diffViews(ctx.store, before, after, filter);
  return ok(`${[...header, ...diff].join('\n')}\n`);
};
