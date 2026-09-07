import { ShellError } from '../errors.js';
import { parseFlags } from '../shell/argv.js';
import { normalizePath } from '../shell/paths.js';
import type { LogOptions } from '../store/types.js';
import { gitDate, ok, shortSha, subjectOf, withFlagErrors, type CommandRun } from './common.js';

/** `git_log [--oneline] [-n N | -N] [--author=X] [--since=DATE] [-- path]` */
export const gitLog: CommandRun = async (ctx, argv) => {
  const args = withFlagErrors('git_log', () =>
    parseFlags(
      argv,
      {
        '--oneline': 'bool',
        '-n': 'value',
        '--author': 'value',
        '--since': 'value',
        '--max-count': 'value'
      },
      { pathspec: true, numeric: '-n' }
    )
  );

  // The documented default is `--oneline -20`.
  const oneline = args.bool('--oneline') || argv.length === 0;
  const limitRaw = args.value('-n', '--max-count') ?? '20';
  if (!/^\d+$/.test(limitRaw) || Number(limitRaw) === 0) {
    throw new ShellError(`fatal: invalid number of commits: '${limitRaw}'`);
  }

  const paths = [...args.pathspec, ...args.positional];
  if (paths.length > 1) {
    throw new ShellError(`fatal: too many paths: '${paths[1]}'`);
  }

  const options: LogOptions = { limit: Number(limitRaw) };
  const author = args.value('--author');
  if (author) options.author = author;
  const since = args.value('--since');
  if (since) options.since = since;
  if (paths[0] !== undefined) options.path = normalizePath('git_log', paths[0]);

  const commits = await ctx.store.log(options);
  if (commits.length === 0) return ok('');

  if (oneline) {
    return ok(`${commits.map((c) => `${shortSha(c.sha)} ${subjectOf(c.message)}`).join('\n')}\n`);
  }

  const blocks = commits.map((commit) => {
    const who = commit.authorEmail
      ? `${commit.authorName} <${commit.authorEmail}>`
      : commit.authorName;
    const body = commit.message
      .replace(/\s+$/, '')
      .split('\n')
      .map((line) => (line === '' ? '' : `    ${line}`))
      .join('\n');
    return [
      `commit ${commit.sha}`,
      `Author: ${who}`,
      `Date:   ${gitDate(commit.date)}`,
      '',
      body
    ].join('\n');
  });

  return ok(`${blocks.join('\n\n')}\n`);
};
