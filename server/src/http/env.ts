/**
 * The hosted server's whole configuration surface. Three secrets and three
 * plain vars — deliberately no storage binding of any kind exists to configure.
 */
import { importSealKey } from '../oauth/seal.js';

export interface Env {
  /** Secret. GitHub App client id (`Iv1.…` / `Iv23…`). */
  GITHUB_CLIENT_ID: string;
  /** Secret. GitHub App client secret. */
  GITHUB_CLIENT_SECRET: string;
  /** Secret. 32 bytes, base64. Seals every token the client carries. */
  OPENSTORE_SEAL_KEY: string;
  /** Var. The App's URL slug, used to build the install link. */
  GITHUB_APP_SLUG?: string;
  /** Var. The App's numeric id, used to keep only our own installations. */
  GITHUB_APP_ID?: string;
  /** Var. The project's public site, linked from the HTML pages. */
  PUBLIC_SITE_URL?: string;
  /** Var. `owner/name` of the public template repository. */
  OPENSTORE_TEMPLATE_REPO?: string;
  /** Var. Overrides the issuer/origin when the Worker sits behind another name. */
  PUBLIC_BASE_URL?: string;
  /** Test/self-host seam: GitHub REST origin (no trailing slash). */
  GITHUB_API_ORIGIN?: string;
  /** Test/self-host seam: GitHub OAuth origin (no trailing slash). */
  GITHUB_OAUTH_ORIGIN?: string;
}

export const DEFAULT_TEMPLATE_REPO = 'intreaction/openstore-template';
export const DEFAULT_SITE_URL = 'https://openstore.sh/';
export const DEFAULT_STORE_NAME = 'my-openstore';

export interface Settings {
  clientId: string;
  clientSecret: string;
  appSlug: string;
  appId: number;
  siteUrl: string;
  templateOwner: string;
  templateRepo: string;
  apiOrigin: string | undefined;
  oauthOrigin: string | undefined;
  baseUrl: string | undefined;
}

/** A configuration problem, distinct from a bad request. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function readSettings(env: Env): Settings {
  const clientId = (env.GITHUB_CLIENT_ID ?? '').trim();
  const clientSecret = (env.GITHUB_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) {
    throw new ConfigError('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are required');
  }
  // Fail closed: without the App's numeric id, `listInstallations` cannot tell
  // our installations from any other App's, and the flow would offer a user
  // repositories a different App granted. A missing id is a broken deploy, not a
  // permissive default.
  const appId = Number.parseInt((env.GITHUB_APP_ID ?? '').trim(), 10);
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    throw new ConfigError('GITHUB_APP_ID is required (the GitHub App\'s numeric id)');
  }
  const template = (env.OPENSTORE_TEMPLATE_REPO ?? DEFAULT_TEMPLATE_REPO).trim();
  const slash = template.indexOf('/');
  if (slash <= 0 || slash === template.length - 1) {
    throw new ConfigError('OPENSTORE_TEMPLATE_REPO must look like owner/name');
  }
  return {
    clientId,
    clientSecret,
    appSlug: (env.GITHUB_APP_SLUG ?? 'openstore').trim(),
    appId,
    siteUrl: (env.PUBLIC_SITE_URL ?? DEFAULT_SITE_URL).trim(),
    templateOwner: template.slice(0, slash),
    templateRepo: template.slice(slash + 1),
    apiOrigin: trimOrigin(env.GITHUB_API_ORIGIN),
    oauthOrigin: trimOrigin(env.GITHUB_OAUTH_ORIGIN),
    baseUrl: trimOrigin(env.PUBLIC_BASE_URL)
  };
}

function trimOrigin(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The issuer. `PUBLIC_BASE_URL` wins so a Worker behind a custom domain still
 * advertises the URL clients actually reach; otherwise the request's own origin.
 */
export function originOf(env: Env, requestUrl: string): string {
  const override = trimOrigin(env.PUBLIC_BASE_URL);
  if (override) return override;
  return new URL(requestUrl).origin;
}

/**
 * Imports the seal key for one request. Deliberately not cached: nothing in this
 * server outlives a request, not even a derived key.
 */
export function sealKey(env: Env): Promise<CryptoKey> {
  return importSealKey(env.OPENSTORE_SEAL_KEY ?? '');
}
