import type { Octokit } from '@octokit/rest';
import { describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { RefConflictError, ShellError } from '../src/errors.js';
import { GitHubStore } from '../src/store/github.js';

const CONFIG: Config = {
  owner: 'intreaction',
  repo: 'my-openstore',
  token: 'not-a-real-token',
  readOnly: false,
  client: 'openstore-test'
};

interface Recorded {
  name: string;
  params: Record<string, unknown>;
}

function fakeOctokit(overrides: Record<string, unknown> = {}) {
  const calls: Recorded[] = [];
  const record =
    (name: string, result: unknown) =>
    async (params: Record<string, unknown> = {}) => {
      calls.push({ name, params });
      const override = overrides[name];
      if (typeof override === 'function') return (override as (p: unknown) => unknown)(params);
      return result;
    };

  const octokit = {
    rest: {
      repos: {
        get: record('repos.get', { data: { default_branch: 'main' } }),
        listCommits: record('repos.listCommits', { data: [] }),
        getCommit: record('repos.getCommit', {
          data: {
            sha: 'c'.repeat(40),
            commit: {
              message: 'seed store',
              author: { name: 'John Wheeler', email: 'john@example.com', date: '2026-09-06T12:00:00Z' },
              tree: { sha: 't'.repeat(40) }
            },
            parents: [],
            author: { login: 'intreaction' }
          }
        })
      },
      git: {
        getRef: record('git.getRef', { data: { object: { sha: 'a'.repeat(40) } } }),
        getCommit: record('git.getCommit', { data: { tree: { sha: 't'.repeat(40) } } }),
        getTree: record('git.getTree', {
          data: {
            truncated: false,
            tree: [
              { path: 'home', type: 'tree', sha: 'd'.repeat(40) },
              { path: 'home/network.md', type: 'blob', sha: 'b'.repeat(40), size: 42 },
              { path: 'notes.pdf', type: 'blob', sha: 'e'.repeat(40), size: 9 }
            ]
          }
        }),
        getBlob: record('git.getBlob', {
          data: { encoding: 'base64', content: Buffer.from('# Network\n').toString('base64') }
        }),
        createBlob: record('git.createBlob', { data: { sha: 'f'.repeat(40) } }),
        createTree: record('git.createTree', { data: { sha: '1'.repeat(40) } }),
        createCommit: record('git.createCommit', {
          data: {
            sha: '2'.repeat(40),
            message: 'write home/network.md',
            author: { name: 'John Wheeler', email: 'john@example.com', date: '2026-09-06T12:05:00Z' }
          }
        }),
        updateRef: record('git.updateRef', { data: {} })
      }
    }
  };
  return { octokit: octokit as unknown as Octokit, calls };
}

const httpError = (status: number) => {
  const error = new Error(`HTTP ${status}`) as Error & { status: number };
  error.status = status;
  return error;
};

describe('GitHubStore', () => {
  it('resolves head through ref -> commit, using the default branch', async () => {
    const { octokit, calls } = fakeOctokit();
    const store = new GitHubStore(CONFIG, octokit);
    const head = await store.head();
    expect(head).toEqual({ branch: 'main', commit: 'a'.repeat(40), tree: 't'.repeat(40) });
    expect(calls.map((c) => c.name)).toEqual(['repos.get', 'git.getRef', 'git.getCommit']);
    expect(calls[1]!.params).toMatchObject({ ref: 'heads/main' });

    // Memoised for this one call only.
    await store.head();
    expect(calls.filter((c) => c.name === 'git.getRef')).toHaveLength(1);
  });

  it('uses the configured branch without asking for the repo', async () => {
    const { octokit, calls } = fakeOctokit();
    const store = new GitHubStore({ ...CONFIG, branch: 'notes' }, octokit);
    expect((await store.head()).branch).toBe('notes');
    expect(calls.map((c) => c.name)).not.toContain('repos.get');
    expect(calls[0]!.params).toMatchObject({ ref: 'heads/notes' });
  });

  it('reads the recursive tree and decodes blobs', async () => {
    const { octokit, calls } = fakeOctokit();
    const store = new GitHubStore(CONFIG, octokit);
    const tree = await store.tree('t'.repeat(40));
    expect(calls[0]!.params).toMatchObject({ tree_sha: 't'.repeat(40), recursive: 'true' });
    expect(tree.truncated).toBe(false);
    expect(tree.entries).toHaveLength(3);
    expect(await store.readBlob('b'.repeat(40))).toBe('# Network\n');
  });

  it('commits blob -> tree(base_tree) -> commit(parent) -> updateRef(force false)', async () => {
    const { octokit, calls } = fakeOctokit();
    const store = new GitHubStore(CONFIG, octokit);
    const commit = await store.commit({
      parent: 'a'.repeat(40),
      message: 'write home/network.md\n\nOpenStore-Client: openstore-test\n',
      changes: [
        { path: 'home/network.md', content: '# Network\n' },
        { path: 'home/old.md', content: null }
      ]
    });

    expect(commit.sha).toBe('2'.repeat(40));
    const names = calls.map((c) => c.name);
    expect(names).toEqual([
      'repos.get',
      'git.getCommit',
      'git.createBlob',
      'git.createTree',
      'git.createCommit',
      'git.updateRef'
    ]);

    const createTree = calls.find((c) => c.name === 'git.createTree')!.params as {
      base_tree: string;
      tree: { path: string; sha: string | null; mode: string; type: string }[];
    };
    expect(createTree.base_tree).toBe('t'.repeat(40));
    expect(createTree.tree).toEqual([
      { path: 'home/network.md', mode: '100644', type: 'blob', sha: 'f'.repeat(40) },
      { path: 'home/old.md', mode: '100644', type: 'blob', sha: null }
    ]);

    expect(calls.find((c) => c.name === 'git.createCommit')!.params).toMatchObject({
      parents: ['a'.repeat(40)],
      tree: '1'.repeat(40)
    });
    expect(calls.find((c) => c.name === 'git.updateRef')!.params).toMatchObject({
      ref: 'heads/main',
      sha: '2'.repeat(40),
      force: false
    });
  });

  it('turns a rejected ref update into a RefConflictError', async () => {
    for (const status of [422, 409]) {
      const { octokit } = fakeOctokit({
        'git.updateRef': () => {
          throw httpError(status);
        }
      });
      const store = new GitHubStore(CONFIG, octokit);
      await expect(
        store.commit({ parent: 'a'.repeat(40), message: 'm', changes: [] })
      ).rejects.toBeInstanceOf(RefConflictError);
    }
  });

  it('reports missing repositories and branches in plain language', async () => {
    const { octokit } = fakeOctokit({
      'repos.get': () => {
        throw httpError(404);
      }
    });
    await expect(new GitHubStore(CONFIG, octokit).head()).rejects.toThrow(
      'openstore: intreaction/my-openstore: repository not found (or the token cannot see it)'
    );

    const missingBranch = fakeOctokit({
      'git.getRef': () => {
        throw httpError(404);
      }
    });
    await expect(new GitHubStore(CONFIG, missingBranch.octokit).head()).rejects.toThrow(
      'openstore: intreaction/my-openstore: branch main not found'
    );
  });

  it('reports a bad revision the way git does', async () => {
    const { octokit } = fakeOctokit({
      'repos.getCommit': () => {
        throw httpError(422);
      }
    });
    const store = new GitHubStore(CONFIG, octokit);
    await expect(store.commitDetail('deadbeef')).rejects.toBeInstanceOf(ShellError);
    await expect(store.commitDetail('deadbeef')).rejects.toThrow('fatal: bad object deadbeef');
  });
});
