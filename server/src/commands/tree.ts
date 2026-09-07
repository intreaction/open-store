import { ShellError } from '../errors.js';
import { parseFlags } from '../shell/argv.js';
import { normalizePath } from '../shell/paths.js';
import { snapshot } from '../store/view.js';
import { ok, withFlagErrors, type CommandRun } from './common.js';

/** `tree [path] [-L N]` — the classic rendering, summary line included. */
export const tree: CommandRun = async (ctx, argv) => {
  const args = withFlagErrors('tree', () => parseFlags(argv, { '-L': 'value', '-a': 'bool' }));
  if (args.positional.length > 1) {
    throw new ShellError(`tree: too many arguments`);
  }
  const raw = args.positional[0] ?? '.';
  const start = normalizePath('tree', raw);

  const depthRaw = args.value('-L');
  let maxDepth = Number.POSITIVE_INFINITY;
  if (depthRaw !== undefined) {
    if (!/^\d+$/.test(depthRaw) || Number(depthRaw) < 1) {
      throw new ShellError('tree: Invalid level, must be greater than 0.');
    }
    maxDepth = Number(depthRaw);
  }

  const { view } = await snapshot(ctx.store);
  if (view.hasFile(start)) {
    return ok(`${raw}\n\n0 directories, 1 file\n`);
  }
  if (!view.hasDir(start)) {
    throw new ShellError(`tree: ${raw}: No such file or directory`);
  }

  const lines: string[] = [raw === '' ? '.' : raw];
  let dirs = 0;
  let files = 0;

  const walk = (dir: string, prefix: string, depth: number): void => {
    if (depth > maxDepth) return;
    const children = view.children(dir);
    children.forEach((child, index) => {
      const last = index === children.length - 1;
      const branch = last ? '└── ' : '├── ';
      lines.push(`${prefix}${branch}${child.name}`);
      if (child.isDir) {
        dirs += 1;
        walk(child.path, `${prefix}${last ? '    ' : '│   '}`, depth + 1);
      } else {
        files += 1;
      }
    });
  };

  walk(start, '', 1);
  const dirWord = dirs === 1 ? 'directory' : 'directories';
  const fileWord = files === 1 ? 'file' : 'files';
  lines.push('', `${dirs} ${dirWord}, ${files} ${fileWord}`);
  return ok(`${lines.join('\n')}\n`);
};
