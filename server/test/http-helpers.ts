/**
 * A routing `fetch` stub for the hosted-flow tests. GitHub is the only network
 * the hosted server touches, and both of its origins are overridden here, so an
 * unexpected request fails the test loudly instead of escaping to the internet.
 */
import { generateSealKeyBase64 } from '../src/oauth/seal.js';
import type { Env } from '../src/http/env.js';

export const API = 'https://api.github.test';
export const OAUTH = 'https://github.test';

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    GITHUB_CLIENT_ID: 'Iv23liTESTCLIENT',
    GITHUB_CLIENT_SECRET: 'test-client-secret',
    OPENSTORE_SEAL_KEY: generateSealKeyBase64(),
    GITHUB_APP_SLUG: 'openstore',
    GITHUB_APP_ID: '4242',
    PUBLIC_SITE_URL: 'https://example.invalid/open-store/',
    OPENSTORE_TEMPLATE_REPO: 'intreaction/openstore-template',
    GITHUB_API_ORIGIN: API,
    GITHUB_OAUTH_ORIGIN: OAUTH,
    ...overrides
  };
}

export interface Route {
  method?: string;
  /** Matched against `<origin><pathname>`, ignoring the query string. */
  url: string | RegExp;
  status?: number;
  /** Static body, or a function of the request. */
  body?: unknown | ((request: { url: URL; body: string }) => unknown);
}

export interface FetchMock {
  /** Every call, in order. `body` is the request body as text. */
  calls: { method: string; url: string; body: string }[];
  restore: () => void;
}

export function installFetch(routes: Route[]): FetchMock {
  const calls: FetchMock['calls'] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const key = `${url.origin}${url.pathname}`;
    const body = await request.text();
    calls.push({ method: request.method, url: request.url, body });

    for (const route of routes) {
      if (route.method && route.method !== request.method) continue;
      const matches =
        typeof route.url === 'string' ? route.url === key : (route.url as RegExp).test(key);
      if (!matches) continue;
      const payload =
        typeof route.body === 'function'
          ? (route.body as (r: { url: URL; body: string }) => unknown)({ url, body })
          : route.body;
      const status = route.status ?? 200;
      if (status === 204 || payload === undefined) {
        return new Response(null, { status });
      }
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`unmocked fetch: ${request.method} ${key}`);
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    }
  };
}

// ---- canned GitHub payloads ------------------------------------------------

export const TOKEN_ROUTE: Route = {
  method: 'POST',
  url: `${OAUTH}/login/oauth/access_token`,
  body: ({ body }: { body: string }) => {
    const form = new URLSearchParams(body);
    return form.get('grant_type') === 'refresh_token'
      ? { access_token: 'gho_renewed', refresh_token: 'ghr_renewed', expires_in: 28800 }
      : { access_token: 'gho_user_token', refresh_token: 'ghr_user_token', expires_in: 28800 };
  }
};

export const VIEWER_ROUTE: Route = { url: `${API}/user`, body: { login: 'intreaction', id: 7 } };

export function installationsRoute(
  installations: { id: number; selection?: string; login?: string; type?: string }[],
  appId = 4242
): Route {
  return {
    url: `${API}/user/installations`,
    body: {
      total_count: installations.length,
      installations: installations.map((entry) => ({
        id: entry.id,
        app_id: appId,
        repository_selection: entry.selection ?? 'all',
        account: { login: entry.login ?? 'intreaction', type: entry.type ?? 'User' }
      }))
    }
  };
}

export function reposRoute(installationId: number, names: string[]): Route {
  return {
    url: `${API}/user/installations/${installationId}/repositories`,
    body: {
      total_count: names.length,
      repositories: names.map((full, index) => repoJson(full, index + 100))
    }
  };
}

export function repoJson(full: string, id = 101, defaultBranch: string | null = 'main') {
  const [owner, name] = full.split('/');
  return {
    id,
    name,
    full_name: full,
    private: true,
    default_branch: defaultBranch,
    owner: { login: owner }
  };
}

/** The Git Data calls one `initialize` makes to read CONTEXT.md. */
export function gitDataRoutes(full: string, context: string): Route[] {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(context);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  return [
    { url: `${API}/repos/${full}`, body: repoJson(full) },
    {
      // Octokit percent-encodes the slash inside the ref path parameter.
      url: `${API}/repos/${full}/git/ref/heads%2Fmain`,
      body: { ref: 'refs/heads/main', object: { sha: 'c'.repeat(40), type: 'commit' } }
    },
    {
      url: `${API}/repos/${full}/git/commits/${'c'.repeat(40)}`,
      body: {
        sha: 'c'.repeat(40),
        message: 'seed',
        tree: { sha: 't'.repeat(40) },
        parents: [],
        author: { name: 'John Wheeler', email: 'john@example.invalid', date: '2026-09-06T12:00:00Z' }
      }
    },
    {
      url: `${API}/repos/${full}/git/trees/${'t'.repeat(40)}`,
      body: {
        sha: 't'.repeat(40),
        truncated: false,
        tree: [
          { path: 'CONTEXT.md', type: 'blob', mode: '100644', sha: 'b'.repeat(40), size: bytes.length }
        ]
      }
    },
    {
      url: `${API}/repos/${full}/git/blobs/${'b'.repeat(40)}`,
      body: { sha: 'b'.repeat(40), encoding: 'base64', content: base64, size: bytes.length }
    }
  ];
}

// ---- MCP request helpers ---------------------------------------------------

export const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream'
} as const;

export function rpc(method: string, params: unknown = {}, id: number | string = 1) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

export const INITIALIZE_PARAMS = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'test-client', version: '0.0.0' }
};
