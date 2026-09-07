import { Octokit } from '@octokit/rest';
import { base64ToUtf8, utf8ToBase64 } from '../bytes.js';
import type { Config } from '../config.js';
import { RefConflictError, ShellError } from '../errors.js';
import type {
  CommitDetail,
  CommitInfo,
  CommitInput,
  HeadInfo,
  LogOptions,
  Store,
  TreeEntry,
  TreeResult
} from './types.js';

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

/**
 * The real store: a branch of a GitHub repository, reached through the Git Data
 * API. One instance serves exactly one tool call. Nothing is cached beyond it.
 */
export class GitHubStore implements Store {
  readonly owner: string;
  readonly repo: string;

  private readonly octokit: Octokit;
  private readonly configuredBranch: string | undefined;
  /** Memoised for the lifetime of this one tool call only. */
  private headPromise: Promise<HeadInfo> | undefined;
  private branchPromise: Promise<string> | undefined;

  constructor(config: Config, octokit?: Octokit) {
    this.owner = config.owner;
    this.repo = config.repo;
    this.configuredBranch = config.branch;
    this.octokit =
      octokit ??
      new Octokit({
        auth: config.token,
        ...(config.apiUrl ? { baseUrl: config.apiUrl } : {}),
        userAgent: `openstore/${config.client}`,
        // The operator never sees traffic details: no request logging at all.
        log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
      });
  }

  private get slug(): string {
    return `${this.owner}/${this.repo}`;
  }

  private async branch(): Promise<string> {
    if (this.configuredBranch) return this.configuredBranch;
    this.branchPromise ??= (async () => {
      try {
        const { data } = await this.octokit.rest.repos.get({ owner: this.owner, repo: this.repo });
        return data.default_branch;
      } catch (error) {
        throw this.repoError(error);
      }
    })();
    return this.branchPromise;
  }

  private repoError(error: unknown): Error {
    const status = statusOf(error);
    if (status === 404) {
      return new ShellError(`openstore: ${this.slug}: repository not found (or the token cannot see it)`);
    }
    if (status === 401 || status === 403) {
      return new ShellError(`openstore: ${this.slug}: Permission denied (check OPENSTORE_TOKEN scopes)`);
    }
    if (status === 429) {
      return new ShellError('openstore: GitHub rate limit reached, try again shortly');
    }
    const message = error instanceof Error ? error.message : String(error);
    return new ShellError(`openstore: ${this.slug}: ${message}`);
  }

  async head(): Promise<HeadInfo> {
    this.headPromise ??= (async () => {
      const branch = await this.branch();
      let commitSha: string;
      try {
        const { data } = await this.octokit.rest.git.getRef({
          owner: this.owner,
          repo: this.repo,
          ref: `heads/${branch}`
        });
        commitSha = data.object.sha;
      } catch (error) {
        if (statusOf(error) === 404) {
          throw new ShellError(`openstore: ${this.slug}: branch ${branch} not found`);
        }
        throw this.repoError(error);
      }
      try {
        const { data } = await this.octokit.rest.git.getCommit({
          owner: this.owner,
          repo: this.repo,
          commit_sha: commitSha
        });
        return { branch, commit: commitSha, tree: data.tree.sha };
      } catch (error) {
        throw this.repoError(error);
      }
    })();
    return this.headPromise;
  }

  async tree(treeSha: string): Promise<TreeResult> {
    try {
      const { data } = await this.octokit.rest.git.getTree({
        owner: this.owner,
        repo: this.repo,
        tree_sha: treeSha,
        recursive: 'true'
      });
      const entries: TreeEntry[] = [];
      for (const item of data.tree) {
        if (!item.path || !item.sha) continue;
        if (item.type !== 'blob' && item.type !== 'tree') continue;
        const entry: TreeEntry = { path: item.path, type: item.type, sha: item.sha };
        if (typeof item.size === 'number') entry.size = item.size;
        entries.push(entry);
      }
      return { entries, truncated: data.truncated === true };
    } catch (error) {
      throw this.repoError(error);
    }
  }

  async readBlob(sha: string): Promise<string> {
    try {
      const { data } = await this.octokit.rest.git.getBlob({
        owner: this.owner,
        repo: this.repo,
        file_sha: sha
      });
      if (data.encoding === 'base64') {
        return base64ToUtf8(data.content);
      }
      return data.content;
    } catch (error) {
      throw this.repoError(error);
    }
  }

  async commit(input: CommitInput): Promise<CommitInfo> {
    const branch = await this.branch();
    const parentCommit = await this.octokit.rest.git
      .getCommit({ owner: this.owner, repo: this.repo, commit_sha: input.parent })
      .catch((error: unknown) => {
        throw this.repoError(error);
      });

    const treeEntries: {
      path: string;
      mode: '100644';
      type: 'blob';
      sha?: string | null;
    }[] = [];

    for (const change of input.changes) {
      if (change.content === null) {
        treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: null });
        continue;
      }
      const { data: blob } = await this.octokit.rest.git
        .createBlob({
          owner: this.owner,
          repo: this.repo,
          content: utf8ToBase64(change.content),
          encoding: 'base64'
        })
        .catch((error: unknown) => {
          throw this.repoError(error);
        });
      treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    let treeSha: string;
    try {
      const { data } = await this.octokit.rest.git.createTree({
        owner: this.owner,
        repo: this.repo,
        base_tree: parentCommit.data.tree.sha,
        tree: treeEntries
      });
      treeSha = data.sha;
    } catch (error) {
      throw this.repoError(error);
    }

    let created: { sha: string; message: string; author: { name: string; email: string; date: string } };
    try {
      const { data } = await this.octokit.rest.git.createCommit({
        owner: this.owner,
        repo: this.repo,
        message: input.message,
        tree: treeSha,
        parents: [input.parent]
      });
      created = {
        sha: data.sha,
        message: data.message,
        author: {
          name: data.author?.name ?? '',
          email: data.author?.email ?? '',
          date: data.author?.date ?? new Date().toISOString()
        }
      };
    } catch (error) {
      throw this.repoError(error);
    }

    try {
      await this.octokit.rest.git.updateRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${branch}`,
        sha: created.sha,
        force: false
      });
    } catch (error) {
      const status = statusOf(error);
      if (status === 422 || status === 409) {
        throw new RefConflictError('ref update rejected: branch advanced');
      }
      throw this.repoError(error);
    }

    return {
      sha: created.sha,
      message: created.message,
      authorName: created.author.name,
      authorEmail: created.author.email,
      date: created.author.date
    };
  }

  async log(options: LogOptions): Promise<CommitInfo[]> {
    try {
      const { data } = await this.octokit.rest.repos.listCommits({
        owner: this.owner,
        repo: this.repo,
        sha: await this.branch(),
        per_page: Math.min(Math.max(options.limit, 1), 100),
        ...(options.path ? { path: options.path } : {}),
        ...(options.author ? { author: options.author } : {}),
        ...(options.since ? { since: options.since } : {})
      });
      return data.slice(0, options.limit).map((item) => ({
        sha: item.sha,
        message: item.commit.message,
        authorName: item.commit.author?.name ?? item.author?.login ?? 'unknown',
        authorEmail: item.commit.author?.email ?? '',
        date: item.commit.author?.date ?? item.commit.committer?.date ?? ''
      }));
    } catch (error) {
      throw this.repoError(error);
    }
  }

  async commitDetail(ref: string): Promise<CommitDetail> {
    try {
      const { data } = await this.octokit.rest.repos.getCommit({
        owner: this.owner,
        repo: this.repo,
        ref
      });
      return {
        sha: data.sha,
        message: data.commit.message,
        authorName: data.commit.author?.name ?? data.author?.login ?? 'unknown',
        authorEmail: data.commit.author?.email ?? '',
        date: data.commit.author?.date ?? data.commit.committer?.date ?? '',
        parents: data.parents.map((p) => p.sha),
        tree: data.commit.tree.sha
      };
    } catch (error) {
      if (statusOf(error) === 404 || statusOf(error) === 422) {
        throw new ShellError(`fatal: bad object ${ref}`);
      }
      throw this.repoError(error);
    }
  }

  async lastCommitDate(path: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.repos.listCommits({
        owner: this.owner,
        repo: this.repo,
        sha: await this.branch(),
        path,
        per_page: 1
      });
      const first = data[0];
      if (!first) return null;
      return first.commit.author?.date ?? first.commit.committer?.date ?? null;
    } catch {
      return null;
    }
  }
}
