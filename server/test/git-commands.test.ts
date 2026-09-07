import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.js';
import { makeStore, out, run } from './helpers.js';

let store: MemoryStore;
let seedSha: string;
let writeSha: string;

beforeEach(async () => {
  store = makeStore();
  seedSha = (await store.head()).commit;
  await out(
    store,
    'write -m "Update home gateway" home/network.md',
    '# Network\n\nGateway: UDM Pro Max (2026)\nReplaced an Amplifi Alien.\n'
  );
  writeSha = (await store.head()).commit;
});

describe('git_log', () => {
  it('defaults to --oneline -20', async () => {
    expect(await out(store, 'git_log')).toBe(
      `${writeSha.slice(0, 7)} Update home gateway\n${seedSha.slice(0, 7)} seed store\n`
    );
  });

  it('limits with -n and with git-style -N', async () => {
    expect(await out(store, 'git_log --oneline -n 1')).toBe(
      `${writeSha.slice(0, 7)} Update home gateway\n`
    );
    expect(await out(store, 'git_log --oneline -1')).toBe(
      `${writeSha.slice(0, 7)} Update home gateway\n`
    );
  });

  it('prints the full form when --oneline is not asked for', async () => {
    const text = await out(store, 'git_log -n 1');
    expect(text).toContain(`commit ${writeSha}`);
    expect(text).toContain('Author: John Wheeler <john@example.com>');
    expect(text).toMatch(/Date: {3}\w{3} \w{3} \d+ \d{2}:\d{2}:\d{2} 2026 \+0000/);
    expect(text).toContain('    Update home gateway');
    expect(text).toContain('    OpenStore-Client: openstore-test');
  });

  it('filters by path', async () => {
    expect(await out(store, 'git_log --oneline -- home/network.md')).toBe(
      `${writeSha.slice(0, 7)} Update home gateway\n${seedSha.slice(0, 7)} seed store\n`
    );
    expect(await out(store, 'git_log --oneline -- technology/computers.md')).toBe(
      `${seedSha.slice(0, 7)} seed store\n`
    );
  });

  it('filters by author and date', async () => {
    expect(await out(store, 'git_log --oneline --author=Wheeler -n 1')).toBe(
      `${writeSha.slice(0, 7)} Update home gateway\n`
    );
    expect(await out(store, 'git_log --oneline --since=2030-01-01')).toBe('');
  });

  it('rejects a bad count', async () => {
    expect((await run(store, 'git_log -n zero')).stdout).toBe(
      "fatal: invalid number of commits: 'zero'\n"
    );
  });
});

describe('git_show', () => {
  it('prints the commit header and a unified diff', async () => {
    const text = await out(store, `git_show ${writeSha}`);
    expect(text).toContain(`commit ${writeSha}`);
    expect(text).toContain('    Update home gateway');
    expect(text).toContain(
      [
        'diff --git a/home/network.md b/home/network.md',
        '--- a/home/network.md',
        '+++ b/home/network.md',
        '@@ -1,4 +1,4 @@',
        ' # Network',
        ' ',
        '-Gateway: UDM Pro Max',
        '+Gateway: UDM Pro Max (2026)',
        ' Replaced an Amplifi Alien.'
      ].join('\n')
    );
  });

  it('accepts an abbreviated sha and a pathspec', async () => {
    const text = await out(store, `git_show ${writeSha.slice(0, 7)} -- home`);
    expect(text).toContain('diff --git a/home/network.md b/home/network.md');
    expect(text).not.toContain('profile/about.md');
  });

  it('shows the root commit as new files, hiding invisible ones', async () => {
    const text = await out(store, `git_show ${seedSha}`);
    expect(text).toContain('diff --git a/CONTEXT.md b/CONTEXT.md');
    expect(text).toContain('new file mode 100644');
    expect(text).toContain('--- /dev/null');
    expect(text).not.toContain('notes.pdf');
    expect(text).not.toContain('ci.yml');
  });

  it('reports a bad object', async () => {
    expect((await run(store, 'git_show deadbeef')).stdout).toBe('fatal: bad object deadbeef\n');
    expect((await run(store, 'git_show')).stdout).toBe('git_show: missing commit\n');
  });
});

describe('git_diff', () => {
  it('diffs a commit against the head by default', async () => {
    const text = await out(store, `git_diff ${seedSha}`);
    expect(text).toContain('-Gateway: UDM Pro Max');
    expect(text).toContain('+Gateway: UDM Pro Max (2026)');
  });

  it('diffs two commits and honours a pathspec', async () => {
    expect(await out(store, `git_diff ${seedSha} ${writeSha} -- technology`)).toBe('');
    expect(await out(store, `git_diff ${writeSha} ${seedSha}`)).toContain(
      '-Gateway: UDM Pro Max (2026)'
    );
  });

  it('needs a commit', async () => {
    expect((await run(store, 'git_diff')).stdout).toBe('git_diff: missing commit\n');
  });
});
