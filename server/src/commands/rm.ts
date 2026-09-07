import { ShellError } from '../errors.js';
import { parseFlags } from '../shell/argv.js';
import { normalizePath } from '../shell/paths.js';
import type { Change } from '../store/types.js';
import { commitCycle, ok, shortSha, withFlagErrors, type CommandRun } from './common.js';

/** `rm [-m MESSAGE] [-r] path...` — refuses a directory without `-r`. */
export const rm: CommandRun = async (ctx, argv) => {
  const args = withFlagErrors('rm', () =>
    parseFlags(argv, { '-m': 'value', '-r': 'bool', '-R': 'bool', '-f': 'bool' })
  );
  if (args.positional.length === 0) {
    throw new ShellError('rm: missing operand');
  }
  const recursive = args.bool('-r', '-R');
  const raws = args.positional;
  const paths = raws.map((raw) => ({ raw, path: normalizePath('rm', raw) }));

  let removed: string[] = [];
  const subject =
    args.value('-m') ??
    (paths.length === 1 ? `rm ${paths[0]!.path}` : `rm ${paths.length} files`);

  const outcome = await commitCycle(ctx, subject, (snap) => {
    const changes: Change[] = [];
    const gone: string[] = [];
    for (const { raw, path } of paths) {
      if (snap.view.hasFile(path)) {
        changes.push({ path, content: null });
        gone.push(path);
        continue;
      }
      if (snap.view.hasDir(path)) {
        if (!recursive) {
          throw new ShellError(`rm: cannot remove '${raw}': Is a directory`);
        }
        for (const file of snap.view.under(path)) {
          changes.push({ path: file.path, content: null });
          gone.push(file.path);
        }
        continue;
      }
      throw new ShellError(`rm: cannot remove '${raw}': No such file or directory`);
    }
    removed = gone;
    return changes;
  });

  const sha = shortSha(outcome.commit.sha);
  if (removed.length === 1) {
    return ok(`removed ${removed[0]} @ ${sha}\n`);
  }
  const lines = removed.map((path) => `removed ${path}`);
  lines.push(`${removed.length} files removed @ ${sha}`);
  return ok(`${lines.join('\n')}\n`);
};
