/**
 * The slice of GitHub the hosted flow talks to, over plain `fetch` so it runs
 * unchanged on Workers. Tool calls do not come through here — they go through
 * `src/store/github.ts` — this is only the login, install and setup hand-offs.
 *
 * Nothing here is logged. Tokens are parameters and return values only.
 */

import { base64ToUtf8 } from '../bytes.js';

export const GITHUB_OAUTH_ORIGIN = 'https://github.com';
export const GITHUB_API_ORIGIN = 'https://api.github.com';
export const USER_AGENT = 'openstore-hosted';

export interface GitHubTokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Absolute expiry of the access token, seconds since the epoch. */
  expiresAt?: number;
}

export interface Installation {
  id: number;
  appId: number;
  accountLogin: string;
  accountType: string;
  /** `all` or `selected`. */
  repositorySelection: string;
}

export interface RepoRef {
  id: number;
  owner: string;
  name: string;
  defaultBranch: string | null;
  private: boolean;
}

export function fullName(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}

/** A GitHub call that failed. `message` is safe to show a user; it never carries a token. */
export class GitHubApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
  }
}

interface ApiOptions {
  apiOrigin?: string;
  method?: string;
  body?: unknown;
  /** Statuses to return `null` for instead of throwing. */
  nullOn?: number[];
}

async function api<T>(token: string, path: string, options: ApiOptions = {}): Promise<T | null> {
  const origin = options.apiOrigin ?? GITHUB_API_ORIGIN;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': USER_AGENT
  };
  const init: RequestInit = { method: options.method ?? 'GET', headers };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${origin}${path}`, init);
  if (options.nullOn?.includes(response.status)) return null;
  if (!response.ok) {
    let message = `GitHub returned ${response.status}`;
    try {
      const detail = (await response.json()) as { message?: unknown };
      if (typeof detail?.message === 'string' && detail.message.length < 300) {
        message = detail.message;
      }
    } catch {
      /* body was not JSON; the status alone is the message */
    }
    throw new GitHubApiError(response.status, message);
  }
  if (response.status === 204) return null;
  return (await response.json()) as T;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function postTokenEndpoint(
  params: Record<string, string>,
  oauthOrigin = GITHUB_OAUTH_ORIGIN
): Promise<GitHubTokenSet> {
  const response = await fetch(`${oauthOrigin}/login/oauth/access_token`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': USER_AGENT
    },
    body: new URLSearchParams(params).toString()
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !data.access_token) {
    // GitHub reports OAuth failures with HTTP 200 and an `error` field.
    throw new GitHubApiError(response.status === 200 ? 400 : response.status, 'GitHub sign-in failed');
  }
  const set: GitHubTokenSet = { accessToken: data.access_token };
  if (data.refresh_token) set.refreshToken = data.refresh_token;
  if (typeof data.expires_in === 'number' && data.expires_in > 0) {
    set.expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
  }
  return set;
}

/** Exchanges the `code` GitHub sent to `/callback` for a user-to-server token. */
export function exchangeCode(
  args: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  oauthOrigin?: string
): Promise<GitHubTokenSet> {
  return postTokenEndpoint(
    {
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      redirect_uri: args.redirectUri
    },
    oauthOrigin
  );
}

/** Trades a GitHub refresh token for a fresh user-to-server pair. */
export function refreshGitHubToken(
  args: { clientId: string; clientSecret: string; refreshToken: string },
  oauthOrigin?: string
): Promise<GitHubTokenSet> {
  return postTokenEndpoint(
    {
      client_id: args.clientId,
      client_secret: args.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: args.refreshToken
    },
    oauthOrigin
  );
}

interface RawInstallation {
  id: number;
  app_id: number;
  repository_selection?: string;
  account?: { login?: string; type?: string } | null;
}

interface RawRepo {
  id: number;
  name: string;
  default_branch?: string | null;
  private?: boolean;
  owner?: { login?: string } | null;
}

function toRepo(raw: RawRepo): RepoRef {
  return {
    id: raw.id,
    owner: raw.owner?.login ?? '',
    name: raw.name,
    defaultBranch: raw.default_branch ?? null,
    private: raw.private ?? false
  };
}

/** The authenticated user's login. */
export async function getViewerLogin(token: string, apiOrigin?: string): Promise<string> {
  const user = await api<{ login: string }>(token, '/user', { ...(apiOrigin ? { apiOrigin } : {}) });
  return user?.login ?? '';
}

/**
 * Installations of *our* App that this user can reach. Other apps the user has
 * installed are filtered out by `app_id`.
 */
export async function listInstallations(
  token: string,
  appId: number,
  apiOrigin?: string
): Promise<Installation[]> {
  const data = await api<{ installations?: RawInstallation[] }>(token, '/user/installations?per_page=100', {
    ...(apiOrigin ? { apiOrigin } : {})
  });
  return (data?.installations ?? [])
    // Fail closed. An `appId` that is not a real id matches nothing, so a
    // misconfigured deploy shows no installations rather than another App's.
    .filter((entry) => entry.app_id === appId)
    .map((entry) => ({
      id: entry.id,
      appId: entry.app_id,
      accountLogin: entry.account?.login ?? '',
      accountType: entry.account?.type ?? 'User',
      repositorySelection: entry.repository_selection ?? 'selected'
    }));
}

/** Repositories one installation grants this user, across pages. */
export async function listInstallationRepos(
  token: string,
  installationId: number,
  apiOrigin?: string
): Promise<RepoRef[]> {
  const repos: RepoRef[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const data = await api<{ repositories?: RawRepo[] }>(
      token,
      `/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
      { ...(apiOrigin ? { apiOrigin } : {}) }
    );
    const batch = data?.repositories ?? [];
    for (const raw of batch) repos.push(toRepo(raw));
    if (batch.length < 100) break;
  }
  return repos;
}

/** One repository, or `null` when the token cannot see it yet. */
export function getRepo(
  token: string,
  owner: string,
  name: string,
  apiOrigin?: string
): Promise<RepoRef | null> {
  return api<RawRepo>(token, `/repos/${owner}/${name}`, {
    ...(apiOrigin ? { apiOrigin } : {}),
    nullOn: [404]
  }).then((raw) => (raw ? toRepo(raw) : null));
}

/** True when the repository has a `CONTEXT.md` at the root of its default branch. */
export function hasContextFile(
  token: string,
  owner: string,
  name: string,
  apiOrigin?: string
): Promise<boolean> {
  return api<unknown>(token, `/repos/${owner}/${name}/contents/CONTEXT.md`, {
    ...(apiOrigin ? { apiOrigin } : {}),
    nullOn: [403, 404]
  })
    .then((data) => data !== null)
    .catch(() => false);
}

/**
 * `POST /repos/{template_owner}/{template_repo}/generate`. Documented as available
 * to GitHub App user access tokens; needs Administration (write) and Contents (read).
 */
export function generateFromTemplate(
  token: string,
  args: {
    templateOwner: string;
    templateRepo: string;
    owner: string;
    name: string;
    description?: string;
  },
  apiOrigin?: string
): Promise<RepoRef | null> {
  return api<RawRepo>(token, `/repos/${args.templateOwner}/${args.templateRepo}/generate`, {
    ...(apiOrigin ? { apiOrigin } : {}),
    method: 'POST',
    body: {
      owner: args.owner,
      name: args.name,
      description: args.description ?? 'My OpenStore: durable memory for my AI, as plain Markdown.',
      private: true,
      include_all_branches: false
    }
  }).then((raw) => (raw ? toRepo(raw) : null));
}

/**
 * `POST /user/repos`, the fallback when the template repository is unavailable.
 * Also available to user access tokens; needs Administration (write).
 */
export function createUserRepo(
  token: string,
  args: { name: string; description?: string },
  apiOrigin?: string
): Promise<RepoRef | null> {
  return api<RawRepo>(token, '/user/repos', {
    ...(apiOrigin ? { apiOrigin } : {}),
    method: 'POST',
    body: {
      name: args.name,
      description: args.description ?? 'My OpenStore: durable memory for my AI, as plain Markdown.',
      private: true,
      auto_init: true
    }
  }).then((raw) => (raw ? toRepo(raw) : null));
}

/**
 * Text files of the public template repository, decoded, used to seed a repo made
 * through the `POST /user/repos` fallback. Binary and hidden paths are skipped.
 */
export async function readTemplateFiles(
  token: string,
  templateOwner: string,
  templateRepo: string,
  apiOrigin?: string
): Promise<{ path: string; content: string }[]> {
  const repo = await api<RawRepo>(token, `/repos/${templateOwner}/${templateRepo}`, {
    ...(apiOrigin ? { apiOrigin } : {}),
    nullOn: [404]
  });
  if (!repo) return [];
  const branch = repo.default_branch ?? 'main';
  const tree = await api<{ tree?: { path: string; type: string; sha: string }[] }>(
    token,
    `/repos/${templateOwner}/${templateRepo}/git/trees/${branch}?recursive=1`,
    { ...(apiOrigin ? { apiOrigin } : {}), nullOn: [404] }
  );
  const blobs = (tree?.tree ?? [])
    .filter((entry) => entry.type === 'blob' && isSeedablePath(entry.path))
    .slice(0, 200);
  const files: { path: string; content: string }[] = [];
  for (const entry of blobs) {
    const raw = await api<{ content?: string; encoding?: string }>(
      token,
      `/repos/${templateOwner}/${templateRepo}/git/blobs/${entry.sha}`,
      { ...(apiOrigin ? { apiOrigin } : {}), nullOn: [404] }
    );
    if (typeof raw?.content !== 'string') continue;
    files.push({
      path: entry.path,
      content: raw.encoding === 'base64' ? base64ToUtf8(raw.content) : raw.content
    });
  }
  return files;
}

const SEEDABLE = /\.(md|markdown|txt|ya?ml|json|csv)$/i;

function isSeedablePath(path: string): boolean {
  if (path.split('/').some((segment) => segment.startsWith('.'))) return false;
  return SEEDABLE.test(path);
}
