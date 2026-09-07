import { minimatch } from 'minimatch';
import { ShellError } from '../errors.js';
import { parseFlags } from '../shell/argv.js';
import { basename, normalizePath } from '../shell/paths.js';
import { snapshot } from '../store/view.js';
import { SEARCH_INCOMPLETE } from '../limits.js';
import { ok, withFlagErrors, type CommandRun } from './common.js';

/** `find [path] [-name PATTERN] [-iname PATTERN] [-type f|d] [-maxdepth N]` */
export const find: CommandRun = async (ctx, argv) => {
  const args = withFlagErrors('find', () =>
    parseFlags(argv, {
      '-name': 'value',
      '-iname': 'value',
      '-type': 'value',
      '-maxdepth': 'value'
    })
  );

  if (args.positional.length > 1) {
    throw new ShellError(`find: paths must precede expression: '${args.positional[1]}'`);
  }
  const raw = args.positional[0] ?? '.';
  const start = normalizePath('find', raw);

  const type = args.value('-type');
  if (type !== undefined && type !== 'f' && type !== 'd') {
    throw new ShellError(`find: Unknown argument to -type: ${type}`);
  }

  const maxdepthRaw = args.value('-maxdepth');
  let maxdepth = Number.POSITIVE_INFINITY;
  if (maxdepthRaw !== undefined) {
    if (!/^\d+$/.test(maxdepthRaw)) {
      throw new ShellError(`find: invalid argument '${maxdepthRaw}' to '-maxdepth'`);
    }
    maxdepth = Number(maxdepthRaw);
  }

  const name = args.value('-name');
  const iname = args.value('-iname');

  const { view } = await snapshot(ctx.store);
  if (!view.exists(start)) {
    throw new ShellError(`find: '${raw}': No such file or directory`);
  }

  const prefix = start === '' ? '' : `${start}/`;
  const candidates: { path: string; isDir: boolean }[] = [{ path: start, isDir: view.hasDir(start) }];
  if (view.hasDir(start)) {
    for (const dir of view.dirs) {
      if (dir !== start && (prefix === '' || dir.startsWith(prefix))) {
        candidates.push({ path: dir, isDir: true });
      }
    }
    for (const file of view.files.values()) {
      if (prefix === '' || file.path.startsWith(prefix)) {
        candidates.push({ path: file.path, isDir: false });
      }
    }
  }
  candidates.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const display = (path: string): string => {
    if (path === start) return raw === '' ? '.' : raw.replace(/\/$/, '') || '.';
    if (start === '') return raw === '.' ? `./${path}` : path;
    const tail = path.slice(prefix.length);
    return `${raw.replace(/\/$/, '')}/${tail}`;
  };

  const out: string[] = [];
  for (const candidate of candidates) {
    const depth =
      candidate.path === start
        ? 0
        : (start === '' ? candidate.path : candidate.path.slice(prefix.length)).split('/').length;
    if (depth > maxdepth) continue;
    if (type === 'f' && candidate.isDir) continue;
    if (type === 'd' && !candidate.isDir) continue;
    const base = candidate.path === '' ? '.' : basename(candidate.path);
    if (name !== undefined && !minimatch(base, name, { dot: false })) continue;
    if (iname !== undefined && !minimatch(base, iname, { dot: false, nocase: true })) continue;
    out.push(display(candidate.path));
  }

  if (view.truncated) out.push(SEARCH_INCOMPLETE);
  return ok(out.length > 0 ? `${out.join('\n')}\n` : '');
};
