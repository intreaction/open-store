import { ShellError } from '../errors.js';
import { parseFlags } from '../shell/argv.js';
import { snapshot } from '../store/view.js';
import { bodyLines, ok, readVisibleFile, withFlagErrors, type CommandRun } from './common.js';

/** Shared implementation of `head` and `tail`. */
export function makeHeadTail(cmd: 'head' | 'tail'): CommandRun {
  return async (ctx, argv) => {
    const args = withFlagErrors(cmd, () =>
      parseFlags(argv, { '-n': 'value' }, { numeric: '-n' })
    );
    const raw = args.value('-n') ?? '10';
    if (!/^\d+$/.test(raw)) {
      throw new ShellError(`${cmd}: invalid number of lines: '${raw}'`);
    }
    const count = Number(raw);
    if (args.positional.length === 0) {
      throw new ShellError(`${cmd}: missing file operand`);
    }

    const { view } = await snapshot(ctx.store);
    const blocks: string[] = [];
    for (const operand of args.positional) {
      const { content } = await readVisibleFile(ctx.store, view, cmd, operand);
      const lines = bodyLines(content);
      const slice = cmd === 'head' ? lines.slice(0, count) : lines.slice(Math.max(0, lines.length - count));
      const body = slice.length > 0 ? `${slice.join('\n')}\n` : '';
      blocks.push(args.positional.length > 1 ? `==> ${operand} <==\n${body}` : body);
    }
    return ok(blocks.join('\n'));
  };
}

export const head: CommandRun = makeHeadTail('head');
