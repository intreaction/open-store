import { ShellError } from './errors.js';

export interface Config {
  owner: string;
  repo: string;
  /** Configured branch, or undefined to use the repository default branch. */
  branch?: string;
  token: string;
  readOnly: boolean;
  /** Label written into the `OpenStore-Client:` commit trailer. */
  client: string;
  /** GitHub REST base URL (for GitHub Enterprise). */
  apiUrl?: string;
}

function isTrue(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** The subset of an environment bag this reader needs. Deliberately not
 * `NodeJS.ProcessEnv`: the shared code must build on Workers too, so the caller
 * (the stdio entry) is the only place that reaches for `process.env`. */
export type EnvBag = Record<string, string | undefined>;

/**
 * Reads configuration from the environment. `.env` files are never read and the
 * token is never logged or echoed back.
 */
export function loadConfig(env: EnvBag): Config {
  const repoSpec = (env.OPENSTORE_REPO ?? '').trim();
  if (!repoSpec) {
    throw new ShellError('openstore: OPENSTORE_REPO is required (owner/name)');
  }
  const match = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(repoSpec);
  if (!match) {
    throw new ShellError(`openstore: OPENSTORE_REPO must look like owner/name (got ${repoSpec})`);
  }
  const token = (env.OPENSTORE_TOKEN ?? '').trim();
  if (!token) {
    throw new ShellError('openstore: OPENSTORE_TOKEN is required');
  }
  const branch = (env.OPENSTORE_BRANCH ?? '').trim();
  const client = (env.OPENSTORE_CLIENT ?? '').trim() || 'openstore';
  const apiUrl = (env.GITHUB_API_URL ?? '').trim();
  const config: Config = {
    owner: match[1]!,
    repo: match[2]!,
    token,
    readOnly: isTrue(env.OPENSTORE_READONLY),
    client
  };
  if (branch) config.branch = branch;
  if (apiUrl) config.apiUrl = apiUrl;
  return config;
}
