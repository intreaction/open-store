import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/store/memory.js';
import { makeStore, out, run } from './helpers.js';

let store: MemoryStore;

beforeEach(() => {
  store = makeStore();
});

const short = async () => (await store.head()).commit.slice(0, 7);

describe('write', () => {
  it('creates a file, implicitly creating its folders', async () => {
    const text = await out(store, 'write people/alex.md', '# Alex\n\nWorks with John.\n');
    expect(text).toBe(`wrote people/alex.md (+3 -0) @ ${await short()}\n`);
    expect(store.snapshotFiles()['people/alex.md']).toBe('# Alex\n\nWorks with John.\n');
    expect(await out(store, 'ls people')).toBe('alex.md\n');
  });

  it('replaces a file and reports the line delta', async () => {
    const text = await out(
      store,
      'write home/network.md',
      '# Network\n\nGateway: UDM Pro Max\nReplaced an Amplifi Alien.\nUpgraded 2026.\n'
    );
    expect(text).toBe(`wrote home/network.md (+1 -0) @ ${await short()}\n`);
  });

  it('appends with -a', async () => {
    await out(store, 'write -a home/network.md', 'Wi-Fi 7 access points.\n');
    expect(store.snapshotFiles()['home/network.md']).toBe(
      '# Network\n\nGateway: UDM Pro Max\nReplaced an Amplifi Alien.\nWi-Fi 7 access points.\n'
    );
  });

  it('uses the given commit message and adds the client trailer', async () => {
    await out(store, 'write -m "Note the new gateway" home/network.md', '# Network\n\nUDM Pro Max\n');
    const detail = await store.commitDetail((await store.head()).commit);
    expect(detail.message).toBe('Note the new gateway\n\nOpenStore-Client: openstore-test\n');
  });

  it('defaults the commit message to write <path>', async () => {
    await out(store, 'write home/network.md', '# Network\n\nUDM Pro Max\n');
    const detail = await store.commitDetail((await store.head()).commit);
    expect(detail.message.split('\n')[0]).toBe('write home/network.md');
  });

  it('does not commit when nothing changed', async () => {
    const before = store.commitCount();
    const text = await out(
      store,
      'write home/network.md',
      '# Network\n\nGateway: UDM Pro Max\nReplaced an Amplifi Alien.\n'
    );
    expect(text).toContain('(+0 -0)');
    expect(text).toContain('(unchanged)');
    expect(store.commitCount()).toBe(before);
  });

  it('refuses paths that are not text files, and paths outside the store', async () => {
    expect((await run(store, 'write notes.pdf', 'x')).stdout).toBe(
      'write: notes.pdf: No such file or directory\n'
    );
    expect((await run(store, 'write ../escape.md', 'x')).stdout).toBe(
      'write: ../escape.md: Permission denied\n'
    );
    expect((await run(store, 'write .github/ci.yml', 'x')).stdout).toBe(
      'write: .github/ci.yml: No such file or directory\n'
    );
  });

  it('refuses a directory and a missing operand', async () => {
    expect((await run(store, 'write home', 'x')).stdout).toBe(
      'write: home: No such file or directory\n'
    );
    expect((await run(store, 'write')).stdout).toBe('write: missing file operand\n');
  });

  it('enforces the 128 KiB file limit', async () => {
    const big = `${'x'.repeat(128 * 1024)}\n`;
    expect((await run(store, 'write big.md', big)).stdout).toBe(
      'write: big.md: file too large (max 128 KiB)\n'
    );
  });
});

describe('mv', () => {
  it('renames a file', async () => {
    const text = await out(store, 'mv home/network.md home/gateway.md');
    expect(text).toBe(`renamed home/network.md -> home/gateway.md @ ${await short()}\n`);
    const files = store.snapshotFiles();
    expect(files['home/network.md']).toBeUndefined();
    expect(files['home/gateway.md']).toContain('UDM Pro Max');
  });

  it('renames a directory', async () => {
    const text = await out(store, 'mv home house');
    expect(text).toBe(`renamed home -> house (1 file) @ ${await short()}\n`);
    expect(store.snapshotFiles()['house/network.md']).toContain('UDM Pro Max');
  });

  it('refuses to overwrite an existing destination', async () => {
    expect((await run(store, 'mv home/network.md README.md')).stdout).toBe(
      "mv: cannot move 'home/network.md' to 'README.md': File exists\n"
    );
  });

  it('reports a missing source and a missing operand', async () => {
    expect((await run(store, 'mv home/router.md home/x.md')).stdout).toBe(
      "mv: cannot stat 'home/router.md': No such file or directory\n"
    );
    expect((await run(store, 'mv home/network.md')).stdout).toBe(
      "mv: missing destination file operand after 'home/network.md'\n"
    );
    expect((await run(store, 'mv')).stdout).toBe('mv: missing file operand\n');
  });

  it('defaults the commit message', async () => {
    await out(store, 'mv home/network.md home/gateway.md');
    const detail = await store.commitDetail((await store.head()).commit);
    expect(detail.message.split('\n')[0]).toBe('mv home/network.md -> home/gateway.md');
  });
});

describe('rm', () => {
  it('removes one file', async () => {
    const text = await out(store, 'rm home/network.md');
    expect(text).toBe(`removed home/network.md @ ${await short()}\n`);
    expect(store.snapshotFiles()['home/network.md']).toBeUndefined();
  });

  it('removes several files at once', async () => {
    const text = await out(store, 'rm README.md profile/about.md');
    expect(text).toBe(
      `removed README.md\nremoved profile/about.md\n2 files removed @ ${await short()}\n`
    );
  });

  it('refuses a directory without -r', async () => {
    expect((await run(store, 'rm home')).stdout).toBe("rm: cannot remove 'home': Is a directory\n");
  });

  it('removes a directory with -r', async () => {
    await out(store, 'rm -r home');
    expect(store.snapshotFiles()['home/network.md']).toBeUndefined();
  });

  it('reports missing paths and a missing operand', async () => {
    expect((await run(store, 'rm home/router.md')).stdout).toBe(
      "rm: cannot remove 'home/router.md': No such file or directory\n"
    );
    expect((await run(store, 'rm')).stdout).toBe('rm: missing operand\n');
  });

  it('defaults the commit message', async () => {
    await out(store, 'rm home/network.md');
    const detail = await store.commitDetail((await store.head()).commit);
    expect(detail.message.split('\n')[0]).toBe('rm home/network.md');
  });
});

describe('git_revert', () => {
  it('reverses a commit with a new commit', async () => {
    await out(store, 'write home/network.md', '# Network\n\nGateway: something else\n');
    const bad = (await store.head()).commit;
    const text = await out(store, `git_revert ${bad.slice(0, 7)}`);
    expect(text).toBe(
      `reverted ${bad.slice(0, 7)} "write home/network.md" @ ${await short()}\n`
    );
    expect(store.snapshotFiles()['home/network.md']).toBe(
      '# Network\n\nGateway: UDM Pro Max\nReplaced an Amplifi Alien.\n'
    );
    expect(store.commitCount()).toBe(3);
  });

  it('restores a deleted file', async () => {
    await out(store, 'rm home/network.md');
    const bad = (await store.head()).commit;
    await out(store, `git_revert ${bad}`);
    expect(store.snapshotFiles()['home/network.md']).toContain('UDM Pro Max');
  });

  it('removes a file that the commit added', async () => {
    await out(store, 'write people/alex.md', '# Alex\n');
    const bad = (await store.head()).commit;
    await out(store, `git_revert ${bad}`);
    expect(store.snapshotFiles()['people/alex.md']).toBeUndefined();
  });

  it('uses the default revert message', async () => {
    await out(store, 'write -m "Update home gateway" home/network.md', '# Network\n\nx\n');
    const bad = (await store.head()).commit;
    await out(store, `git_revert ${bad}`);
    const detail = await store.commitDetail((await store.head()).commit);
    expect(detail.message.split('\n')[0]).toBe(
      `revert ${bad.slice(0, 7)}: Update home gateway`
    );
  });

  it('refuses when the file changed afterwards', async () => {
    await out(store, 'write home/network.md', '# Network\n\nfirst\n');
    const bad = (await store.head()).commit;
    await out(store, 'write home/network.md', '# Network\n\nsecond\n');
    expect((await run(store, `git_revert ${bad}`)).stdout).toBe(
      `error: could not revert ${bad.slice(0, 7)}: home/network.md has changed since that commit\n`
    );
  });

  it('reports a bad object', async () => {
    expect((await run(store, 'git_revert nope')).stdout).toBe('fatal: bad object nope\n');
    expect((await run(store, 'git_revert')).stdout).toBe('git_revert: missing commit\n');
  });
});

describe('concurrent writes', () => {
  it('retries the whole read-modify-commit cycle when the branch advanced', async () => {
    store.raceNext(1);
    const text = await out(store, 'write people/alex.md', '# Alex\n');
    expect(text).toBe(`wrote people/alex.md (+1 -0) @ ${await short()}\n`);
    const files = store.snapshotFiles();
    // The other writer's commit survived; ours went on top of it.
    expect(files['people/other-writer.md']).toContain('Other writer');
    expect(files['people/alex.md']).toBe('# Alex\n');
  });

  it('retries twice before succeeding', async () => {
    store.raceNext(2);
    await out(store, 'write people/alex.md', '# Alex\n');
    expect(store.snapshotFiles()['people/alex.md']).toBe('# Alex\n');
  });

  it('gives up after three attempts', async () => {
    store.raceAlways();
    const result = await run(store, 'write people/alex.md', '# Alex\n');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(
      'error: failed to push: branch advanced concurrently, retry\n'
    );
    expect(store.snapshotFiles()['people/alex.md']).toBeUndefined();
  });

  it('re-reads the file on retry so an append does not lose the other write', async () => {
    store.raceNext(1);
    await out(store, 'write -a home/network.md', 'Wi-Fi 7 access points.\n');
    expect(store.snapshotFiles()['home/network.md']).toBe(
      '# Network\n\nGateway: UDM Pro Max\nReplaced an Amplifi Alien.\nWi-Fi 7 access points.\n'
    );
  });
});
