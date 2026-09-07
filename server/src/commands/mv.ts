import { ShellError } from '../errors.js';
import { parseFlags } from '../shell/argv.js';
import { normalizePath, normalizeWritablePath } from '../shell/paths.js';
import type { Change } from '../store/types.js';
import { commitCycle, ok, shortSha, withFlagErrors, type CommandRun } from './common.js';

/** `mv [-m MESSAGE] src dst` — renames a file or a whole directory. */
export const mv: CommandRun = async (ctx, argv) => {
  const args = withFlagErrors('mv', () => parseFlags(argv, { '-m': 'value' }));
  const srcRaw = args.positional[0];
  const dstRaw = args.positional[1];
  if (srcRaw === undefined) {
    throw new ShellError('mv: missing file operand');
  }
  if (dstRaw === undefined) {
    throw new ShellError(`mv: missing destination file operand after '${srcRaw}'`);
  }
  if (args.positional.length > 2) {
    throw new ShellError(`mv: too many arguments: '${args.positional[2]}'`);
  }

  const src = normalizePath('mv', srcRaw);
  const dstPath = normalizePath('mv', dstRaw);
  if (src === '') {
    throw new ShellError(`mv: cannot move '${srcRaw}': Is a directory`);
  }
  const subject = args.value('-m') ?? `mv ${src} -> ${dstPath}`;

  let moved = 0;
  let isDir = false;

  const outcome = await commitCycle(ctx, subject, async (snap) => {
    const changes: Change[] = [];

    if (snap.view.hasFile(src)) {
      const dst = normalizeWritablePath('mv', dstRaw);
      if (snap.view.hasFile(dst) || snap.view.hasDir(dst)) {
        throw new ShellError(`mv: cannot move '${srcRaw}' to '${dstRaw}': File exists`);
      }
      const content = await ctx.store.readBlob(snap.view.file(src)!.sha);
      changes.push({ path: src, content: null }, { path: dst, content });
      moved = 1;
      isDir = false;
      return changes;
    }

    if (snap.view.hasDir(src)) {
      isDir = true;
      if (dstPath === '') {
        throw new ShellError(`mv: cannot move '${srcRaw}' to '${dstRaw}': Invalid argument`);
      }
      if (snap.view.hasFile(dstPath) || snap.view.hasDir(dstPath)) {
        throw new ShellError(`mv: cannot move '${srcRaw}' to '${dstRaw}': File exists`);
      }
      const files = snap.view.under(src);
      for (const file of files) {
        const tail = file.path.slice(src.length + 1);
        const content = await ctx.store.readBlob(file.sha);
        changes.push({ path: file.path, content: null }, { path: `${dstPath}/${tail}`, content });
      }
      moved = files.length;
      return changes;
    }

    throw new ShellError(`mv: cannot stat '${srcRaw}': No such file or directory`);
  });

  const suffix = isDir ? ` (${moved} file${moved === 1 ? '' : 's'})` : '';
  return ok(`renamed ${src} -> ${dstPath}${suffix} @ ${shortSha(outcome.commit.sha)}\n`);
};
