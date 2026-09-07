import { ShellError } from '../errors.js';
import { parseFlags } from '../shell/argv.js';
import { normalizePath } from '../shell/paths.js';
import { snapshot, type StoreView } from '../store/view.js';
import type { Store } from '../store/types.js';
import { ok, shortDate, withFlagErrors, type CommandRun } from './common.js';

/** Cap on how many `ls -l` date lookups one call may make. */
const MAX_DATE_LOOKUPS = 200;

interface Row {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

async function dateFor(store: Store, path: string, budget: { left: number }): Promise<string | null> {
  if (budget.left <= 0) return null;
  budget.left -= 1;
  return store.lastCommitDate(path);
}

async function renderLong(store: Store, rows: Row[], budget: { left: number }): Promise<string[]> {
  const dates = await Promise.all(rows.map((row) => dateFor(store, row.path, budget)));
  const sizes = rows.map((row) => (row.isDir ? '-' : String(row.size)));
  const width = sizes.reduce((max, s) => Math.max(max, s.length), 1);
  return rows.map((row, i) => {
    const mode = row.isDir ? 'drwxr-xr-x' : '-rw-r--r--';
    const name = row.isDir ? `${row.name}/` : row.name;
    return `${mode}  ${sizes[i]!.padStart(width)}  ${shortDate(dates[i]!)}  ${name}`;
  });
}

function rowsFor(view: StoreView, dir: string): Row[] {
  return view.children(dir).map((child) => ({
    name: child.name,
    path: child.path,
    isDir: child.isDir,
    size: child.isDir ? 0 : view.file(child.path)?.size ?? 0
  }));
}

/** `ls [-l] [-a] [-R] [path...]` */
export const ls: CommandRun = async (ctx, argv) => {
  const args = withFlagErrors('ls', () =>
    parseFlags(argv, { '-l': 'bool', '-a': 'bool', '-R': 'bool', '-1': 'bool' })
  );
  const long = args.bool('-l');
  const recursive = args.bool('-R');
  const operands = args.positional.length > 0 ? args.positional : ['.'];

  const { view } = await snapshot(ctx.store);
  const budget = { left: MAX_DATE_LOOKUPS };

  const files: Row[] = [];
  const dirs: { raw: string; path: string }[] = [];
  for (const raw of operands) {
    const path = normalizePath('ls', raw);
    if (view.hasFile(path)) {
      const entry = view.file(path)!;
      files.push({ name: raw, path, isDir: false, size: entry.size });
      continue;
    }
    if (view.hasDir(path)) {
      dirs.push({ raw, path });
      continue;
    }
    throw new ShellError(`ls: ${raw}: No such file or directory`);
  }

  const blocks: string[] = [];
  if (files.length > 0) {
    const lines = long
      ? await renderLong(ctx.store, files, budget)
      : files.map((row) => row.name);
    blocks.push(lines.join('\n'));
  }

  const showHeaders = operands.length > 1 || recursive || files.length > 0;

  const emitDir = async (raw: string, path: string) => {
    const rows = rowsFor(view, path);
    const lines = long
      ? await renderLong(ctx.store, rows, budget)
      : rows.map((row) => (row.isDir ? `${row.name}/` : row.name));
    const header = showHeaders ? `${raw || '.'}:\n` : '';
    blocks.push(`${header}${lines.join('\n')}`);
    if (recursive) {
      for (const row of rows) {
        if (!row.isDir) continue;
        await emitDir(raw === '.' || raw === '' ? row.path : `${raw.replace(/\/$/, '')}/${row.name}`, row.path);
      }
    }
  };

  for (const dir of dirs) await emitDir(dir.raw, dir.path);

  const text = blocks.filter((b) => b.length > 0).join('\n\n');
  return ok(text === '' ? '' : `${text}\n`);
};
