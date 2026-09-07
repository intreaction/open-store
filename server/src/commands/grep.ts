import { ShellError } from '../errors.js';
import { parseFlags } from '../shell/argv.js';
import { normalizePath } from '../shell/paths.js';
import { snapshot } from '../store/view.js';
import { SEARCH_INCOMPLETE } from '../limits.js';
import { bodyLines, withFlagErrors, type CommandRun } from './common.js';

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `grep [-r|-R] [-i] [-n] [-l] [-c] [-w] [-F] [-e PATTERN] PATTERN [path...]`
 *
 * Patterns are always fixed strings (`-F` is the default and is accepted for
 * familiarity). Directories are searched recursively; `-r`/`-R` are accepted.
 */
export const grep: CommandRun = async (ctx, argv) => {
  const args = withFlagErrors('grep', () =>
    parseFlags(argv, {
      '-r': 'bool',
      '-R': 'bool',
      '-i': 'bool',
      '-n': 'bool',
      '-l': 'bool',
      '-c': 'bool',
      '-w': 'bool',
      '-F': 'bool',
      '-e': 'values'
    })
  );

  const explicit = args.list('-e');
  const positional = [...args.positional];
  const patterns = explicit.length > 0 ? explicit : positional.splice(0, 1);
  if (patterns.length === 0 || patterns[0] === undefined) {
    throw new ShellError('grep: missing pattern');
  }

  const ignoreCase = args.bool('-i');
  const word = args.bool('-w');
  const matchers = patterns.map((pattern) => {
    const body = escapeRegex(pattern);
    const source = word ? `(?<![A-Za-z0-9_])${body}(?![A-Za-z0-9_])` : body;
    return new RegExp(source, ignoreCase ? 'i' : '');
  });
  const matches = (line: string): boolean => matchers.some((re) => re.test(line));

  const { view } = await snapshot(ctx.store);

  const targets: string[] = [];
  const operands = positional.length > 0 ? positional : ['.'];
  for (const raw of operands) {
    const path = normalizePath('grep', raw);
    if (view.hasFile(path)) {
      targets.push(path);
      continue;
    }
    if (view.hasDir(path)) {
      for (const file of view.under(path)) targets.push(file.path);
      continue;
    }
    throw new ShellError(`grep: ${raw}: No such file or directory`);
  }

  const showLineNumbers = args.bool('-n');
  const onlyNames = args.bool('-l');
  const countOnly = args.bool('-c');

  const out: string[] = [];
  let total = 0;
  for (const path of [...new Set(targets)].sort()) {
    const entry = view.file(path);
    if (!entry) continue;
    const content = await ctx.store.readBlob(entry.sha);
    const lines = bodyLines(content);
    let count = 0;
    const hits: string[] = [];
    lines.forEach((line, index) => {
      if (!matches(line)) return;
      count += 1;
      total += 1;
      if (onlyNames || countOnly) return;
      hits.push(showLineNumbers ? `${path}:${index + 1}:${line}` : `${path}:${line}`);
    });
    if (count === 0) {
      if (countOnly) out.push(`${path}:0`);
      continue;
    }
    if (onlyNames) out.push(path);
    else if (countOnly) out.push(`${path}:${count}`);
    else out.push(...hits);
  }

  if (total === 0) {
    return { stdout: 'grep: no matches\n', exitCode: 1 };
  }
  if (view.truncated) out.push(SEARCH_INCOMPLETE);
  return { stdout: `${out.join('\n')}\n`, exitCode: 0 };
};
