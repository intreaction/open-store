/**
 * Live smoke test against a real store.
 *
 *   OPENSTORE_REPO=owner/name OPENSTORE_TOKEN=... npm run smoke
 *
 * It writes one throwaway file under `openstore-smoke/` and then reverts that
 * commit, so the store is left as it was (with two commits of evidence in the
 * history, which is the point: history is never rewritten).
 */
import { loadConfig } from '../src/config.js';
import { argvFor, type CommandResult } from '../src/commands/common.js';
import { toolByName } from '../src/commands/index.js';
import { GitHubStore } from '../src/store/github.js';
import { ShellError } from '../src/errors.js';

const config = loadConfig(process.env);
let failures = 0;

async function call(line: string, content?: string): Promise<CommandResult> {
  const space = line.indexOf(' ');
  const name = space === -1 ? line : line.slice(0, space);
  const args = space === -1 ? '' : line.slice(space + 1);
  const tool = toolByName(name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  try {
    // A fresh store per call: exactly what the server does.
    const store = new GitHubStore(config);
    return await tool.run({ store, client: config.client }, argvFor(name, args), content);
  } catch (error) {
    if (error instanceof ShellError) return { stdout: `${error.message}\n`, exitCode: error.exitCode };
    throw error;
  }
}

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    process.stdout.write(`ok   ${label}\n`);
    return;
  }
  failures += 1;
  process.stdout.write(`FAIL ${label}${detail ? `\n     ${detail.split('\n').join('\n     ')}` : ''}\n`);
}

async function main(): Promise<void> {
  const marker = `openstore-smoke-${Date.now()}`;
  const path = `openstore-smoke/${marker}.md`;

  const pwd = await call('pwd');
  check(
    'pwd names the store',
    pwd.exitCode === 0 && pwd.stdout.startsWith('/\n# store: ') && pwd.stdout.includes(`${config.owner}/${config.repo}@`),
    pwd.stdout
  );

  const tree = await call('tree -L 2');
  check('tree renders a summary line', /\d+ director(y|ies), \d+ files?\n$/.test(tree.stdout), tree.stdout.slice(-200));

  const grepBefore = await call(`grep -ril ${marker}`);
  check('grep finds nothing before the write', grepBefore.exitCode === 1, grepBefore.stdout);

  const body = `# Smoke test\n\nMarker: ${marker}\nWritten by scripts/smoke.ts; safe to delete.\n`;
  const write = await call(`write -m "smoke test ${marker}" ${path}`, body);
  check(
    'write reports the path, the delta and the new sha',
    new RegExp(`^wrote ${path} \\(\\+4 -0\\) @ [0-9a-f]{7}\n$`).test(write.stdout),
    write.stdout
  );
  const writeSha = /@ ([0-9a-f]{7})/.exec(write.stdout)?.[1] ?? '';

  const grep = await call(`grep -rn ${marker}`);
  check('grep finds the new file', grep.exitCode === 0 && grep.stdout.includes(`${path}:3:`), grep.stdout);

  const cat = await call(`cat ${path}`);
  check('cat returns exactly what was written', cat.stdout === body, cat.stdout);

  const log = await call('git_log --oneline -n 1');
  check('git_log shows the write on top', log.stdout.startsWith(`${writeSha} smoke test ${marker}`), log.stdout);

  const show = await call(`git_show ${writeSha}`);
  check(
    'git_show prints the header and the new-file diff',
    show.stdout.includes(`diff --git a/${path} b/${path}`) &&
      show.stdout.includes('new file mode 100644') &&
      show.stdout.includes(`+Marker: ${marker}`),
    show.stdout.slice(0, 400)
  );

  const revert = await call(`git_revert ${writeSha}`);
  check(
    'git_revert makes a new commit',
    new RegExp(`^reverted ${writeSha} "smoke test ${marker}" @ [0-9a-f]{7}\n$`).test(revert.stdout),
    revert.stdout
  );

  const after = await call(`cat ${path}`);
  check(
    'the file is gone again',
    after.exitCode === 1 && after.stdout === `cat: ${path}: No such file or directory\n`,
    after.stdout
  );

  const history = await call('git_log --oneline -n 2');
  check('history keeps both commits', history.stdout.split('\n').filter(Boolean).length === 2, history.stdout);

  process.stdout.write(failures === 0 ? '\nsmoke: all checks passed\n' : `\nsmoke: ${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`smoke: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
