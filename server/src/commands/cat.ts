import { ShellError } from '../errors.js';
import { parseFlags } from '../shell/argv.js';
import { snapshot } from '../store/view.js';
import { bodyLines, ok, readVisibleFile, withFlagErrors, type CommandRun } from './common.js';

/** `cat [-n] path...` */
export const cat: CommandRun = async (ctx, argv) => {
  const args = withFlagErrors('cat', () => parseFlags(argv, { '-n': 'bool' }));
  if (args.positional.length === 0) {
    throw new ShellError('cat: missing file operand');
  }

  const { view } = await snapshot(ctx.store);
  const numbered = args.bool('-n');
  const out: string[] = [];
  let lineNo = 0;

  for (const raw of args.positional) {
    const { content } = await readVisibleFile(ctx.store, view, 'cat', raw);
    if (!numbered) {
      out.push(content.endsWith('\n') || content === '' ? content : `${content}\n`);
      continue;
    }
    for (const line of bodyLines(content)) {
      lineNo += 1;
      out.push(`${String(lineNo).padStart(6)}\t${line}\n`);
    }
  }

  return ok(out.join(''));
};
