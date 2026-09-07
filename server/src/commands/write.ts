import { utf8Length } from '../bytes.js';
import { ShellError } from '../errors.js';
import { MAX_FILE_BYTES } from '../limits.js';
import { parseFlags } from '../shell/argv.js';
import { normalizeWritablePath } from '../shell/paths.js';
import { snapshot } from '../store/view.js';
import {
  commitCycle,
  countLines,
  ok,
  shortSha,
  withFlagErrors,
  type CommandRun
} from './common.js';

/** `write [-m MESSAGE] [-a] path` plus a `content` string. One commit. */
export const write: CommandRun = async (ctx, argv, content) => {
  const args = withFlagErrors('write', () => parseFlags(argv, { '-m': 'value', '-a': 'bool' }));
  const raw = args.positional[0];
  if (raw === undefined) {
    throw new ShellError('write: missing file operand');
  }
  if (args.positional.length > 1) {
    throw new ShellError(`write: too many arguments: '${args.positional[1]}'`);
  }
  if (content === undefined) {
    throw new ShellError('write: missing content');
  }

  const path = normalizeWritablePath('write', raw);
  const append = args.bool('-a');

  // Cheap pre-check so an oversized body never reaches the network.
  if (utf8Length(content) > MAX_FILE_BYTES) {
    throw new ShellError(`write: ${raw}: file too large (max ${MAX_FILE_BYTES / 1024} KiB)`);
  }

  const first = await snapshot(ctx.store);
  const existing = first.view.hasFile(path)
    ? await ctx.store.readBlob(first.view.file(path)!.sha)
    : null;
  if (existing === null && first.view.hasDir(path)) {
    throw new ShellError(`write: ${raw}: Is a directory`);
  }

  const compose = (current: string | null): string => {
    if (!append) return content;
    if (current === null || current === '') return content;
    return current.endsWith('\n') ? `${current}${content}` : `${current}\n${content}`;
  };

  const nextFirst = compose(existing);
  if (existing !== null && nextFirst === existing) {
    return ok(`wrote ${path} (+0 -0) @ ${shortSha(first.head.commit)} (unchanged)\n`);
  }

  let delta = { added: 0, removed: 0 };
  const subject = args.value('-m') ?? `write ${path}`;

  const outcome = await commitCycle(ctx, subject, async (snap) => {
    const entry = snap.view.file(path);
    if (!entry && snap.view.hasDir(path)) {
      throw new ShellError(`write: ${raw}: Is a directory`);
    }
    const current = entry ? await ctx.store.readBlob(entry.sha) : null;
    const next = compose(current);
    if (utf8Length(next) > MAX_FILE_BYTES) {
      throw new ShellError(`write: ${raw}: file too large (max ${MAX_FILE_BYTES / 1024} KiB)`);
    }
    delta = countLines(current ?? '', next);
    return [{ path, content: next }];
  });

  return ok(
    `wrote ${path} (+${delta.added} -${delta.removed}) @ ${shortSha(outcome.commit.sha)}\n`
  );
};
