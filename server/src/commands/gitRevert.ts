import { ShellError } from '../errors.js';
import { parseFlags } from '../shell/argv.js';
import { StoreView } from '../store/view.js';
import type { Change } from '../store/types.js';
import {
  commitCycle,
  ok,
  shortSha,
  subjectOf,
  viewOfCommit,
  withFlagErrors,
  type CommandRun
} from './common.js';

/**
 * `git_revert [-m MESSAGE] <sha>` — one new commit that undoes the visible-file
 * changes of `<sha>`. History is never rewritten. Refuses to run if any of
 * those files changed again afterwards.
 */
export const gitRevert: CommandRun = async (ctx, argv) => {
  const args = withFlagErrors('git_revert', () => parseFlags(argv, { '-m': 'value' }));
  const ref = args.positional[0];
  if (ref === undefined) {
    throw new ShellError('git_revert: missing commit');
  }
  if (args.positional.length > 1) {
    throw new ShellError(`fatal: ambiguous argument '${args.positional[1]}'`);
  }

  const detail = await ctx.store.commitDetail(ref);
  const after = await viewOfCommit(ctx.store, detail.tree);
  const parentSha = detail.parents[0];
  const before = parentSha
    ? await viewOfCommit(ctx.store, (await ctx.store.commitDetail(parentSha)).tree)
    : new StoreView([]);

  const touched = [...new Set([...before.allPaths(), ...after.allPaths()])]
    .filter((path) => before.file(path)?.sha !== after.file(path)?.sha)
    .sort();

  if (touched.length === 0) {
    throw new ShellError(`error: could not revert ${shortSha(detail.sha)}: no visible changes`);
  }

  const short = shortSha(detail.sha);
  const subject = args.value('-m') ?? `revert ${short}: ${subjectOf(detail.message)}`;

  const outcome = await commitCycle(ctx, subject, async (snap) => {
    const changes: Change[] = [];
    for (const path of touched) {
      const currentEntry = snap.view.file(path);
      const afterEntry = after.file(path);
      // The file must still look exactly as that commit left it.
      if (currentEntry?.sha !== afterEntry?.sha) {
        const currentText = currentEntry ? await ctx.store.readBlob(currentEntry.sha) : null;
        const afterText = afterEntry ? await ctx.store.readBlob(afterEntry.sha) : null;
        if (currentText !== afterText) {
          throw new ShellError(
            `error: could not revert ${short}: ${path} has changed since that commit`
          );
        }
      }
      const beforeEntry = before.file(path);
      changes.push({
        path,
        content: beforeEntry ? await ctx.store.readBlob(beforeEntry.sha) : null
      });
    }
    return changes;
  });

  return ok(
    `reverted ${short} "${subjectOf(detail.message)}" @ ${shortSha(outcome.commit.sha)}\n`
  );
};
