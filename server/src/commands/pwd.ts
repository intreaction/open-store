import { parseFlags } from '../shell/argv.js';
import { ok, shortSha, withFlagErrors, type CommandRun } from './common.js';

/** Prints the store root plus a one-line description of where it points. */
export const pwd: CommandRun = async (ctx, argv) => {
  withFlagErrors('pwd', () => parseFlags(argv, {}));
  const head = await ctx.store.head();
  const line = `# store: ${ctx.store.owner}/${ctx.store.repo}@${head.branch} (head ${shortSha(head.commit)})`;
  return ok(`/\n${line}\n`);
};
